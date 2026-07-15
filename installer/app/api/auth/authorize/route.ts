import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHmac, randomBytes } from "crypto";

function signState(state: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET!)
    .update(state)
    .digest("hex");
}

export async function GET() {
  const clientId = process.env.NOTION_CLIENT_ID;
  const appUrl = process.env.APP_URL;

  if (!clientId || !appUrl) {
    return NextResponse.json(
      { error: "Missing NOTION_CLIENT_ID or APP_URL env vars" },
      { status: 500 }
    );
  }

  const state = randomBytes(16).toString("hex");
  const sig = signState(state);
  const cookieValue = `${state}.${sig}`;

  const redirectUri = `${appUrl}/api/auth/callback`;
  const authUrl = new URL("https://api.notion.com/v1/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("owner", "user");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authUrl.toString());
  const jar = await cookies();
  jar.set("oauth_state", cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
