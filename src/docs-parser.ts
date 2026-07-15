/**
 * docs-parser.ts
 *
 * Fetch-free, pure parsing/classification logic for developer doc sources.
 * Supports multiple formats: llms.txt, OpenAPI specs, sitemap XML, and
 * raw markdown. Kept side-effect free so it can be unit-tested against
 * fixtures without network access.
 *
 * The heuristics here (category, difficulty, persona tags) are deliberately
 * simple and deterministic — Day 4 of the plan is tuning them.
 */

export const LLMS_TXT_URL = "https://developers.notion.com/llms.txt";

export const CATEGORIES = [
	"Getting Started",
	"Data APIs",
	"Workers",
	"MCP",
	"Agents",
	"Auth",
	"Webhooks",
	"Reference",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * "Relevant For" multi-select options. These map 1:1 to persona values so
 * query_docs (Day 2) can filter the knowledge base by persona attributes.
 */
export const TAGS = [
	// goal
	"internal-tool",
	"public-integration",
	"automation",
	"ai-agent",
	"exploring",
	// language
	"typescript",
	"python",
	"curl",
	// experience
	"beginner",
	"intermediate",
	"advanced",
	// api_comfort: pages that teach REST/auth fundamentals
	"api-basics",
] as const;
export type Tag = (typeof TAGS)[number];

export interface DocEntry {
	title: string;
	/** User-facing page URL (trailing ".md" stripped). Used as the sync primary key. */
	url: string;
	summary: string;
	category: Category;
	difficulty: Difficulty;
	relevantFor: Tag[];
}

/** Supported doc source types for the pluggable doc sources system (v4). */
export const SOURCE_TYPES = ["llms-txt", "openapi", "sitemap", "markdown"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Matches lines like: - [Title](https://…)[: summary] */
const LINE_RE = /^-\s+\[(.+?)\]\((https?:\/\/[^\s)]+)\)(?::\s*(.*))?\s*$/;

export function parseLlmsTxt(text: string): DocEntry[] {
	const entries: DocEntry[] = [];
	const seen = new Set<string>();

	for (const line of text.split("\n")) {
		const match = LINE_RE.exec(line.trim());
		if (!match) continue;

		const title = match[1].trim();
		let url = match[2].trim();
		const summary = (match[3] ?? "").trim();

		// Skip non-doc assets (OpenAPI specs etc.)
		if (url.endsWith(".json")) continue;

		// Link to the human-readable page, not the raw markdown
		if (url.endsWith(".md")) url = url.slice(0, -3);

		// llms.txt occasionally repeats pages; primary key must be unique
		if (seen.has(url)) continue;
		seen.add(url);

		const category = categorize(url, title);
		const difficulty = assignDifficulty(url, title, category);
		const relevantFor = assignTags(url, title, category, difficulty);

		entries.push({ title, url, summary, category, difficulty, relevantFor });
	}

	return entries;
}

/**
 * Generic llms.txt parser for non-Notion doc sources (v4).
 * Same markdown link format as Notion's llms.txt, but no Notion-specific
 * category/difficulty/tag heuristics. All entries get category="Getting Started",
 * difficulty="Intermediate", and empty tags — the agent handles nuance.
 */
export function parseGenericLlmsTxt(text: string): DocEntry[] {
	const entries: DocEntry[] = [];
	const seen = new Set<string>();

	for (const line of text.split("\n")) {
		const match = LINE_RE.exec(line.trim());
		if (!match) continue;

		const title = match[1].trim();
		let url = match[2].trim();
		const summary = (match[3] ?? "").trim();

		if (url.endsWith(".json")) continue;
		if (url.endsWith(".md")) url = url.slice(0, -3);
		if (seen.has(url)) continue;
		seen.add(url);

		entries.push({
			title,
			url,
			summary,
			category: "Getting Started",
			difficulty: "Intermediate",
			relevantFor: [],
		});
	}

	return entries;
}

function pathOf(url: string): string {
	try {
		return new URL(url).pathname.toLowerCase();
	} catch {
		return url.toLowerCase();
	}
}

const AUTH_KEYWORDS = [
	"authentication",
	"authorization",
	"handling-api-keys",
	"create-a-token",
	"refresh-a-token",
	"revoke-token",
	"introspect-token",
	"personal-access-token",
	"capabilities",
];

export function categorize(url: string, title: string): Category {
	const path = pathOf(url);
	const haystack = `${path} ${title.toLowerCase()}`;

	if (path.includes("/workers/") || path.includes("/cli/")) return "Workers";
	if (path.includes("/guides/mcp/")) return "MCP";
	if (path.includes("/guides/agents/")) return "Agents";
	if (path.includes("/reference/webhooks") || haystack.includes("webhook")) return "Webhooks";
	if (AUTH_KEYWORDS.some((k) => haystack.includes(k))) return "Auth";
	// Migration/changelog material is reference for existing connections,
	// not onboarding — keep it out of Getting Started.
	if (haystack.includes("upgrade") || haystack.includes("changelog")) return "Reference";
	if (path.includes("/guides/get-started/")) return "Getting Started";
	if (path.includes("/guides/data-apis/")) return "Data APIs";

	// compliance, link-previews, resources, /reference/, index → Reference
	return "Reference";
}

const BEGINNER_KEYWORDS = [
	"quick-start",
	"quickstart",
	"overview",
	"get-started-with-mcp",
	"internal-connections",
	"working-with-databases",
	"working-with-page-content",
	"working-with-comments",
	"status-codes",
];

const ADVANCED_KEYWORDS = [
	"oauth",
	"marketplace",
	"public-connections",
	"upgrade",
	"versioning",
	"compliance",
	"siem",
	"audit-log",
	"build-mcp-client",
	"sending-larger-files",
	"changes-by-version",
];

/** The API introduction page ("/reference/intro") — exact match to avoid
 *  colliding with "introspect-token". */
function isApiIntro(url: string): boolean {
	return pathOf(url) === "/reference/intro";
}

export function assignDifficulty(url: string, title: string, category: Category): Difficulty {
	const haystack = `${pathOf(url)} ${title.toLowerCase()}`;

	if (ADVANCED_KEYWORDS.some((k) => haystack.includes(k))) return "Advanced";
	if (isApiIntro(url)) return "Beginner";
	if (BEGINNER_KEYWORDS.some((k) => haystack.includes(k))) return "Beginner";
	if (category === "Getting Started") return "Beginner";
	if (category === "Webhooks") return "Advanced";
	return "Intermediate";
}

export function assignTags(
	url: string,
	title: string,
	category: Category,
	difficulty: Difficulty,
): Tag[] {
	const haystack = `${pathOf(url)} ${title.toLowerCase()} ${category.toLowerCase()}`;
	const tags = new Set<Tag>();

	// experience maps directly from difficulty
	tags.add(difficulty.toLowerCase() as Tag);

	// goal
	if (category === "Webhooks" || haystack.includes("automation")) tags.add("automation");
	if (
		haystack.includes("oauth") ||
		haystack.includes("public") ||
		haystack.includes("marketplace") ||
		haystack.includes("token")
	) {
		tags.add("public-integration");
	}
	if (category === "Data APIs" || haystack.includes("internal")) {
		tags.add("internal-tool");
		tags.add("automation");
	}
	if (category === "MCP" || category === "Agents" || category === "Workers") tags.add("ai-agent");
	if (category === "Getting Started" || category === "Reference") tags.add("exploring");

	// language: only tag when clearly language-specific.
	// Untagged = language-agnostic; query_docs treats missing language tags as "any".
	if (category === "Workers") tags.add("typescript"); // Workers are Node/TS
	if (haystack.includes("typescript") || haystack.includes("sdk")) tags.add("typescript");
	if (haystack.includes("python")) tags.add("python");
	if (haystack.includes("postman") || category === "Reference") tags.add("curl");

	// api_comfort: fundamentals worth surfacing when comfort is none/some
	if (
		category === "Auth" ||
		isApiIntro(url) ||
		haystack.includes("quick-start") ||
		haystack.includes("status-codes") ||
		haystack.includes("request-limits")
	) {
		tags.add("api-basics");
	}

	return [...tags];
}

// ---------------------------------------------------------------------------
// OpenAPI spec parser (v4)
// ---------------------------------------------------------------------------

interface OpenApiPath {
	[method: string]: {
		summary?: string;
		description?: string;
		operationId?: string;
		tags?: string[];
	};
}

interface OpenApiSpec {
	info?: { title?: string; description?: string };
	servers?: Array<{ url?: string }>;
	paths?: Record<string, OpenApiPath>;
}

/**
 * Parse an OpenAPI 3.x JSON spec into DocEntry[].
 * Each endpoint becomes a doc entry. The spec's server URL is used as the
 * base URL; if absent, paths are left relative.
 */
export function parseOpenApiSpec(text: string, sourceBaseUrl?: string): DocEntry[] {
	let spec: OpenApiSpec;
	try {
		spec = JSON.parse(text);
	} catch {
		return [];
	}

	const entries: DocEntry[] = [];
	const seen = new Set<string>();
	const baseUrl = sourceBaseUrl?.replace(/\/+$/, "")
		?? spec.servers?.[0]?.url?.replace(/\/+$/, "")
		?? "";

	const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

	for (const [path, methods] of Object.entries(spec.paths ?? {})) {
		for (const method of HTTP_METHODS) {
			const op = methods[method];
			if (!op) continue;

			const title = op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`;
			const url = `${baseUrl}${path}`;
			if (seen.has(url + method)) continue;
			seen.add(url + method);

			const summary = op.description?.slice(0, 200) ?? "";
			const tag = op.tags?.[0]?.toLowerCase() ?? "";

			// Simple heuristic: auth-related endpoints are Auth, webhooks are Webhooks,
			// everything else is Reference (these are API endpoints, not guides).
			let category: Category = "Reference";
			const haystack = `${path} ${title} ${tag}`.toLowerCase();
			if (haystack.includes("auth") || haystack.includes("token") || haystack.includes("oauth")) {
				category = "Auth";
			} else if (haystack.includes("webhook")) {
				category = "Webhooks";
			}

			entries.push({
				title,
				url,
				summary,
				category,
				difficulty: "Intermediate",
				relevantFor: ["api-basics"],
			});
		}
	}

	return entries;
}

// ---------------------------------------------------------------------------
// Sitemap XML parser (v4)
// ---------------------------------------------------------------------------

/**
 * Parse a sitemap.xml (or sitemapindex) into DocEntry[].
 * Extracts <loc> URLs and derives titles from URL path segments.
 * For sitemapindex files, returns the child sitemap URLs as entries
 * (the sync layer would need to fetch each child — kept simple here).
 */
export function parseSitemapXml(text: string): DocEntry[] {
	const entries: DocEntry[] = [];
	const seen = new Set<string>();

	// Extract all <loc>...</loc> values
	const locRe = /<loc>\s*(.*?)\s*<\/loc>/gi;
	let match: RegExpExecArray | null;

	// Detect if this is a sitemapindex (contains <sitemapindex> or child <sitemap> elements)
	const isSitemapIndex = /<sitemapindex/i.test(text);

	while ((match = locRe.exec(text)) !== null) {
		let url = match[1].trim();
		// Unescape XML entities
		url = url.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

		if (seen.has(url)) continue;
		seen.add(url);

		// Skip non-doc URLs (images, assets, etc.)
		if (/\.(png|jpg|jpeg|gif|svg|css|js|woff|ico)$/i.test(url)) continue;

		// Derive a title from the URL path
		const title = titleFromUrl(url);

		entries.push({
			title,
			url,
			summary: isSitemapIndex ? "Sitemap index entry" : "",
			category: "Getting Started",
			difficulty: "Intermediate",
			relevantFor: [],
		});
	}

	return entries;
}

/** Turn a URL path into a readable title: /docs/api/webhooks → "Api Webhooks" */
function titleFromUrl(url: string): string {
	try {
		const pathname = new URL(url).pathname;
		const segments = pathname
			.split("/")
			.filter(Boolean)
			.filter((s) => !["docs", "api", "reference", "guides", "index.html"].includes(s.toLowerCase()));
		if (segments.length === 0) return url;
		return segments
			.map((s) =>
				s
					.replace(/[-_]/g, " ")
					.replace(/\.\w+$/, "") // strip file extension
					.replace(/\b\w/g, (c) => c.toUpperCase()),
			)
			.join(" — ");
	} catch {
		return url;
	}
}

// ---------------------------------------------------------------------------
// Raw markdown parser (v4)
// ---------------------------------------------------------------------------

/**
 * Parse a markdown document into DocEntry[] by splitting on headings.
 * Each heading (## or ###) becomes a separate entry with the text below
 * it as the summary. Useful for READMEs, wiki pages, or single-file docs.
 *
 * @param text     The markdown content
 * @param baseUrl  URL of the original document (used as the entry URL with #anchor)
 */
export function parseMarkdown(text: string, baseUrl: string): DocEntry[] {
	const entries: DocEntry[] = [];
	const lines = text.split("\n");
	const seen = new Set<string>();

	let currentTitle: string | null = null;
	let currentLines: string[] = [];
	let currentAnchor = "";

	function flush() {
		if (!currentTitle) return;
		const summary = currentLines
			.join("\n")
			.trim()
			.slice(0, 300); // cap summary length
		const url = `${baseUrl}#${currentAnchor}`;
		if (!seen.has(url)) {
			seen.add(url);
			entries.push({
				title: currentTitle,
				url,
				summary,
				category: "Getting Started",
				difficulty: "Intermediate",
				relevantFor: [],
			});
		}
	}

	for (const line of lines) {
		const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
		if (headingMatch) {
			flush();
			currentTitle = headingMatch[2].trim();
			currentAnchor = currentTitle
				.toLowerCase()
				.replace(/[^\w\s-]/g, "")
				.replace(/\s+/g, "-");
			currentLines = [];
		} else if (currentTitle) {
			currentLines.push(line);
		}
	}
	flush(); // last section

	return entries;
}

// ---------------------------------------------------------------------------
// Source type detection (v4)
// ---------------------------------------------------------------------------

/**
 * Detect the source type from a URL pattern.
 * Used as a default when the user doesn't specify a type explicitly.
 */
export function detectSourceType(url: string): SourceType {
	const lower = url.toLowerCase();
	if (lower.endsWith("llms.txt") || lower.endsWith("llms-full.txt")) return "llms-txt";
	if (lower.endsWith(".json") || lower.endsWith(".yaml") || lower.endsWith(".yml")) return "openapi";
	if (lower.includes("sitemap") && lower.endsWith(".xml")) return "sitemap";
	if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "markdown";
	// Default: assume llms.txt format (most common for dev docs)
	return "llms-txt";
}

/**
 * Route to the correct parser based on source type.
 * Single entry point for the sync pipeline.
 */
export function parseDocSource(text: string, sourceType: SourceType, sourceUrl: string): DocEntry[] {
	switch (sourceType) {
		case "llms-txt":
			return parseGenericLlmsTxt(text);
		case "openapi":
			return parseOpenApiSpec(text, sourceUrl);
		case "sitemap":
			return parseSitemapXml(text);
		case "markdown":
			return parseMarkdown(text, sourceUrl);
	}
}
