import { NextRequest, NextResponse } from "next/server";
import { getInstall } from "@/lib/store";
import { refreshInstallTokens } from "@/lib/tokens";

// Authenticating proxy in front of api.notion.com. The worker points
// NOTION_API_BASE_URL here and sends its per-install key as the bearer token;
// we swap in the real (auto-refreshed) OAuth access token.
export const maxDuration = 60;

const NOTION_BASE = "https://api.notion.com";

function unauthorized(message: string) {
  return NextResponse.json(
    { object: "error", status: 401, code: "unauthorized", message },
    { status: 401 }
  );
}

function forward(
  url: string,
  method: string,
  req: NextRequest,
  accessToken: string,
  body: string | undefined
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Notion-Version": req.headers.get("notion-version") ?? "2022-06-28",
  };
  if (body) {
    headers["Content-Type"] =
      req.headers.get("content-type") ?? "application/json";
  }
  return fetch(url, { method, headers, body: body || undefined });
}

async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const auth = req.headers.get("authorization") ?? "";
  const installKey = auth.replace(/^Bearer\s+/i, "").trim();
  if (!installKey.startsWith("dvq_")) {
    return unauthorized("Missing or malformed install key.");
  }

  let record;
  try {
    record = await getInstall(installKey);
  } catch (err) {
    console.error("Install lookup failed:", err);
    return NextResponse.json(
      { object: "error", status: 500, code: "internal_server_error", message: "DevQuest could not look up this install." },
      { status: 500 }
    );
  }
  if (!record) {
    return unauthorized("Unknown install key. Re-run the DevQuest installer.");
  }

  const { path } = await params;
  const url = `${NOTION_BASE}/${path.join("/")}${req.nextUrl.search}`;
  const body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : await req.text();

  let res = await forward(url, req.method, req, record.accessToken, body);

  // Stale access token — refresh once and retry.
  if (res.status === 401) {
    const refreshed = await refreshInstallTokens(record);
    if (!refreshed) {
      return unauthorized(
        "Access token expired and could not be refreshed. Re-run the DevQuest installer."
      );
    }
    res = await forward(url, req.method, req, refreshed.accessToken, body);
  }

  return new NextResponse(await res.text(), {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "application/json",
    },
  });
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
};
