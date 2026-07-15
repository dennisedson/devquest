/**
 * DevQuest — adaptive developer onboarding for Notion's API.
 *
 * Databases (managed): docsKb (docs knowledge base), insightsDb (weekly digests)
 * Syncs: docs_index (daily, llms.txt + custom sources), insights_digest (weekly)
 * Tools:
 *   setup_devquest       one-time: creates the personas database
 *   update_persona       upsert a persona keyed by the developer's name
 *   find_persona         returning-developer lookup (+ what's new since last visit)
 *   query_docs           rank KB docs against a persona
 *   get_starter_code     install + snippet + endpoints per language × goal
 *   verify_first_call    verify first API success, stamp the milestone
 *   create/read/update_guide_page   the living guide (v2)
 *   read_company_context company stack config (v3)
 *   add_doc_source       pluggable external doc sources (v4)
 *   whoami               diagnostic: identity behind the runtime token
 *
 * Design principle: tools for state, AI for reasoning. No branching logic here.
 * The conversational intelligence lives in src/system-prompt.md.
 */

import { Worker } from "@notionhq/workers";
import * as Builder from "@notionhq/workers/builder";
import * as Schema from "@notionhq/workers/schema";
import { j } from "@notionhq/workers/schema-builder";
import {
	CATEGORIES,
	DIFFICULTIES,
	LLMS_TXT_URL,
	TAGS,
	SOURCE_TYPES,
	parseLlmsTxt,
	parseDocSource,
	detectSourceType,
	type DocEntry,
	type SourceType,
} from "./docs-parser.js";
import {
	API_COMFORTS,
	EXPERIENCES,
	GOALS,
	LANGUAGES,
	PERSONA_PROPS,
	PERSONAS_DB_PROPERTIES,
	PERSONAS_DB_TITLE,
	buildPersonaProperties,
	extractNotionId,
	missingFields,
	normalizeUserKey,
	personaFromPage,
	personaIdFromPage,
	type ApiComfort,
	type Experience,
	type Persona,
} from "./persona.js";
import { kbDocFromPage, rankDocs, type KbDoc } from "./query-docs.js";
import { starterCodeFor } from "./starter-code.js";
import { buildDigest, type GuideProgress, type PersonaRecord } from "./insights.js";

const worker = new Worker();
export default worker;

// ---------------------------------------------------------------------------
// Docs knowledge base (managed database, owned by the docs_index sync)
// ---------------------------------------------------------------------------

/** Title used both for the managed DB and for runtime discovery by tools. */
const DOCS_KB_TITLE = "DevQuest Docs Knowledge Base";

const docsKb = worker.database("docsKb", {
	type: "managed",
	initialTitle: DOCS_KB_TITLE,
	primaryKeyProperty: "URL",
	schema: {
		properties: {
			Title: Schema.title(),
			URL: Schema.richText(),
			Link: Schema.url(),
			Category: Schema.select(CATEGORIES.map((name) => ({ name }))),
			Difficulty: Schema.select([
				{ name: DIFFICULTIES[0], color: "green" },
				{ name: DIFFICULTIES[1], color: "yellow" },
				{ name: DIFFICULTIES[2], color: "red" },
			]),
			Summary: Schema.richText(),
			"Relevant For": Schema.multiSelect(TAGS.map((name) => ({ name }))),
			Source: Schema.select([{ name: "Notion", color: "blue" }]),
			"First Seen": Schema.date(),
		},
	},
});

// ---------------------------------------------------------------------------
// docs_index sync — daily, full replace (~160 pages, well under 1k)
// ---------------------------------------------------------------------------

const BATCH_SIZE = 100;

/** Title of the doc-sources config database (v4). */
const DOC_SOURCES_DB_TITLE = "DevQuest Doc Sources";

/**
 * Well-known developer doc sources with URLs and types.
 * Keys are lowercase service names. The agent checks company context for
 * mentions of these and auto-registers any not already in the doc sources DB.
 */
const KNOWN_DOC_SOURCES: Record<string, { url: string; type: SourceType }> = {
	stripe: { url: "https://docs.stripe.com/llms.txt", type: "llms-txt" },
	vercel: { url: "https://vercel.com/docs/llms.txt", type: "llms-txt" },
	hubspot: { url: "https://developers.hubspot.com/docs/llms.txt", type: "llms-txt" },
	cloudflare: { url: "https://developers.cloudflare.com/llms.txt", type: "llms-txt" },
	twilio: { url: "https://www.twilio.com/docs/llms.txt", type: "llms-txt" },
	supabase: { url: "https://supabase.com/docs/llms.txt", type: "llms-txt" },
	firebase: { url: "https://firebase.google.com/docs/llms.txt", type: "llms-txt" },
	anthropic: { url: "https://docs.anthropic.com/llms.txt", type: "llms-txt" },
	openai: { url: "https://platform.openai.com/docs/llms.txt", type: "llms-txt" },
	retool: { url: "https://docs.retool.com/llms.txt", type: "llms-txt" },
};

/** State used by the docs_index sync to paginate across sources.
 *  `seen` persists across sync cycles (v8): url → date the doc first
 *  appeared in the KB, so returning developers can be told what's new. */
interface SyncState {
	/** Index into the flattened entry list. */
	offset: number;
	seen?: Record<string, string>;
}

worker.sync("docs_index", {
	database: docsKb,
	mode: "replace",
	schedule: "1d",
	execute: async (state, { notion }: { notion: NotionClient }) => {
		const offset = (state as SyncState | undefined)?.offset ?? 0;

		// ---- Notion docs (always included) ----
		const response = await fetch(LLMS_TXT_URL);
		if (!response.ok) {
			throw new Error(`Failed to fetch ${LLMS_TXT_URL}: ${response.status} ${response.statusText}`);
		}
		const notionEntries = parseLlmsTxt(await response.text());
		if (notionEntries.length === 0) {
			throw new Error("Parsed 0 entries from llms.txt — format may have changed; aborting to avoid wiping the knowledge base.");
		}

		// ---- Custom doc sources (v4) ----
		const customEntries: Array<DocEntry & { source: string }> = [];
		try {
			const dsResponse = await notion.search({
				query: DOC_SOURCES_DB_TITLE,
				filter: { property: "object", value: "data_source" },
			});
			for (const ds of dsResponse.results) {
				const dsTitle = ds.title?.[0]?.plain_text ?? ds.name ?? "";
				if (dsTitle !== DOC_SOURCES_DB_TITLE) continue;

				// Read all doc source configs
				const rows = await notion.dataSources.query({
					data_source_id: ds.id,
					page_size: 50,
				});

				for (const row of rows.results) {
					const props = (row.properties ?? {}) as Record<
						string,
						{
							title?: Array<{ plain_text?: string }>;
							url?: string | null;
							rich_text?: Array<{ plain_text?: string }>;
							select?: { name?: string } | null;
						}
					>;
					const sourceName =
						props["Source Name"]?.title?.map((t) => t.plain_text ?? "").join("") ?? "";
					const sourceUrl = props["URL"]?.url ?? props["URL"]?.rich_text?.[0]?.plain_text ?? "";
					const sourceType = (props["Type"]?.select?.name as SourceType | undefined)
						?? detectSourceType(sourceUrl);

					if (!sourceName || !sourceUrl) continue;

					try {
						const srcResp = await fetch(sourceUrl);
						if (!srcResp.ok) continue;
						const parsed = parseDocSource(await srcResp.text(), sourceType, sourceUrl);
						for (const entry of parsed) {
							customEntries.push({ ...entry, source: sourceName });
						}
					} catch {
						// Skip sources that fail to fetch — don't break the whole sync
					}
				}
				break;
			}
		} catch {
			// Doc Sources database doesn't exist yet — that's fine, just sync Notion docs
		}

		// ---- Combine and paginate ----
		type TaggedEntry = DocEntry & { source: string };
		const allEntries: TaggedEntry[] = [
			...notionEntries.map((e) => ({ ...e, source: "Notion" })),
			...customEntries,
		];

		// v8: track when each doc first appeared. `seen` persists across sync
		// cycles, so First Seen stays stable instead of resetting every day.
		const seen: Record<string, string> = { ...((state as SyncState | undefined)?.seen ?? {}) };
		const today = new Date().toISOString().slice(0, 10);
		for (const entry of allEntries) {
			if (!seen[entry.url]) seen[entry.url] = today;
		}

		const batch = allEntries.slice(offset, offset + BATCH_SIZE);
		const hasMore = offset + BATCH_SIZE < allEntries.length;

		return {
			changes: batch.map((entry) => ({
				type: "upsert" as const,
				key: entry.url,
				properties: {
					Title: Builder.title(entry.title),
					URL: Builder.richText(entry.url),
					Link: Builder.url(entry.url),
					Category: Builder.select(entry.category),
					Difficulty: Builder.select(entry.difficulty),
					Summary: Builder.richText(entry.summary),
					"Relevant For": Builder.multiSelect(...entry.relevantFor),
					Source: Builder.select(entry.source),
					"First Seen": Builder.date(seen[entry.url] ?? today),
				},
			})),
			hasMore,
			// Always return nextState so `seen` persists into the next cycle
			nextState: hasMore ? { offset: offset + BATCH_SIZE, seen } : { offset: 0, seen },
		};
	},
});

// ---------------------------------------------------------------------------
// Shared helpers for tools
// ---------------------------------------------------------------------------

/** Notion client injected into tool execute() — typed loosely; the platform
 *  provides pages.create/update/retrieve, databases.create/retrieve,
 *  dataSources.query, and search (2025-09-03 SDK v5). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NotionClient = any;

/** The slice of a Notion query response we rely on. */
interface QueryResponse {
	results: Array<{ id: string; properties?: unknown }>;
	has_more?: boolean;
	next_cursor?: string | null;
}

// ---------------------------------------------------------------------------
// Database discovery — find databases by title at runtime, no env vars needed.
// 2025-09-03 API: search returns data_source objects with IDs we can query.
// ---------------------------------------------------------------------------

/** Search for a data source by its parent database title.
 *  Returns the first matching data source ID. */
async function findDataSource(notion: NotionClient, title: string): Promise<string> {
	const response = await notion.search({
		query: title,
		filter: { property: "object", value: "data_source" },
	});
	for (const result of response.results) {
		// Match by title (search is fuzzy, so verify exact match)
		const resultTitle =
			result.title?.[0]?.plain_text ?? result.name ?? "";
		if (resultTitle === title) return result.id;
	}
	throw new Error(
		`Could not find a data source named "${title}". ` +
		(title === PERSONAS_DB_TITLE
			? "Run the setup_devquest tool first."
			: "Make sure the docs_index sync has run at least once."),
	);
}

/** Query a data source found by title. */
async function queryByTitle(
	notion: NotionClient,
	title: string,
	body: Record<string, unknown>,
): Promise<QueryResponse> {
	const dsId = await findDataSource(notion, title);
	return notion.dataSources.query({ data_source_id: dsId, ...body });
}

/**
 * Find a persona page by its Persona ID title.
 *
 * persona_id is the developer's name (supplied by the agent from conversation
 * context), so matching is normalized in code — "Dennis Edson", "dennis edson",
 * and "Dennis  Edson" all resolve to the same record. Notion's title filter is
 * not reliably case-insensitive, and the personas DB is small, so we scan.
 */
async function findPersonaPage(notion: NotionClient, personaId: string) {
	const wanted = normalizeUserKey(personaId);
	let cursor: string | undefined = undefined;
	do {
		const response: QueryResponse = await queryByTitle(notion, PERSONAS_DB_TITLE, {
			page_size: 100,
			...(cursor ? { start_cursor: cursor } : {}),
		});
		for (const page of response.results) {
			const title = personaIdFromPage(page);
			if (title && normalizeUserKey(title) === wanted) return page;
		}
		cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
	} while (cursor);
	return null;
}

/** Get the personas database ID (for creating pages). */
async function getPersonasDbId(notion: NotionClient): Promise<string> {
	const dsId = await findDataSource(notion, PERSONAS_DB_TITLE);
	const ds = await notion.dataSources.retrieve({ data_source_id: dsId });
	return ds.parent?.database_id ?? dsId;
}

/** Fetch every row of the docs knowledge base (~160 records). */
async function fetchAllKbDocs(notion: NotionClient) {
	const dsId = await findDataSource(notion, DOCS_KB_TITLE);
	const docs = [];
	let cursor: string | undefined = undefined;
	do {
		const response: QueryResponse = await notion.dataSources.query({
			data_source_id: dsId,
			page_size: 100,
			...(cursor ? { start_cursor: cursor } : {}),
		});
		docs.push(...response.results.map(kbDocFromPage));
		cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
	} while (cursor);
	return docs;
}

// ---------------------------------------------------------------------------
// Tool: setup_devquest — one-time creation of the personas database
// ---------------------------------------------------------------------------

worker.tool("setup_devquest", {
	title: "Set Up DevQuest",
	description:
		"One-time setup: creates the DevQuest Personas database under a parent page. " +
		"Run once per workspace. Tools discover it by title automatically — no env vars needed.",
	schema: j.object({
		parent_page: j
			.string()
			.describe("URL or ID of the Notion page the personas database should be created under."),
	}),
	execute: async ({ parent_page }, { notion }: { notion: NotionClient }) => {
		const pageId = extractNotionId(parent_page);
		const title = [{ type: "text", text: { content: PERSONAS_DB_TITLE } }];

		// 2025-09-03 API: properties live under initial_data_source
		const database = await notion.databases.create({
			parent: { type: "page_id", page_id: pageId },
			title,
			initial_data_source: { properties: PERSONAS_DB_PROPERTIES },
		});

		return {
			database_id: database.id,
			message: `Created "${PERSONAS_DB_TITLE}" database. Tools will discover it automatically by title.`,
		};
	},
});

// ---------------------------------------------------------------------------
// Tool: update_persona — create or patch a persona (partial updates welcome)
// ---------------------------------------------------------------------------

worker.tool("update_persona", {
	title: "Update Developer Persona",
	description:
		"Create or update the developer's persona record. Call this as soon as you learn any persona " +
		"field through conversation — pass only the fields you learned, set the rest to null. " +
		"persona_id is the developer's first and last name; the record is created automatically if " +
		"it does not exist yet (upsert).",
	schema: j.object({
		persona_id: j
			.string()
			.describe(
				"The developer's first and last name (e.g. 'Dennis Edson'). You know who you are " +
				"speaking with — pass their name here on every call. Matching is case-insensitive.",
			),
		goal: j
			.enum(...GOALS)
			.describe("What the developer wants to build.")
			.nullable(),
		language: j
			.enum(...LANGUAGES)
			.describe("The developer's primary language.")
			.nullable(),
		experience: j
			.enum(...EXPERIENCES)
			.describe("Overall software development experience.")
			.nullable(),
		api_comfort: j
			.enum(...API_COMFORTS)
			.describe("Familiarity with REST APIs and auth concepts.")
			.nullable(),
	}),
	outputSchema: j.object({
		persona_id: j.string().describe("The persona record ID. Use in all subsequent tool calls."),
		persona: j.object({
			goal: j.string().nullable(),
			language: j.string().nullable(),
			experience: j.string().nullable(),
			api_comfort: j.string().nullable(),
		}),
		missing_fields: j
			.array(j.string())
			.describe(
				"Persona fields not yet learned. If non-empty, end your reply with ONE question that " +
				"fills one of these. If empty, call create_guide_page now (unless a guide already exists).",
			),
	}),
	execute: async (input, { notion }: { notion: NotionClient }) => {
		const update: Partial<Persona> = {
			goal: input.goal,
			language: input.language,
			experience: input.experience,
			api_comfort: input.api_comfort,
		};
		const personaId = input.persona_id.trim();
		if (!personaId) throw new Error("persona_id (the developer's name) must not be empty.");

		// Upsert: update the existing record for this developer, or create one.
		const existing = await findPersonaPage(notion, personaId);
		let page: { id: string; properties?: unknown };
		if (existing) {
			page = await notion.pages.update({
				page_id: existing.id,
				properties: buildPersonaProperties(update),
			});
		} else {
			const dbId = await getPersonasDbId(notion);
			page = await notion.pages.create({
				parent: { database_id: dbId },
				// Preserve the display capitalization the agent passed
				properties: buildPersonaProperties(update, { personaId }),
			});
		}

		const persona = personaFromPage(page);
		return {
			persona_id: personaIdFromPage(page) ?? personaId,
			persona,
			missing_fields: missingFields(persona),
		};
	},
});

// ---------------------------------------------------------------------------
// Tool: find_persona — returning-developer lookup
// ---------------------------------------------------------------------------

worker.tool("find_persona", {
	title: "Find Returning Developer",
	description:
		"Look up a developer's persona by name. Call this once at the start of every conversation, " +
		"passing the current developer's first and last name as persona_id — you know who you are " +
		"speaking with. If found=true, greet them by context; if found=false, this developer is new " +
		"(even if others have used DevQuest) — start fresh.",
	schema: j.object({
		persona_id: j
			.string()
			.describe("The developer's first and last name (e.g. 'Dennis Edson'). Case-insensitive."),
	}),
	outputSchema: j.object({
		found: j.boolean(),
		persona_id: j.string().nullable(),
		persona: j
			.object({
				goal: j.string().nullable(),
				language: j.string().nullable(),
				experience: j.string().nullable(),
				api_comfort: j.string().nullable(),
			})
			.nullable(),
		missing_fields: j.array(j.string()),
		whats_new: j
			.array(
				j.object({
					title: j.string(),
					url: j.string(),
					summary: j.string(),
				}),
			)
			.describe("Docs added to the knowledge base since this developer's last visit, ranked by relevance to their persona. Mention the interesting ones in your greeting."),
	}),
	hints: { readOnlyHint: true },
	execute: async ({ persona_id }, { notion }: { notion: NotionClient }) => {
		const notFound = { found: false, persona_id: null, persona: null, missing_fields: [], whats_new: [] };

		let page;
		try {
			page = await findPersonaPage(notion, persona_id);
		} catch {
			// Personas database doesn't exist yet (setup_devquest not run) —
			// treat as "no returning developer" rather than erroring the conversation.
			return notFound;
		}
		// A miss means THIS developer is new — never return someone else's persona.
		if (!page) return notFound;

		const persona = personaFromPage(page);

		// v8: docs that appeared since their last visit (persona pages are
		// touched every conversation, so last_edited_time ≈ last visit).
		let whatsNew: Array<{ title: string; url: string; summary: string }> = [];
		const lastVisit = (page as { last_edited_time?: string }).last_edited_time;
		if (lastVisit) {
			try {
				const docs = await fetchAllKbDocs(notion);
				const fresh = docs.filter((d) => d.firstSeen && d.firstSeen > lastVisit.slice(0, 10));
				whatsNew = rankDocs(fresh, persona, { maxResults: 5 }).map((d) => ({
					title: d.title,
					url: d.url,
					summary: d.summary,
				}));
			} catch {
				// KB unavailable — skip what's-new rather than failing the greeting
			}
		}

		return {
			found: true,
			persona_id: personaIdFromPage(page),
			persona,
			missing_fields: missingFields(persona),
			whats_new: whatsNew,
		};
	},
});

// ---------------------------------------------------------------------------
// Tool: whoami — diagnostic: what identity does the runtime token carry?
// ---------------------------------------------------------------------------

worker.tool("whoami", {
	title: "Who Am I (diagnostic)",
	description:
		"Diagnostic only: reports the bot user and owner behind the runtime's Notion token. " +
		"Used to investigate whether tool calls can identify the current developer automatically.",
	schema: j.object({}),
	hints: { readOnlyHint: true },
	execute: async (_input, { notion }: { notion: NotionClient }) => {
		const me = await notion.users.me({});
		return {
			bot_user_id: me?.id ?? null,
			bot_name: me?.name ?? null,
			owner: me?.bot?.owner ?? null,
			workspace_name: me?.bot?.workspace_name ?? null,
		};
	},
});

// ---------------------------------------------------------------------------
// Tool: query_docs — rank knowledge-base docs against a persona
// ---------------------------------------------------------------------------

worker.tool("query_docs", {
	title: "Query Docs Knowledge Base",
	description:
		"Return the documentation pages most relevant to a developer persona, ranked. Use this to " +
		"ground recommendations in real docs once you know 2+ persona fields. Optionally narrow to " +
		"one category.",
	schema: j.object({
		persona_id: j.string().describe("The persona to match docs against."),
		category: j
			.enum(...CATEGORIES)
			.describe("Optional: restrict results to one category.")
			.nullable(),
		max_results: j.number().describe("Maximum results to return. Default 10.").nullable(),
	}),
	outputSchema: j.object({
		persona: j.object({
			goal: j.string().nullable(),
			language: j.string().nullable(),
			experience: j.string().nullable(),
			api_comfort: j.string().nullable(),
		}),
		results: j.array(
			j.object({
				title: j.string(),
				url: j.string(),
				summary: j.string(),
				category: j.string().nullable(),
				difficulty: j.string().nullable(),
			}),
		),
	}),
	hints: { readOnlyHint: true },
	execute: async ({ persona_id, category, max_results }, { notion }: { notion: NotionClient }) => {
		const page = await findPersonaPage(notion, persona_id);
		if (!page) throw new Error(`No persona found with ID ${persona_id}.`);
		const persona = personaFromPage(page);

		const docs = await fetchAllKbDocs(notion);
		const ranked = rankDocs(docs, persona, { category, maxResults: max_results });

		return {
			persona,
			results: ranked.map(({ title, url, summary, category: cat, difficulty }) => ({
				title,
				url,
				summary,
				category: cat,
				difficulty,
			})),
		};
	},
});

// ---------------------------------------------------------------------------
// Guide ingredients — pure helpers used by the guide-page tools
// ---------------------------------------------------------------------------

/** Group ranked docs by category for the guide payload. */
function groupByCategory(docs: KbDoc[]): Array<{ category: string; docs: Array<{ title: string; url: string; summary: string }> }> {
	const groups = new Map<string, Array<{ title: string; url: string; summary: string }>>();
	for (const d of docs) {
		const cat = d.category ?? "Other";
		if (!groups.has(cat)) groups.set(cat, []);
		groups.get(cat)!.push({ title: d.title, url: d.url, summary: d.summary });
	}
	return [...groups].map(([category, items]) => ({ category, docs: items }));
}

/** Suggest a first project based on the persona's goal. */
function suggestProject(persona: Persona): string {
	switch (persona.goal) {
		case "internal-tool":
			return "Build a team task tracker that syncs a Notion database with your project management workflow.";
		case "public-integration":
			return "Create a public integration that lets users connect their Notion workspace to your app via OAuth.";
		case "automation":
			return "Set up a Worker that syncs data from an external service into a Notion database on a schedule.";
		case "ai-agent":
			return "Build a Custom Agent with Worker tools that answers questions using your team's Notion knowledge base.";
		case "exploring":
			return "Create a personal reading list database and a Worker that auto-imports bookmarks from an RSS feed.";
		default:
			return "Pick a workflow you do manually in Notion today and automate one step of it with the API.";
	}
}

// ---------------------------------------------------------------------------
// Tool: get_starter_code (v7) — persona-aware install + snippet + endpoints
// ---------------------------------------------------------------------------

worker.tool("get_starter_code", {
	title: "Get Starter Code",
	description:
		"Return install command, a runnable first snippet, and key endpoints tailored to the " +
		"developer's language and goal. Use it to show code in chat before the guide page exists, " +
		"or when the developer asks how to get started in code. The snippet creates a page titled " +
		"'My first Notion API page' — afterwards, verify it with verify_first_call.",
	schema: j.object({
		persona_id: j.string().describe("The developer's name (persona key)."),
	}),
	outputSchema: j.object({
		sdk_install: j.string(),
		snippet_language: j.string(),
		snippet: j.string(),
		key_endpoints: j.array(
			j.object({
				method: j.string(),
				path: j.string(),
				description: j.string(),
			}),
		),
	}),
	hints: { readOnlyHint: true },
	execute: async ({ persona_id }, { notion }: { notion: NotionClient }) => {
		const page = await findPersonaPage(notion, persona_id);
		if (!page) throw new Error(`No persona found with ID ${persona_id}.`);
		const persona = personaFromPage(page);
		const starter = starterCodeFor(persona);
		if (!starter) {
			throw new Error("The persona has no language set yet — learn their language first.");
		}
		return starter;
	},
});

// ---------------------------------------------------------------------------
// Tool: verify_first_call (v6) — time to first success
// ---------------------------------------------------------------------------

worker.tool("verify_first_call", {
	title: "Verify First API Call",
	description:
		"Verify the developer's first successful API call. When they say they ran the starter " +
		"snippet (or made any API call that created a page), ask for the created page's URL and " +
		"pass it here. Confirms the page exists, stamps the First Success milestone on their " +
		"persona, and returns their time-to-first-success. Celebrate the result!",
	schema: j.object({
		persona_id: j.string().describe("The developer's name (persona key)."),
		page_url: j.string().describe("URL (or ID) of the page the developer created via the API."),
	}),
	outputSchema: j.object({
		verified: j.boolean(),
		page_title: j.string().nullable(),
		created_time: j.string().nullable(),
		time_to_first_success_hours: j
			.number()
			.nullable()
			.describe("Hours between persona creation and the verified call."),
		already_verified: j.boolean(),
	}),
	execute: async ({ persona_id, page_url }, { notion }: { notion: NotionClient }) => {
		const personaPage = await findPersonaPage(notion, persona_id);
		if (!personaPage) throw new Error(`No persona found with ID ${persona_id}.`);

		// 1. Verify the page actually exists (this IS the proof of a working call)
		const pageId = extractNotionId(page_url);
		const created = await notion.pages.retrieve({ page_id: pageId });

		const titleProp = Object.values(
			(created.properties ?? {}) as Record<string, { type?: string; title?: Array<{ plain_text?: string }> }>,
		).find((p) => p.type === "title");
		const pageTitle = titleProp?.title?.map((t) => t.plain_text ?? "").join("") ?? null;
		const createdTime: string | null = created.created_time ?? null;

		// 2. Check whether the milestone was already logged
		const existingProps = (personaPage.properties ?? {}) as Record<
			string,
			{ date?: { start?: string | null } | null }
		>;
		const alreadyVerified = Boolean(existingProps[PERSONA_PROPS.first_success]?.date?.start);

		// 3. Stamp the milestone (best-effort schema migration for older installs)
		const successDate = (createdTime ?? new Date().toISOString()).slice(0, 10);
		if (!alreadyVerified) {
			const dbId = await getPersonasDbId(notion);
			await ensureDbProperties(notion, dbId, {
				[PERSONA_PROPS.first_success]: { date: {} },
			});
			await notion.pages.update({
				page_id: personaPage.id,
				properties: {
					[PERSONA_PROPS.first_success]: { date: { start: successDate } },
				},
			});
		}

		// 4. Time to first success: persona created → page created
		const personaCreated = (personaPage as { created_time?: string }).created_time;
		let hours: number | null = null;
		if (personaCreated && createdTime) {
			hours =
				Math.round(
					((new Date(createdTime).getTime() - new Date(personaCreated).getTime()) / 36e5) * 10,
				) / 10;
			if (hours < 0) hours = 0;
		}

		return {
			verified: true,
			page_title: pageTitle,
			created_time: createdTime,
			time_to_first_success_hours: hours,
			already_verified: alreadyVerified,
		};
	},
});

// ---------------------------------------------------------------------------
// v2 — Living Guide Page tools
// ---------------------------------------------------------------------------

/** Rich-text shorthand. */
function text(content: string, opts?: { bold?: boolean; link?: string }) {
	const rt: Record<string, unknown> = {
		type: "text",
		text: { content, ...(opts?.link ? { link: { url: opts.link } } : {}) },
	};
	if (opts?.bold) rt.annotations = { bold: true };
	return rt;
}

type GuideLevel = "getting-started" | "going-deeper" | "advanced-patterns";

function guideLevel(persona: Persona): GuideLevel {
	if (persona.experience === "advanced" || persona.api_comfort === "fluent") return "advanced-patterns";
	if (persona.experience === "intermediate" || persona.api_comfort === "some") return "going-deeper";
	return "getting-started";
}

/** Build the Notion blocks for a guide page. */
function buildGuideBlocks(
	persona: Persona,
	docs: KbDoc[],
	project: string,
	sessionNote: string,
) {
	const grouped = groupByCategory(docs);
	const now = new Date().toISOString().slice(0, 10);

	const blocks: Record<string, unknown>[] = [
		// --- Persona callout ---
		{
			type: "callout",
			callout: {
				rich_text: [
					text("Goal: ", { bold: true }),
					text(`${persona.goal ?? "—"}  ·  `),
					text("Language: ", { bold: true }),
					text(`${persona.language ?? "—"}  ·  `),
					text("Experience: ", { bold: true }),
					text(`${persona.experience ?? "—"}  ·  `),
					text("API Comfort: ", { bold: true }),
					text(persona.api_comfort ?? "—"),
				],
				icon: { type: "emoji", emoji: "🧑‍💻" },
				color: "blue_background",
			},
		},
		{ type: "divider", divider: {} },

		// --- Reading path ---
		{
			type: "heading_2",
			heading_2: {
				rich_text: [text("📚 Your Reading Path")],
				color: "default",
			},
		},
	];

	for (const group of grouped) {
		blocks.push({
			type: "heading_3",
			heading_3: {
				rich_text: [text(group.category)],
				color: "default",
			},
		});
		for (const doc of group.docs) {
			blocks.push({
				type: "to_do",
				to_do: {
					rich_text: [
						text(doc.title, { bold: true, link: doc.url }),
						text(` — ${doc.summary}`),
					],
					checked: false,
					color: "default",
				},
			});
		}
	}

	// --- Progressive sections based on level ---
	const level = guideLevel(persona);

	if (level === "going-deeper" || level === "advanced-patterns") {
		blocks.push(
			{ type: "divider", divider: {} },
			{
				type: "heading_2",
				heading_2: {
					rich_text: [text("🔬 Going Deeper")],
					color: "default",
				},
			},
			{
				type: "paragraph",
				paragraph: {
					rich_text: [text("You've moved past the basics. These areas will deepen your understanding:")],
					color: "default",
				},
			},
			{
				type: "bulleted_list_item",
				bulleted_list_item: {
					rich_text: [text("Explore advanced query filters and database sorting")],
					color: "default",
				},
			},
			{
				type: "bulleted_list_item",
				bulleted_list_item: {
					rich_text: [text("Learn about pagination and rate limiting strategies")],
					color: "default",
				},
			},
			{
				type: "bulleted_list_item",
				bulleted_list_item: {
					rich_text: [text("Set up webhooks for real-time updates")],
					color: "default",
				},
			},
		);
	}

	if (level === "advanced-patterns") {
		blocks.push(
			{ type: "divider", divider: {} },
			{
				type: "heading_2",
				heading_2: {
					rich_text: [text("🏗️ Advanced Patterns")],
					color: "default",
				},
			},
			{
				type: "paragraph",
				paragraph: {
					rich_text: [text("You're ready for production-grade patterns:")],
					color: "default",
				},
			},
			{
				type: "bulleted_list_item",
				bulleted_list_item: {
					rich_text: [text("Build a sync pipeline with Workers for bi-directional data flow")],
					color: "default",
				},
			},
			{
				type: "bulleted_list_item",
				bulleted_list_item: {
					rich_text: [text("Implement OAuth for a public integration with token refresh")],
					color: "default",
				},
			},
			{
				type: "bulleted_list_item",
				bulleted_list_item: {
					rich_text: [text("Design error handling and retry strategies for production reliability")],
					color: "default",
				},
			},
		);
	}

	// --- First project ---
	blocks.push(
		{ type: "divider", divider: {} },
		{
			type: "heading_2",
			heading_2: {
				rich_text: [text("🚀 Your First Project")],
				color: "default",
			},
		},
		{
			type: "paragraph",
			paragraph: {
				rich_text: [text(project)],
				color: "default",
			},
		},
	);

	// --- Milestones timeline ---
	blocks.push(
		{ type: "divider", divider: {} },
		{
			type: "heading_2",
			heading_2: {
				rich_text: [text("🏆 Milestones")],
				color: "default",
			},
		},
		{
			type: "to_do",
			to_do: {
				rich_text: [text("Complete the Getting Started reading path")],
				checked: false,
				color: "default",
			},
		},
		{
			type: "to_do",
			to_do: {
				rich_text: [text("Run your first API call")],
				checked: false,
				color: "default",
			},
		},
		{
			type: "to_do",
			to_do: {
				rich_text: [text("Build your first project")],
				checked: false,
				color: "default",
			},
		},
		{
			type: "to_do",
			to_do: {
				rich_text: [text("Level up to intermediate")],
				checked: false,
				color: "default",
			},
		},
		{
			type: "to_do",
			to_do: {
				rich_text: [text("Ship something to production")],
				checked: false,
				color: "default",
			},
		},
	);

	// --- Start coding (v7: persona-aware starter code) ---
	const starter = starterCodeFor(persona);
	if (starter) {
		blocks.push(
			{ type: "divider", divider: {} },
			{
				type: "heading_2",
				heading_2: {
					rich_text: [text("⚡ Start Coding")],
					color: "default",
				},
			},
			{
				type: "code",
				code: {
					rich_text: [text(starter.sdk_install)],
					language: "shell",
				},
			},
			{
				type: "code",
				code: {
					rich_text: [text(starter.snippet)],
					language: starter.snippet_language,
				},
			},
			{
				type: "paragraph",
				paragraph: {
					rich_text: [
						text("When this runs, paste the created page URL back to DevQuest — ", {}),
						text("we'll verify your first API call and log the milestone. 🏁", {}),
					],
					color: "default",
				},
			},
			{
				type: "heading_3",
				heading_3: {
					rich_text: [text("Key endpoints for your goal")],
					color: "default",
				},
			},
		);
		for (const ep of starter.key_endpoints) {
			blocks.push({
				type: "bulleted_list_item",
				bulleted_list_item: {
					rich_text: [
						text(`${ep.method} ${ep.path}`, { bold: true }),
						text(` — ${ep.description}`),
					],
					color: "default",
				},
			});
		}
	}

	// --- Session log ---
	blocks.push(
		{ type: "divider", divider: {} },
		{
			type: "heading_2",
			heading_2: {
				rich_text: [text("📝 Session Log")],
				color: "default",
			},
		},
		{
			type: "toggle",
			toggle: {
				rich_text: [text(`${now} — Initial assessment`)],
				color: "default",
				children: [
					{
						type: "paragraph",
						paragraph: {
							rich_text: [text(sessionNote)],
							color: "default",
						},
					},
				],
			},
		},
	);

	return blocks;
}

/**
 * Ensure a database has the expected properties, adding any that are missing.
 * Idempotent — existing properties are left untouched, new ones are added.
 * Silently catches errors so callers don't break on permission issues.
 */
async function ensureDbProperties(
	notion: NotionClient,
	dbId: string,
	required: Record<string, Record<string, unknown>>,
) {
	try {
		const db = await notion.databases.retrieve({ database_id: dbId });
		const existing = new Set(Object.keys(db.properties ?? {}));
		const missing: Record<string, Record<string, unknown>> = {};
		for (const [name, def] of Object.entries(required)) {
			if (!existing.has(name)) missing[name] = def;
		}
		if (Object.keys(missing).length === 0) return; // all present
		await notion.databases.update({ database_id: dbId, properties: missing });
	} catch {
		// Best-effort — don't crash the caller if we can't migrate
	}
}

/** Read the guide page ID from a persona page (v2). */
function guidePageIdFromPage(page: { properties?: unknown }): string | null {
	const props = (page.properties ?? {}) as Record<
		string,
		{ rich_text?: Array<{ plain_text?: string }> }
	>;
	return props[PERSONA_PROPS.guide_page_id]?.rich_text?.[0]?.plain_text ?? null;
}

async function getGuideProgress(notion: NotionClient, guidePageId: string): Promise<{ total: number; completed: number }> {
	const blocks: Array<Record<string, unknown>> = [];
	let cursor: string | undefined;
	do {
		const resp = await notion.blocks.children.list({
			block_id: guidePageId,
			page_size: 100,
			...(cursor ? { start_cursor: cursor } : {}),
		});
		blocks.push(...resp.results);
		cursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined;
	} while (cursor);

	let total = 0;
	let completed = 0;
	for (const block of blocks) {
		if ((block as { type?: string }).type === "to_do") {
			total++;
			if ((block as { to_do: { checked: boolean } }).to_do.checked) completed++;
		}
	}
	return { total, completed };
}

/** Level progression: beginner → intermediate → advanced */
const LEVEL_ORDER: Experience[] = ["beginner", "intermediate", "advanced"];
const COMFORT_ORDER: ApiComfort[] = ["none", "some", "fluent"];

interface LevelUpResult {
	leveled_up: boolean;
	field: "experience" | "api_comfort" | null;
	old_value: string | null;
	new_value: string | null;
}

function checkLevelUp(
	persona: Persona,
	progress: { total: number; completed: number },
): LevelUpResult {
	// Level up when ≥70% of reading path is completed
	const completionRate = progress.total > 0 ? progress.completed / progress.total : 0;
	if (completionRate < 0.7) return { leveled_up: false, field: null, old_value: null, new_value: null };

	// Try api_comfort first (more specific), then experience
	if (persona.api_comfort && persona.api_comfort !== "fluent") {
		const idx = COMFORT_ORDER.indexOf(persona.api_comfort);
		if (idx >= 0 && idx < COMFORT_ORDER.length - 1) {
			return { leveled_up: true, field: "api_comfort", old_value: persona.api_comfort, new_value: COMFORT_ORDER[idx + 1] };
		}
	}
	if (persona.experience && persona.experience !== "advanced") {
		const idx = LEVEL_ORDER.indexOf(persona.experience);
		if (idx >= 0 && idx < LEVEL_ORDER.length - 1) {
			return { leveled_up: true, field: "experience", old_value: persona.experience, new_value: LEVEL_ORDER[idx + 1] };
		}
	}
	return { leveled_up: false, field: null, old_value: null, new_value: null };
}

// --- create_guide_page ---

worker.tool("create_guide_page", {
	title: "Create Living Guide Page",
	description:
		"Create a persistent Notion page with the developer's personalized guide: persona callout, " +
		"reading path as checkable to-dos, a suggested first project, and a session log. " +
		"Call this once all four persona fields are set. Returns the page URL.",
	schema: j.object({
		persona_id: j.string().describe("The persona to generate a guide page for."),
		parent_page: j
			.string()
			.describe("Notion page URL or ID to create the guide under. Uses the persona page's parent if omitted.")
			.nullable(),
		session_note: j
			.string()
			.describe("A brief note about this session to start the conversation log (e.g., 'Developer wants to build an internal task tracker with Python').")
			.nullable(),
	}),
	outputSchema: j.object({
		guide_page_id: j.string(),
		guide_page_url: j.string(),
		persona_id: j.string(),
		reading_path_count: j.number(),
	}),
	execute: async ({ persona_id, parent_page, session_note }, { notion }: { notion: NotionClient }) => {
		// 1. Look up the persona
		const personaPage = await findPersonaPage(notion, persona_id);
		if (!personaPage) throw new Error(`No persona found with ID ${persona_id}.`);
		const persona = personaFromPage(personaPage);

		const missing = missingFields(persona);
		if (missing.length > 0) {
			throw new Error(`Persona is incomplete — missing: ${missing.join(", ")}. Fill all fields first.`);
		}

		// 2. Check for existing guide page
		const existingGuideId = guidePageIdFromPage(personaPage);
		if (existingGuideId) {
			throw new Error(
				`This persona already has a guide page (${existingGuideId}). ` +
				"Use update_guide_page to modify it, or create a new persona for a fresh guide.",
			);
		}

		// 3. Rank docs and build blocks
		const allDocs = await fetchAllKbDocs(notion);
		const ranked = rankDocs(allDocs, persona, { maxResults: 15 });
		const project = suggestProject(persona);
		const note = session_note ?? `Created persona. Goal: ${persona.goal}, Language: ${persona.language}.`;
		const blocks = buildGuideBlocks(persona, ranked, project, note);

		// 4. Determine parent page
		let parentId: string;
		if (parent_page) {
			parentId = extractNotionId(parent_page);
		} else {
			// Use the persona page's parent database's parent page
			const dbId = await getPersonasDbId(notion);
			const db = await notion.databases.retrieve({ database_id: dbId });
			parentId = db.parent?.page_id ?? db.parent?.workspace ?? dbId;
		}

		// 5. Create the guide page
		const title = `DevQuest Guide — ${persona.goal} with ${persona.language}`;
		const guidePage = await notion.pages.create({
			parent: { page_id: parentId },
			icon: { type: "emoji", emoji: "🗺️" },
			properties: {
				title: { title: [{ text: { content: title } }] },
			},
			children: blocks,
		});

		// 6. Link the guide page back to the persona record (best-effort —
		//    the guide page is already created, so we return it even if linking fails)
		try {
			const dbId = await getPersonasDbId(notion);
			await ensureDbProperties(notion, dbId, {
				[PERSONA_PROPS.guide_page_id]: { rich_text: {} },
			});
			await notion.pages.update({
				page_id: personaPage.id,
				properties: {
					[PERSONA_PROPS.guide_page_id]: {
						rich_text: [{ text: { content: guidePage.id } }],
					},
				},
			});
		} catch {
			// Property linking failed (e.g., database created before v2).
			// Guide page is still usable — the agent just won't auto-detect it
			// on the next visit. The user can re-run setup_devquest to fix.
		}

		return {
			guide_page_id: guidePage.id,
			guide_page_url: guidePage.url ?? `https://notion.so/${guidePage.id.replace(/-/g, "")}`,
			persona_id,
			reading_path_count: ranked.length,
		};
	},
});

// --- read_guide_page ---

worker.tool("read_guide_page", {
	title: "Read Guide Page State",
	description:
		"Read the current state of a developer's living guide page — which reading path items are " +
		"checked, how many remain, and the session log. Use this on return visits to understand " +
		"where the developer left off.",
	schema: j.object({
		persona_id: j.string().describe("The persona whose guide page to read."),
	}),
	outputSchema: j.object({
		guide_page_id: j.string(),
		persona: j.object({
			goal: j.string().nullable(),
			language: j.string().nullable(),
			experience: j.string().nullable(),
			api_comfort: j.string().nullable(),
		}),
		reading_path: j.array(
			j.object({
				title: j.string(),
				checked: j.boolean(),
				block_id: j.string(),
			}),
		),
		progress: j.object({
			total: j.number(),
			completed: j.number(),
		}),
		session_log: j.array(
			j.object({
				heading: j.string(),
				block_id: j.string(),
			}),
		),
		level_up: j.object({
			leveled_up: j.boolean(),
			field: j.string().nullable(),
			old_value: j.string().nullable(),
			new_value: j.string().nullable(),
		}),
		guide_level: j.string(),
	}),
	hints: { readOnlyHint: true },
	execute: async ({ persona_id }, { notion }: { notion: NotionClient }) => {
		const personaPage = await findPersonaPage(notion, persona_id);
		if (!personaPage) throw new Error(`No persona found with ID ${persona_id}.`);
		const persona = personaFromPage(personaPage);

		const guidePageId = guidePageIdFromPage(personaPage);
		if (!guidePageId) {
			throw new Error("No guide page exists for this persona. Call create_guide_page first.");
		}

		// Read all blocks from the guide page
		const allBlocks: Array<Record<string, unknown>> = [];
		let cursor: string | undefined;
		do {
			const resp = await notion.blocks.children.list({
				block_id: guidePageId,
				page_size: 100,
				...(cursor ? { start_cursor: cursor } : {}),
			});
			allBlocks.push(...resp.results);
			cursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined;
		} while (cursor);

		// Parse to-do items (reading path)
		const readingPath: Array<{ title: string; checked: boolean; block_id: string }> = [];
		for (const block of allBlocks) {
			if ((block as { type?: string }).type === "to_do") {
				const td = (block as { to_do: { rich_text: Array<{ plain_text?: string }>; checked: boolean } }).to_do;
				const title = td.rich_text?.map((rt) => rt.plain_text ?? "").join("") ?? "";
				readingPath.push({
					title,
					checked: td.checked ?? false,
					block_id: (block as { id: string }).id,
				});
			}
		}

		// Parse toggle blocks in the session log section (after the last divider + heading)
		const sessionLog: Array<{ heading: string; block_id: string }> = [];
		let inSessionLog = false;
		for (const block of allBlocks) {
			const type = (block as { type?: string }).type;
			if (type === "heading_2") {
				const rt = (block as { heading_2: { rich_text: Array<{ plain_text?: string }> } }).heading_2.rich_text;
				const heading = rt?.map((r) => r.plain_text ?? "").join("") ?? "";
				inSessionLog = heading.includes("Session Log");
			}
			if (inSessionLog && type === "toggle") {
				const rt = (block as { toggle: { rich_text: Array<{ plain_text?: string }> } }).toggle.rich_text;
				const heading = rt?.map((r) => r.plain_text ?? "").join("") ?? "";
				sessionLog.push({ heading, block_id: (block as { id: string }).id });
			}
		}

		const completed = readingPath.filter((r) => r.checked).length;

		return {
			guide_page_id: guidePageId,
			persona,
			reading_path: readingPath,
			progress: { total: readingPath.length, completed },
			session_log: sessionLog,
			level_up: checkLevelUp(persona, { total: readingPath.length, completed }),
			guide_level: guideLevel(persona),
		};
	},
});

// --- update_guide_page ---

worker.tool("update_guide_page", {
	title: "Update Guide Page",
	description:
		"Update the developer's living guide page. Can append a new session log entry, and/or " +
		"replace the reading path with fresh recommendations (e.g., after the persona levels up). " +
		"Call this on return visits when the developer has progressed.",
	schema: j.object({
		persona_id: j.string().describe("The persona whose guide page to update."),
		session_note: j
			.string()
			.describe("A new session log entry to append (e.g., 'Completed all Getting Started docs. Bumped to intermediate.').")
			.nullable(),
		refresh_reading_path: j
			.boolean()
			.describe("If true, re-rank docs against the (possibly updated) persona and replace unchecked to-do items.")
			.nullable(),
	}),
	outputSchema: j.object({
		guide_page_id: j.string(),
		session_log_added: j.boolean(),
		reading_path_refreshed: j.boolean(),
		new_reading_path_count: j.number().nullable(),
		level_up: j.object({
			leveled_up: j.boolean(),
			field: j.string().nullable(),
			old_value: j.string().nullable(),
			new_value: j.string().nullable(),
		}).nullable(),
	}),
	execute: async ({ persona_id, session_note, refresh_reading_path }, { notion }: { notion: NotionClient }) => {
		const personaPage = await findPersonaPage(notion, persona_id);
		if (!personaPage) throw new Error(`No persona found with ID ${persona_id}.`);
		const persona = personaFromPage(personaPage);

		const guidePageId = guidePageIdFromPage(personaPage);
		if (!guidePageId) {
			throw new Error("No guide page exists for this persona. Call create_guide_page first.");
		}

		// Check level-up based on current progress (before refresh)
		const preRefreshProgress = await getGuideProgress(notion, guidePageId);
		const levelUp = checkLevelUp(persona, preRefreshProgress);

		let readingPathRefreshed = false;
		let newCount: number | null = null;

		// Refresh reading path: delete unchecked to-dos, add fresh ones
		if (refresh_reading_path) {
			// Read current blocks to find unchecked to-dos and the reading path heading
			const allBlocks: Array<Record<string, unknown>> = [];
			let cursor: string | undefined;
			do {
				const resp = await notion.blocks.children.list({
					block_id: guidePageId,
					page_size: 100,
					...(cursor ? { start_cursor: cursor } : {}),
				});
				allBlocks.push(...resp.results);
				cursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined;
			} while (cursor);

			// Delete unchecked to-do blocks
			for (const block of allBlocks) {
				if ((block as { type?: string }).type === "to_do") {
					const checked = (block as { to_do: { checked: boolean } }).to_do.checked;
					if (!checked) {
						await notion.blocks.delete({ block_id: (block as { id: string }).id });
					}
				}
			}

			// Find the last heading_3 in the reading path section to append after
			// Actually, find the "Your Reading Path" heading and append new to-dos after it
			const allDocs = await fetchAllKbDocs(notion);
			const ranked = rankDocs(allDocs, persona, { maxResults: 15 });
			const grouped = groupByCategory(ranked);

			// Build new reading path blocks
			const newBlocks: Record<string, unknown>[] = [];
			for (const group of grouped) {
				newBlocks.push({
					type: "heading_3",
					heading_3: {
						rich_text: [text(group.category)],
						color: "default",
					},
				});
				for (const doc of group.docs) {
					newBlocks.push({
						type: "to_do",
						to_do: {
							rich_text: [
								text(doc.title, { bold: true, link: doc.url }),
								text(` — ${doc.summary}`),
							],
							checked: false,
							color: "default",
						},
					});
				}
			}

			// Also delete old heading_3 blocks in the reading path section
			let inReadingPath = false;
			for (const block of allBlocks) {
				const type = (block as { type?: string }).type;
				if (type === "heading_2") {
					const rt = (block as { heading_2: { rich_text: Array<{ plain_text?: string }> } }).heading_2.rich_text;
					const heading = rt?.map((r) => r.plain_text ?? "").join("") ?? "";
					inReadingPath = heading.includes("Reading Path");
				}
				if (type === "divider" && inReadingPath) {
					inReadingPath = false;
				}
				if (inReadingPath && type === "heading_3") {
					await notion.blocks.delete({ block_id: (block as { id: string }).id });
				}
			}

			// Find the reading path heading block to append after
			let readingPathHeadingId: string | undefined;
			for (const block of allBlocks) {
				if ((block as { type?: string }).type === "heading_2") {
					const rt = (block as { heading_2: { rich_text: Array<{ plain_text?: string }> } }).heading_2.rich_text;
					const heading = rt?.map((r) => r.plain_text ?? "").join("") ?? "";
					if (heading.includes("Reading Path")) {
						readingPathHeadingId = (block as { id: string }).id;
					}
				}
			}

			if (readingPathHeadingId && newBlocks.length > 0) {
				await notion.blocks.children.append({
					block_id: guidePageId,
					children: newBlocks,
					after: readingPathHeadingId,
				});
			}

			readingPathRefreshed = true;
			newCount = ranked.length;
		}

		// Append session log entry
		let sessionLogAdded = false;
		if (session_note) {
			const now = new Date().toISOString().slice(0, 10);
			await notion.blocks.children.append({
				block_id: guidePageId,
				children: [
					{
						type: "toggle",
						toggle: {
							rich_text: [text(`${now} — Return visit`)],
							color: "default",
							children: [
								{
									type: "paragraph",
									paragraph: {
										rich_text: [text(session_note)],
										color: "default",
									},
								},
							],
						},
					},
				],
			});
			sessionLogAdded = true;
		}

		return {
			guide_page_id: guidePageId,
			session_log_added: sessionLogAdded,
			reading_path_refreshed: readingPathRefreshed,
			new_reading_path_count: newCount,
			level_up: levelUp,
		};
	},
});

// ---------------------------------------------------------------------------
// v3 — Company Context
// ---------------------------------------------------------------------------

const COMPANY_CONFIG_TITLE = "DevQuest Company Config";

interface CompanyContext {
	found: boolean;
	languages: string[];
	frameworks: string[];
	focus_areas: string[];
	onboarding_notes: string;
	raw_content: string;
}

interface TeamContext {
	name: string;
	languages: string[];
	frameworks: string[];
	focus_areas: string[];
	onboarding_notes: string;
	raw_content: string;
}

/**
 * Parse a company config page's block content. Expects a simple format:
 *   **Languages:** Python, TypeScript
 *   **Frameworks:** FastAPI, React
 *   **Focus Areas:** Webhooks, Automation
 *   **Onboarding Notes:** freeform text...
 *
 * Any content not matching a known key is captured in raw_content for the
 * agent to interpret freely.
 */
function parseCompanyBlocks(blocks: Array<Record<string, unknown>>): Omit<CompanyContext, "found"> {
	const result: Omit<CompanyContext, "found"> = {
		languages: [],
		frameworks: [],
		focus_areas: [],
		onboarding_notes: "",
		raw_content: "",
	};

	const rawLines: string[] = [];

	for (const block of blocks) {
		const type = (block as { type?: string }).type;
		let blockText = "";

		if (type === "paragraph" || type === "bulleted_list_item" || type === "numbered_list_item" || type === "callout") {
			const content = (block as Record<string, { rich_text?: Array<{ plain_text?: string }> }>)[type!];
			blockText = content?.rich_text?.map((rt) => rt.plain_text ?? "").join("") ?? "";
		} else if (type === "heading_1" || type === "heading_2" || type === "heading_3") {
			const content = (block as Record<string, { rich_text?: Array<{ plain_text?: string }> }>)[type!];
			blockText = content?.rich_text?.map((rt) => rt.plain_text ?? "").join("") ?? "";
		}

		if (!blockText.trim()) continue;
		rawLines.push(blockText);

		// Try to parse "Key: value, value, value" patterns
		const match = blockText.match(/^\s*\**\s*(languages?|frameworks?|focus[\s_]?areas?|onboarding[\s_]?notes?)\s*\**\s*[:：]\s*(.+)/i);
		if (match) {
			const key = match[1].toLowerCase().replace(/\s+/g, "_").replace(/s$/, "") as string;
			const value = match[2].trim();

			// First occurrence wins: config pages often mention e.g. spoken
			// "Languages:" in later prose sections — don't let those clobber
			// the real stack declaration at the top of the page.
			if (key === "language" || key === "languages") {
				if (result.languages.length === 0)
					result.languages = value.split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
			} else if (key === "framework" || key === "frameworks") {
				if (result.frameworks.length === 0)
					result.frameworks = value.split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
			} else if (key.startsWith("focus")) {
				if (result.focus_areas.length === 0)
					result.focus_areas = value.split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
			} else if (key.startsWith("onboarding")) {
				if (!result.onboarding_notes) result.onboarding_notes = value;
			}
		}
	}

	result.raw_content = rawLines.join("\n");
	return result;
}

worker.tool("read_company_context", {
	title: "Read Company Context",
	description:
		"Look for a page titled 'DevQuest Company Config' in the workspace and read its content. " +
		"Returns structured fields (languages, frameworks, focus areas) plus freeform content. " +
		"Use this once at the start of a conversation to tailor recommendations to the company's stack. " +
		"If no config page exists, returns found=false — proceed with generic onboarding.",
	schema: j.object({}),
	outputSchema: j.object({
		found: j.boolean(),
		languages: j.array(j.string()),
		frameworks: j.array(j.string()),
		focus_areas: j.array(j.string()),
		onboarding_notes: j.string(),
		raw_content: j.string(),
		teams: j.array(
			j.object({
				name: j.string(),
				languages: j.array(j.string()),
				frameworks: j.array(j.string()),
				focus_areas: j.array(j.string()),
				onboarding_notes: j.string(),
			}),
		).describe("Team-specific configs found as child pages under the company config. If non-empty, the agent should ask which team the developer is on."),
		detected_services: j.array(
			j.object({
				name: j.string(),
				llms_txt_url: j.string(),
			}),
		).describe("Services mentioned in company context that have known llms.txt URLs. Call add_doc_source for each."),
	}),
	hints: { readOnlyHint: true },
	execute: async (_input, { notion }: { notion: NotionClient }) => {
		// Search for the config page by title
		const response = await notion.search({
			query: COMPANY_CONFIG_TITLE,
			filter: { property: "object", value: "page" },
		});

		let configPageId: string | null = null;
		for (const result of response.results) {
			// Pages have title in properties.title.title[].plain_text
			const props = (result.properties ?? {}) as Record<
				string,
				{ title?: Array<{ plain_text?: string }> }
			>;
			const pageTitle = props.title?.title?.map((t) => t.plain_text ?? "").join("") ?? "";
			if (pageTitle === COMPANY_CONFIG_TITLE) {
				configPageId = result.id;
				break;
			}
		}

		if (!configPageId) {
			return {
				found: false,
				languages: [],
				frameworks: [],
				focus_areas: [],
				onboarding_notes: "",
				raw_content: "",
				teams: [],
				detected_services: [],
			};
		}

		// Read blocks from the config page
		const blocks: Array<Record<string, unknown>> = [];
		let cursor: string | undefined;
		do {
			const resp = await notion.blocks.children.list({
				block_id: configPageId,
				page_size: 100,
				...(cursor ? { start_cursor: cursor } : {}),
			});
			blocks.push(...resp.results);
			cursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined;
		} while (cursor);

		const parsed = parseCompanyBlocks(blocks);

		// Discover team child pages from the blocks we already read
		const teams: TeamContext[] = [];
		for (const block of blocks) {
			if ((block as { type?: string }).type === "child_page") {
				const childTitle = (block as { child_page: { title: string } }).child_page.title ?? "";
				const childId = (block as { id: string }).id;

				try {
					// Read blocks from the child (team) page
					const teamBlocks: Array<Record<string, unknown>> = [];
					let teamCursor: string | undefined;
					do {
						const resp = await notion.blocks.children.list({
							block_id: childId,
							page_size: 100,
							...(teamCursor ? { start_cursor: teamCursor } : {}),
						});
						teamBlocks.push(...resp.results);
						teamCursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined;
					} while (teamCursor);

					const teamParsed = parseCompanyBlocks(teamBlocks);
					teams.push({
						name: childTitle,
						...teamParsed,
					});
				} catch {
					// Skip teams we can't read
				}
			}
		}

		// Detect known services mentioned in the company context (including team pages)
		const allText = [parsed.raw_content, ...teams.map((t) => t.raw_content)].join("\n").toLowerCase();
		const detected_services: Array<{ name: string; llms_txt_url: string }> = [];
		for (const [service, source] of Object.entries(KNOWN_DOC_SOURCES)) {
			if (allText.includes(service)) {
				detected_services.push({ name: service, llms_txt_url: source.url });
			}
		}

		return { found: true, ...parsed, teams, detected_services };
	},
});

// ---------------------------------------------------------------------------
// Tool: read_team_context — find a team page ANYWHERE in the workspace
//
// read_company_context discovers teams nested under the config page; this
// tool covers the common case where team pages live elsewhere (e.g. as
// siblings in a teamspace). Matches titles like "Platform Team" / "Platform"
// regardless of location.
// ---------------------------------------------------------------------------

/** Extract a page's title from a search result. */
function pageTitleFromSearchResult(result: { properties?: unknown }): string {
	const props = (result.properties ?? {}) as Record<
		string,
		{ title?: Array<{ plain_text?: string }> }
	>;
	return props.title?.title?.map((t) => t.plain_text ?? "").join("") ?? "";
}

worker.tool("read_team_context", {
	title: "Read Team Context",
	description:
		"Find and read a specific team's page anywhere in the workspace (e.g. 'Platform Team', " +
		"'Data Engineering'). Call this when the developer says they joined/moved to a team or asks " +
		"about a team's process — especially when read_company_context returned no matching team. " +
		"Returns structured fields plus the page's full content; team values override company " +
		"defaults. If found=false, ask the developer to link the team's page.",
	schema: j.object({
		team: j
			.string()
			.describe("The team name as the developer said it, e.g. 'platform' or 'Platform Team'."),
	}),
	outputSchema: j.object({
		found: j.boolean(),
		page_title: j.string().nullable(),
		page_url: j.string().nullable(),
		languages: j.array(j.string()),
		frameworks: j.array(j.string()),
		focus_areas: j.array(j.string()),
		onboarding_notes: j.string(),
		raw_content: j.string(),
		detected_services: j.array(
			j.object({
				name: j.string(),
				llms_txt_url: j.string(),
			}),
		),
	}),
	hints: { readOnlyHint: true },
	execute: async ({ team }, { notion }: { notion: NotionClient }) => {
		const notFound = {
			found: false,
			page_title: null,
			page_url: null,
			languages: [],
			frameworks: [],
			focus_areas: [],
			onboarding_notes: "",
			raw_content: "",
			detected_services: [],
		};

		// "platform" / "Platform Team" / "team platform" → "platform"
		const normalize = (s: string) =>
			s.toLowerCase().replace(/\bteam\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
		const wanted = normalize(team);
		if (!wanted) return notFound;

		const response = await notion.search({
			query: team,
			filter: { property: "object", value: "page" },
		});

		let teamPage: { id: string; url?: string } | null = null;
		let teamPageTitle = "";
		// Pass 1: exact normalized match ("Platform Team" ≡ "platform")
		for (const result of response.results) {
			const title = pageTitleFromSearchResult(result);
			if (title && normalize(title) === wanted) {
				teamPage = result as { id: string; url?: string };
				teamPageTitle = title;
				break;
			}
		}
		// Pass 2: relaxed — title contains the team name ("Platform Team 🚀",
		// "Team: Platform"). Only accept short titles so we don't match prose
		// pages that merely mention the team.
		if (!teamPage) {
			for (const result of response.results) {
				const title = pageTitleFromSearchResult(result);
				const norm = normalize(title);
				if (title && norm.includes(wanted) && norm.length <= wanted.length + 15) {
					teamPage = result as { id: string; url?: string };
					teamPageTitle = title;
					break;
				}
			}
		}
		if (!teamPage) return notFound;

		// Same parser as the company config: structured keys + freeform content
		const blocks: Array<Record<string, unknown>> = [];
		let cursor: string | undefined;
		do {
			const resp = await notion.blocks.children.list({
				block_id: teamPage.id,
				page_size: 100,
				...(cursor ? { start_cursor: cursor } : {}),
			});
			blocks.push(...resp.results);
			cursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined;
		} while (cursor);

		const parsed = parseCompanyBlocks(blocks);

		const allText = parsed.raw_content.toLowerCase();
		const detected_services: Array<{ name: string; llms_txt_url: string }> = [];
		for (const [service, source] of Object.entries(KNOWN_DOC_SOURCES)) {
			if (allText.includes(service)) {
				detected_services.push({ name: service, llms_txt_url: source.url });
			}
		}

		return {
			found: true,
			page_title: teamPageTitle,
			page_url: teamPage.url ?? `https://notion.so/${teamPage.id.replace(/-/g, "")}`,
			...parsed,
			detected_services,
		};
	},
});

// ---------------------------------------------------------------------------
// v4 — Pluggable Doc Sources
// ---------------------------------------------------------------------------

worker.tool("add_doc_source", {
	title: "Add Doc Source",
	description:
		"Register an external developer docs source so DevQuest includes it in the knowledge base. " +
		"Supports multiple formats: llms.txt, OpenAPI specs (JSON), sitemap.xml, or raw markdown. " +
		"The type is auto-detected from the URL but can be overridden. " +
		"Creates the 'DevQuest Doc Sources' database if it doesn't exist. " +
		"The next daily sync will fetch and index the source.",
	schema: j.object({
		source_name: j
			.string()
			.describe("Human-readable name for this source (e.g., 'HubSpot', 'Stripe')."),
		source_url: j
			.string()
			.describe("URL of the docs source to sync. Can be an llms.txt, OpenAPI spec JSON, sitemap.xml, or markdown file."),
		source_type: j
			.enum(...SOURCE_TYPES)
			.describe("Format of the source. Auto-detected from URL if set to 'llms-txt'. Options: llms-txt, openapi, sitemap, markdown.")
			.nullable(),
		parent_page: j
			.string()
			.describe("Notion page URL or ID to create the config database under. Uses the personas DB parent if omitted.")
			.nullable(),
	}),
	outputSchema: j.object({
		source_name: j.string(),
		source_url: j.string(),
		source_type: j.string(),
		database_id: j.string(),
		message: j.string(),
	}),
	execute: async ({ source_name, source_url, source_type, parent_page }, { notion }: { notion: NotionClient }) => {
		const resolvedType = source_type ?? detectSourceType(source_url);
		// 1. Find or create the Doc Sources database
		let dbId: string | null = null;

		try {
			const dsId = await findDataSource(notion, DOC_SOURCES_DB_TITLE);
			const ds = await notion.dataSources.retrieve({ data_source_id: dsId });
			dbId = ds.parent?.database_id ?? null;
			// Migrate: ensure Type column exists on older databases
			if (dbId) {
				await ensureDbProperties(notion, dbId, {
					Type: { select: { options: SOURCE_TYPES.map((name) => ({ name })) } },
				});
			}
		} catch {
			// Database doesn't exist — create it
		}

		if (!dbId) {
			let parentId: string;
			if (parent_page) {
				parentId = extractNotionId(parent_page);
			} else {
				// Use the same parent as the personas database
				const personasDbId = await getPersonasDbId(notion);
				const db = await notion.databases.retrieve({ database_id: personasDbId });
				parentId = db.parent?.page_id ?? db.parent?.workspace ?? personasDbId;
			}

			const newDb = await notion.databases.create({
				parent: { page_id: parentId },
				title: [{ text: { content: DOC_SOURCES_DB_TITLE } }],
				properties: {
					"Source Name": { type: "title", title: {} },
					URL: { type: "url", url: {} },
					Type: {
						type: "select",
						select: { options: SOURCE_TYPES.map((name) => ({ name })) },
					},
					"Added": { type: "created_time", created_time: {} },
				},
			});
			dbId = newDb.id;
		}

		// 2. Check if this source already exists
		const existingDs = await findDataSource(notion, DOC_SOURCES_DB_TITLE);
		const existing = await notion.dataSources.query({
			data_source_id: existingDs,
			page_size: 50,
		});
		for (const row of existing.results) {
			const props = (row.properties ?? {}) as Record<
				string,
				{ title?: Array<{ plain_text?: string }> }
			>;
			const name = props["Source Name"]?.title?.map((t) => t.plain_text ?? "").join("") ?? "";
			if (name === source_name) {
				return {
					source_name,
					source_url,
					source_type: resolvedType,
					database_id: dbId!,
					message: `Source "${source_name}" already registered. It will be included in the next sync.`,
				};
			}
		}

		// 3. Add the source
		await notion.pages.create({
			parent: { database_id: dbId! },
			properties: {
				"Source Name": { title: [{ text: { content: source_name } }] },
				URL: { url: source_url },
				Type: { select: { name: resolvedType } },
			},
		});

		return {
			source_name,
			source_url,
			source_type: resolvedType,
			database_id: dbId!,
			message: `Added "${source_name}" (${source_url}, type: ${resolvedType}). It will be indexed on the next sync run.`,
		};
	},
});

// ---------------------------------------------------------------------------
// v5 — DevRel Insights Digest
//
// DevQuest's personas + guide progress are the engagement data DevRel teams
// lack. A weekly sync aggregates them into the "DevQuest Insights" database:
// one row per week with metrics as properties and a narrative digest as the
// page body. Deterministic aggregation — no LLM in the numbers.
// ---------------------------------------------------------------------------

const insightsDb = worker.database("insightsDb", {
	type: "managed",
	initialTitle: "DevQuest Insights",
	primaryKeyProperty: "Week",
	schema: {
		properties: {
			Week: Schema.title(),
			Generated: Schema.date(),
			"Total Personas": Schema.number(),
			"New This Week": Schema.number(),
			"Complete Personas": Schema.number(),
			"Guides Created": Schema.number(),
			"Docs Checked": Schema.number(),
			"Docs Unchecked": Schema.number(),
			Goals: Schema.richText(),
			Languages: Schema.richText(),
			Experience: Schema.richText(),
			"Content Gaps": Schema.richText(),
		},
	},
});

/** Read a guide page's to-do progress (used by the insights sync). */
async function readGuideProgress(notion: NotionClient, guidePageId: string): Promise<GuideProgress> {
	const progress: GuideProgress = { total: 0, completed: 0, uncheckedTitles: [] };
	let cursor: string | undefined;
	do {
		const resp = await notion.blocks.children.list({
			block_id: guidePageId,
			page_size: 100,
			...(cursor ? { start_cursor: cursor } : {}),
		});
		for (const block of resp.results as Array<Record<string, unknown>>) {
			if ((block as { type?: string }).type !== "to_do") continue;
			const td = (block as { to_do: { rich_text?: Array<{ plain_text?: string }>; checked?: boolean } }).to_do;
			progress.total++;
			if (td.checked) progress.completed++;
			else {
				const title = td.rich_text?.map((rt) => rt.plain_text ?? "").join("") ?? "";
				if (title) progress.uncheckedTitles.push(title);
			}
		}
		cursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined;
	} while (cursor);
	return progress;
}

/** Cap guide-page reads per digest run to stay well inside sync runtime limits. */
const MAX_GUIDES_PER_DIGEST = 20;

worker.sync("insights_digest", {
	database: insightsDb,
	mode: "incremental",
	schedule: "7d",
	execute: async (_state, { notion }: { notion: NotionClient }) => {
		// 1. Read all personas (if the DB doesn't exist yet, publish nothing)
		const personas: PersonaRecord[] = [];
		const guideIds: string[] = [];
		try {
			let cursor: string | undefined;
			do {
				const resp: QueryResponse = await queryByTitle(notion, PERSONAS_DB_TITLE, {
					page_size: 100,
					...(cursor ? { start_cursor: cursor } : {}),
				});
				for (const page of resp.results) {
					const guideId = guidePageIdFromPage(page);
					personas.push({
						persona: personaFromPage(page),
						createdTime: (page as { created_time?: string }).created_time ?? null,
						hasGuide: Boolean(guideId),
					});
					if (guideId) guideIds.push(guideId);
				}
				cursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined;
			} while (cursor);
		} catch {
			return { changes: [], hasMore: false };
		}

		// 2. Read guide progress (best-effort per guide)
		const guides: GuideProgress[] = [];
		for (const guideId of guideIds.slice(0, MAX_GUIDES_PER_DIGEST)) {
			try {
				guides.push(await readGuideProgress(notion, guideId));
			} catch {
				// Guide page deleted or inaccessible — skip it
			}
		}

		// 3. Aggregate and publish one row for this week (re-running a week
		//    updates the same row — Week is the primary key)
		const digest = buildDigest(personas, guides);

		return {
			changes: [
				{
					type: "upsert" as const,
					key: digest.week,
					properties: {
						Week: Builder.title(digest.week),
						Generated: Builder.date(digest.generated),
						"Total Personas": Builder.number(digest.totalPersonas),
						"New This Week": Builder.number(digest.newThisWeek),
						"Complete Personas": Builder.number(digest.completePersonas),
						"Guides Created": Builder.number(digest.guidesCreated),
						"Docs Checked": Builder.number(digest.docsChecked),
						"Docs Unchecked": Builder.number(digest.docsUnchecked),
						Goals: Builder.richText(digest.goals),
						Languages: Builder.richText(digest.languages),
						Experience: Builder.richText(digest.experience),
						"Content Gaps": Builder.richText(digest.contentGaps),
					},
					pageContentMarkdown: digest.markdown,
				},
			],
			hasMore: false,
		};
	},
});
