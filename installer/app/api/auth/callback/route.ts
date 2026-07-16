import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { runSetup } from "@/lib/setup";
import { saveAuthorization } from "@/lib/store";

// Setup makes ~6 sequential Notion API calls; don't let the default 10s limit cut it off.
export const maxDuration = 60;

function verifyState(cookieValue: string, state: string): boolean {
  const [storedState, sig] = cookieValue.split(".");
  if (!storedState || !sig || storedState !== state) return false;
  const expected = createHmac("sha256", process.env.SESSION_SECRET!)
    .update(state)
    .digest("hex");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
}

export async function GET(req: NextRequest) {
  const { NOTION_CLIENT_ID, NOTION_CLIENT_SECRET, SESSION_SECRET, APP_URL } =
    process.env;
  if (!NOTION_CLIENT_ID || !NOTION_CLIENT_SECRET || !SESSION_SECRET || !APP_URL) {
    return NextResponse.json(
      { error: "Missing NOTION_CLIENT_ID, NOTION_CLIENT_SECRET, SESSION_SECRET, or APP_URL env vars" },
      { status: 500 }
    );
  }
  const appUrl = APP_URL;

  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${appUrl}/?error=${encodeURIComponent(error)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/?error=missing_params`);
  }

  const jar = await cookies();
  const stateCookie = jar.get("oauth_state")?.value;
  if (!stateCookie || !verifyState(stateCookie, state)) {
    return NextResponse.redirect(`${appUrl}/?error=invalid_state`);
  }
  jar.delete("oauth_state");

  // Exchange code for token
  const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(
        `${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`
      ).toString("base64")}`,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${appUrl}/api/auth/callback`,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("Token exchange failed:", body);
    return NextResponse.redirect(`${appUrl}/?error=token_exchange_failed`);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string | null;
    bot_id: string;
    workspace_id: string;
    workspace_name: string | null;
  };
  const workspaceName = tokenData.workspace_name || "your workspace";

  // Persist the token pair before doing anything else — Notion rotates
  // refresh tokens, and losing this pair means the user must re-authorize.
  let installKey: string;
  try {
    const record = await saveAuthorization({
      botId: tokenData.bot_id,
      workspaceId: tokenData.workspace_id,
      workspaceName,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? null,
    });
    installKey = record.installKey;
  } catch (err) {
    console.error("Failed to store authorization:", err);
    return NextResponse.redirect(`${appUrl}/?error=storage_failed`);
  }

  // Run workspace setup
  let result;
  try {
    result = await runSetup(tokenData.access_token, workspaceName);
  } catch (err) {
    console.error("Setup failed:", err);
    return NextResponse.redirect(`${appUrl}/?error=setup_failed`);
  }

  // Hand the result to the success page via a short-lived cookie so the
  // install key never appears in a URL.
  const payload = Buffer.from(
    JSON.stringify({
      workspace: workspaceName,
      installKey,
      parentUrl: result.parentUrl,
      configUrl: result.configUrl,
      personasDbUrl: result.personasDbUrl,
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
  return NextResponse.redirect(`${appUrl}/install`);
}
