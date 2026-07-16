/**
 * Well-known developer doc sources. Mirrors KNOWN_DOC_SOURCES in
 * src/docs-parser.ts (the worker) — keep the two in sync.
 *
 * These power the install questionnaire ("what tools does your team use?")
 * and become rows in each workspace's "DevQuest Doc Sources" database, which
 * the worker's sync merges into the knowledge base.
 */

export const SOURCE_TYPES = ["llms-txt", "openapi", "sitemap", "markdown"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const KNOWN_DOC_SOURCES: Record<
  string,
  { label: string; url: string; type: SourceType }
> = {
  stripe: { label: "Stripe", url: "https://docs.stripe.com/llms.txt", type: "llms-txt" },
  vercel: { label: "Vercel", url: "https://vercel.com/docs/llms.txt", type: "llms-txt" },
  hubspot: { label: "HubSpot", url: "https://developers.hubspot.com/docs/llms.txt", type: "llms-txt" },
  cloudflare: { label: "Cloudflare", url: "https://developers.cloudflare.com/llms.txt", type: "llms-txt" },
  twilio: { label: "Twilio", url: "https://www.twilio.com/docs/llms.txt", type: "llms-txt" },
  supabase: { label: "Supabase", url: "https://supabase.com/docs/llms.txt", type: "llms-txt" },
  firebase: { label: "Firebase", url: "https://firebase.google.com/docs/llms.txt", type: "llms-txt" },
  anthropic: { label: "Anthropic", url: "https://docs.anthropic.com/llms.txt", type: "llms-txt" },
  openai: { label: "OpenAI", url: "https://platform.openai.com/docs/llms.txt", type: "llms-txt" },
  retool: { label: "Retool", url: "https://docs.retool.com/llms.txt", type: "llms-txt" },
};

export const DOC_SOURCES_DB_TITLE = "DevQuest Doc Sources";

/** Detect a source's format from its URL. Mirrors detectSourceType in
 *  src/docs-parser.ts (the worker) — keep the two in sync. */
export function detectSourceType(url: string): SourceType {
  const lower = url.toLowerCase();
  if (lower.endsWith("llms.txt") || lower.endsWith("llms-full.txt")) return "llms-txt";
  if (lower.endsWith(".json") || lower.endsWith(".yaml") || lower.endsWith(".yml")) return "openapi";
  if (lower.includes("sitemap") && lower.endsWith(".xml")) return "sitemap";
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "markdown";
  return "llms-txt";
}
