import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getKv } from "@/lib/kv";
import { getInstallByWorkspace } from "@/lib/store";
import { syncStackPage } from "@/lib/stack-sync";

/**
 * Notion integration webhook receiver.
 *
 * Configured once on the public integration (notion.so/my-integrations →
 * DevQuest → Webhooks): Notion sends page events from EVERY workspace that
 * installed via OAuth. We react to content edits on "DevQuest Company Config"
 * pages by syncing mentioned services into that workspace's Doc Sources DB.
 *
 * Setup handshake: on subscription, Notion POSTs a one-time
 * verification_token. We store and log it — paste it back into the
 * integration's webhook settings to activate. Subsequent events are
 * HMAC-signed with that token (X-Notion-Signature).
 */
export const maxDuration = 60;

const TOKEN_KEY = "webhook:notion-verification-token";
const HANDLED_EVENTS = new Set(["page.content_updated", "page.properties_updated"]);
/** Notion aggregates rapid edits, but we still debounce per page. */
const COOLDOWN_SECONDS = 120;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // --- One-time subscription handshake -------------------------------------
  if (typeof body.verification_token === "string") {
    await getKv().set(TOKEN_KEY, body.verification_token);
    console.log(
      "Notion webhook verification token received — paste it into the integration's webhook settings:",
      body.verification_token
    );
    return NextResponse.json({ ok: true });
  }

  // --- Signature verification ----------------------------------------------
  const secret =
    process.env.NOTION_WEBHOOK_SECRET ?? (await getKv().get<string>(TOKEN_KEY));
  if (!secret) {
    console.error("Webhook event received but no verification token stored yet");
    return NextResponse.json({ error: "Not configured" }, { status: 401 });
  }
  const signature = (req.headers.get("x-notion-signature") ?? "").replace(/^sha256=/, "");
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // --- Event handling --------------------------------------------------------
  const type = body.type as string | undefined;
  const workspaceId = body.workspace_id as string | undefined;
  const entity = body.entity as { id?: string; type?: string } | undefined;

  if (!type || !HANDLED_EVENTS.has(type) || entity?.type !== "page" || !entity.id || !workspaceId) {
    return NextResponse.json({ ok: true, action: "ignored_event_type" });
  }

  const kv = getKv();
  const cooldownKey = `webhook:cooldown:${entity.id}`;
  if (await kv.get(cooldownKey)) {
    return NextResponse.json({ ok: true, action: "debounced" });
  }
  await kv.set(cooldownKey, "1", { ex: COOLDOWN_SECONDS });

  const record = await getInstallByWorkspace(workspaceId);
  if (!record) {
    // Workspace connected the integration but never finished a DevQuest install
    return NextResponse.json({ ok: true, action: "unknown_workspace" });
  }

  try {
    const result = await syncStackPage(record, entity.id);
    if (result.action === "synced" && result.added?.length) {
      console.log(
        `Stack sync (${record.workspaceName}): added doc sources ${result.added.join(", ")}`
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("Stack sync failed:", err);
    return NextResponse.json({ ok: false, error: "sync_failed" }, { status: 500 });
  }
}
