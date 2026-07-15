import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHmac } from "crypto";
import { runSetup } from "@/lib/setup";

function verifyState(cookieValue: string, state: string): boolean {
  const [storedState, sig] = cookieValue.split(".");
  if (storedState !== state) return false;
  const expected = createHmac("sha256", process.env.SESSION_SECRET!)
    .update(state)
    .digest("hex");
  return sig === expected;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${process.env.APP_URL}/?error=${encodeURIComponent(error)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(`${process.env.APP_URL}/?error=missing_params`);
  }

  const jar = await cookies();
  const stateCookie = jar.get("oauth_state")?.value;
  if (!stateCookie || !verifyState(stateCookie, state)) {
    return NextResponse.redirect(`${process.env.APP_URL}/?error=invalid_state`);
  }
  jar.delete("oauth_state");

  // Exchange code for token
  const appUrl = process.env.APP_URL!;
  const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(
        `${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`
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
    workspace_name: string;
  };

  // Run workspace setup
  let result;
  try {
    result = await runSetup(tokenData.access_token, tokenData.workspace_name);
  } catch (err) {
    console.error("Setup failed:", err);
    const msg = err instanceof Error ? err.message : "setup_failed";
    return NextResponse.redirect(
      `${appUrl}/?error=${encodeURIComponent(msg)}`
    );
  }

  // Redirect to success page with result encoded in query params
  const params = new URLSearchParams({
    workspace: tokenData.workspace_name,
    parentUrl: result.parentUrl,
    configUrl: result.configUrl,
    personasDbUrl: result.personasDbUrl,
  });
  return NextResponse.redirect(`${appUrl}/install?${params.toString()}`);
}
