import { InstallRecord } from "./store";
import { refreshInstallTokens } from "./tokens";
import { KNOWN_DOC_SOURCES, DOC_SOURCES_DB_TITLE } from "./doc-sources";

/**
 * Stack-page sync: when a workspace edits its "DevQuest Company Config" page,
 * detect known services mentioned in the content and make sure each has a row
 * in that workspace's Doc Sources database. Rows are only ever ADDED — humans
 * (or the agent) remove sources deliberately; a page edit never deletes.
 *
 * The worker's daily sync reads the Doc Sources DB, so rows added here flow
 * into the knowledge base on the next cycle.
 */

const NOTION_VERSION = "2025-09-03";
const CONFIG_PAGE_TITLE = "DevQuest Company Config";

export interface StackSyncResult {
  action: "synced" | "ignored_not_config" | "no_known_services" | "no_doc_sources_db";
  added?: string[];
}

interface RichTextLike {
  plain_text?: string;
}

function plain(items?: RichTextLike[]): string {
  return (items ?? []).map((t) => t.plain_text ?? "").join("");
}

export async function syncStackPage(
  record: InstallRecord,
  pageId: string
): Promise<StackSyncResult> {
  let current = record;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  async function nf(method: string, path: string, body?: unknown): Promise<any> {
    const call = (token: string) =>
      fetch(`https://api.notion.com/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });

    let res = await call(current.accessToken);
    if (res.status === 401) {
      const refreshed = await refreshInstallTokens(current);
      if (!refreshed) throw new Error("Access token expired and refresh failed");
      current = refreshed;
      res = await call(current.accessToken);
    }
    const data = await res.json();
    if (!res.ok) {
      throw new Error(
        `Notion ${method} ${path} → ${res.status}: ${(data as { message?: string }).message ?? ""}`
      );
    }
    return data;
  }

  // 1. Only the company config page drives this sync
  const page = await nf("GET", `/pages/${pageId}`);
  const titleProp = Object.values(
    (page.properties ?? {}) as Record<string, { type?: string; title?: RichTextLike[] }>
  ).find((p) => p.type === "title");
  if (plain(titleProp?.title) !== CONFIG_PAGE_TITLE) {
    return { action: "ignored_not_config" };
  }

  // 2. Collect the page's text content
  let text = "";
  let cursor: string | undefined;
  do {
    const resp = await nf(
      "GET",
      `/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`
    );
    for (const block of resp.results as Array<Record<string, any>>) {
      const content = block[block.type as string];
      text += " " + plain(content?.rich_text);
    }
    cursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined;
  } while (cursor);
  const haystack = text.toLowerCase();

  // 3. Known services mentioned on the page
  const detected = Object.entries(KNOWN_DOC_SOURCES)
    .filter(([key]) => haystack.includes(key))
    .map(([, source]) => source);
  if (detected.length === 0) return { action: "no_known_services" };

  // 4. Find the workspace's Doc Sources database
  const search = await nf("POST", "/search", {
    query: DOC_SOURCES_DB_TITLE,
    filter: { property: "object", value: "data_source" },
  });
  let dsId: string | null = null;
  for (const result of search.results as Array<{
    id: string;
    title?: RichTextLike[];
    name?: string;
  }>) {
    const title = result.title?.[0]?.plain_text ?? result.name ?? "";
    if (title === DOC_SOURCES_DB_TITLE) {
      dsId = result.id;
      break;
    }
  }
  if (!dsId) return { action: "no_doc_sources_db" };

  const rows = await nf("POST", `/data_sources/${dsId}/query`, { page_size: 100 });
  const existing = new Set(
    (rows.results as Array<{ properties?: Record<string, { title?: RichTextLike[] }> }>).map(
      (row) => plain(row.properties?.["Source Name"]?.title).toLowerCase()
    )
  );

  const ds = await nf("GET", `/data_sources/${dsId}`);
  const dbId: string = ds.parent?.database_id ?? dsId;

  // 5. Add rows for newly-mentioned services
  const added: string[] = [];
  for (const source of detected) {
    if (existing.has(source.label.toLowerCase())) continue;
    await nf("POST", "/pages", {
      parent: { database_id: dbId },
      properties: {
        "Source Name": { title: [{ type: "text", text: { content: source.label } }] },
        URL: { url: source.url },
        Type: { select: { name: source.type } },
      },
    });
    added.push(source.label);
  }

  return { action: "synced", added };
}
