import { NextRequest, NextResponse } from "next/server";
import { getInstall, getRedis } from "@/lib/store";

/**
 * Central docs knowledge base feed.
 *
 * Source of truth is the master workspace's "DevQuest Docs Knowledge Base"
 * database — populated by the master worker's own docs_index sync and
 * hand-curatable in Notion. This endpoint serves it read-only, filtered to
 * the sources a caller asks for (?sources=notion,stripe), so customer
 * workers pull pre-classified entries instead of re-deriving them.
 *
 * Auth: a valid DevQuest install key as the bearer token.
 * Reads go through a 1-hour Redis cache so N installs don't hammer the
 * master workspace's rate limit.
 */
export const maxDuration = 60;

const MASTER_KB_TITLE = "DevQuest Docs Knowledge Base";
const CACHE_KEY = "kb:master-cache";
const CACHE_TTL_SECONDS = 3600;

interface KbEntry {
  title: string;
  url: string;
  summary: string;
  category: string | null;
  difficulty: string | null;
  relevantFor: string[];
  source: string;
  firstSeen: string | null;
}

async function masterFetch(path: string, body?: unknown) {
  const token = process.env.NOTION_MASTER_TOKEN;
  if (!token) throw new Error("NOTION_MASTER_TOKEN is not set");
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2025-09-03",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Master KB fetch ${path} → ${res.status}: ${(data as { message?: string }).message ?? ""}`
    );
  }
  return data;
}

async function findMasterKbDataSource(): Promise<string> {
  const response = (await masterFetch("/search", {
    query: MASTER_KB_TITLE,
    filter: { property: "object", value: "data_source" },
  })) as { results: Array<{ id: string; title?: Array<{ plain_text?: string }>; name?: string }> };
  for (const result of response.results) {
    const title = result.title?.[0]?.plain_text ?? result.name ?? "";
    if (title === MASTER_KB_TITLE) return result.id;
  }
  throw new Error(`No data source titled "${MASTER_KB_TITLE}" in the master workspace`);
}

type KbPageProps = Record<
  string,
  {
    title?: Array<{ plain_text?: string }>;
    rich_text?: Array<{ plain_text?: string }>;
    url?: string | null;
    select?: { name?: string } | null;
    multi_select?: Array<{ name?: string }>;
    date?: { start?: string | null } | null;
  }
>;

function plain(items?: Array<{ plain_text?: string }>): string {
  return (items ?? []).map((t) => t.plain_text ?? "").join("");
}

async function readMasterKb(): Promise<KbEntry[]> {
  const dsId = await findMasterKbDataSource();
  const entries: KbEntry[] = [];
  let cursor: string | undefined;
  do {
    const resp = (await masterFetch(`/data_sources/${dsId}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })) as {
      results: Array<{ properties?: unknown }>;
      has_more?: boolean;
      next_cursor?: string | null;
    };
    for (const page of resp.results) {
      const props = (page.properties ?? {}) as KbPageProps;
      const url = props.Link?.url ?? plain(props.URL?.rich_text);
      if (!url) continue;
      entries.push({
        title: plain(props.Title?.title),
        url,
        summary: plain(props.Summary?.rich_text),
        category: props.Category?.select?.name ?? null,
        difficulty: props.Difficulty?.select?.name ?? null,
        relevantFor: (props["Relevant For"]?.multi_select ?? [])
          .map((o) => o.name ?? "")
          .filter(Boolean),
        source: props.Source?.select?.name ?? "Notion",
        firstSeen: props["First Seen"]?.date?.start ?? null,
      });
    }
    cursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return entries;
}

async function getMasterKbCached(): Promise<KbEntry[]> {
  const redis = getRedis();
  const cached = await redis.get<KbEntry[]>(CACHE_KEY);
  if (cached && cached.length > 0) return cached;
  const entries = await readMasterKb();
  if (entries.length > 0) {
    await redis.set(CACHE_KEY, entries, { ex: CACHE_TTL_SECONDS });
  }
  return entries;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const installKey = auth.replace(/^Bearer\s+/i, "").trim();
  if (!installKey.startsWith("dvq_") || !(await getInstall(installKey))) {
    return NextResponse.json(
      { error: "Invalid install key." },
      { status: 401 }
    );
  }

  let entries: KbEntry[];
  try {
    entries = await getMasterKbCached();
  } catch (err) {
    console.error("Central KB read failed:", err);
    // 503 tells worker syncs to fall back to fetching sources directly.
    return NextResponse.json({ error: "Central KB unavailable." }, { status: 503 });
  }

  const available = [...new Set(entries.map((e) => e.source.toLowerCase()))];

  const sourcesParam = req.nextUrl.searchParams.get("sources");
  let filtered = entries;
  if (sourcesParam) {
    const wanted = new Set(
      sourcesParam.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    );
    filtered = entries.filter((e) => wanted.has(e.source.toLowerCase()));
  }
  const served = [...new Set(filtered.map((e) => e.source.toLowerCase()))];

  return NextResponse.json({ entries: filtered, served, available });
}
