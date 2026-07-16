import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { runSetup, SetupAnswers } from "@/lib/setup";
import { getInstall } from "@/lib/store";
import { KNOWN_DOC_SOURCES } from "@/lib/doc-sources";

// Creates the workspace pages after the questionnaire (or skip). Several
// sequential Notion calls — don't let the default 10s limit cut it off.
export const maxDuration = 60;

interface SetupRequestBody {
  skipped?: boolean;
  tools?: string[];
  customTools?: { name?: string; url?: string }[];
  teams?: string[];
  languages?: string[];
}

function sanitizeCustomTools(
  input: SetupRequestBody["customTools"]
): { name: string; url: string }[] {
  const out: { name: string; url: string }[] = [];
  for (const item of input ?? []) {
    const name = String(item?.name ?? "").trim().slice(0, 40);
    const rawUrl = String(item?.url ?? "").trim();
    if (!name || !rawUrl) continue;
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      out.push({ name, url: url.toString() });
    } catch {
      // not a valid URL — drop it
    }
    if (out.length >= 10) break;
  }
  return out;
}

export async function POST(req: NextRequest) {
  const jar = await cookies();
  const raw = jar.get("devquest_pending")?.value;
  let pending: { installKey: string; workspace: string } | null = null;
  try {
    pending = raw ? JSON.parse(Buffer.from(raw, "base64url").toString()) : null;
  } catch {
    pending = null;
  }
  if (!pending) {
    return NextResponse.json(
      { error: "Setup session expired. Please connect to Notion again." },
      { status: 401 }
    );
  }

  const record = await getInstall(pending.installKey);
  if (!record) {
    return NextResponse.json(
      { error: "Install not found. Please connect to Notion again." },
      { status: 401 }
    );
  }

  let body: SetupRequestBody;
  try {
    body = (await req.json()) as SetupRequestBody;
  } catch {
    body = { skipped: true };
  }

  // Sanitize answers — unknown tools dropped, custom URLs validated, caps applied.
  let answers: SetupAnswers | undefined;
  if (!body.skipped) {
    answers = {
      tools: (body.tools ?? []).filter((t) => t in KNOWN_DOC_SOURCES),
      customTools: sanitizeCustomTools(body.customTools),
      teams: (body.teams ?? [])
        .map((t) => String(t).trim())
        .filter(Boolean)
        .slice(0, 10),
      languages: (body.languages ?? [])
        .map((l) => String(l).trim().slice(0, 30))
        .filter(Boolean)
        .slice(0, 10),
    };
    // Demand signal: custom sources several installs ask for are candidates
    // for promotion to the central master KB.
    for (const t of answers.customTools) {
      console.log(`custom-doc-source requested: ${t.name} (${t.url}) by ${pending.installKey.slice(0, 12)}…`);
    }
  }

  let result;
  try {
    result = await runSetup(record.accessToken, pending.workspace, answers);
  } catch (err) {
    console.error("Setup failed:", err);
    return NextResponse.json(
      { error: "Creating the workspace pages failed. Please try again." },
      { status: 500 }
    );
  }

  const payload = Buffer.from(
    JSON.stringify({
      workspace: pending.workspace,
      installKey: pending.installKey,
      parentUrl: result.parentUrl,
      configUrl: result.configUrl,
      personasDbUrl: result.personasDbUrl,
      docSourcesUrl: result.docSourcesUrl,
      teamUrls: result.teamUrls,
    })
  ).toString("base64url");

  jar.set("devquest_setup", payload, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  jar.delete("devquest_pending");

  return NextResponse.json({ ok: true });
}
