import { getInstall, updateTokens, InstallRecord } from "./store";

/**
 * Refresh a stale access token. Notion rotates refresh tokens: each refresh
 * returns a new pair and invalidates the old refresh token, so the new pair
 * is persisted immediately.
 *
 * Concurrency (two serverless instances refreshing at once): the loser gets
 * invalid_grant because the winner already rotated the token. In that case we
 * re-read the record — if another instance stored a newer pair, use it;
 * otherwise the connection was genuinely revoked and we give up.
 */
export async function refreshInstallTokens(
  record: InstallRecord
): Promise<InstallRecord | null> {
  if (!record.refreshToken) return null;

  const { NOTION_CLIENT_ID, NOTION_CLIENT_SECRET } = process.env;
  if (!NOTION_CLIENT_ID || !NOTION_CLIENT_SECRET) {
    throw new Error("Missing NOTION_CLIENT_ID / NOTION_CLIENT_SECRET env vars");
  }

  const res = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(
        `${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`
      ).toString("base64")}`,
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: record.refreshToken,
    }),
  });

  if (res.ok) {
    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string | null;
    };
    await updateTokens(
      record.installKey,
      data.access_token,
      data.refresh_token ?? null
    );
    return {
      ...record,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
    };
  }

  console.error("Token refresh failed:", res.status, await res.text());

  const fresh = await getInstall(record.installKey);
  if (fresh && fresh.accessToken !== record.accessToken) return fresh;
  return null;
}
