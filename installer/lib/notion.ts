const NOTION_VERSION = "2022-06-28";
const BASE = "https://api.notion.com/v1";

export async function notionFetch<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Notion ${method} ${path} → ${res.status}: ${(data as { message?: string }).message ?? JSON.stringify(data)}`
    );
  }
  return data as T;
}

export function paragraph(text: string) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [{ type: "text", text: { content: text } }] },
  };
}

export function richText(content: string) {
  return [{ type: "text", text: { content } }];
}
