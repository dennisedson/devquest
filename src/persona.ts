/**
 * persona.ts — the lean persona: four fields, each of which changes the output.
 *
 * The personas database is a REGULAR Notion database (not a managed sync
 * database — those are sync-only). It is created once by the setup_devquest
 * tool and discovered at runtime by title. The record's title IS the
 * developer's name, which doubles as the persona's identity key.
 */

export const GOALS = ["internal-tool", "public-integration", "automation", "ai-agent", "exploring"] as const;
export const LANGUAGES = ["typescript", "python", "curl"] as const;
export const EXPERIENCES = ["beginner", "intermediate", "advanced"] as const;
export const API_COMFORTS = ["none", "some", "fluent"] as const;

export type Goal = (typeof GOALS)[number];
export type Language = (typeof LANGUAGES)[number];
export type Experience = (typeof EXPERIENCES)[number];
export type ApiComfort = (typeof API_COMFORTS)[number];

export interface Persona {
	goal: Goal | null;
	language: Language | null;
	experience: Experience | null;
	api_comfort: ApiComfort | null;
}

export const PERSONA_FIELDS = ["goal", "language", "experience", "api_comfort"] as const;

export function missingFields(persona: Persona): string[] {
	return PERSONA_FIELDS.filter((f) => persona[f] === null);
}

/** Property names in the personas database.
 *  The title IS the developer's name — the agent supplies it from conversation
 *  context, and it doubles as the persona's identity key. */
export const PERSONA_PROPS = {
	id: "Persona ID", // title — the developer's first and last name
	goal: "Goal", // select
	language: "Language", // select
	experience: "Experience", // select
	api_comfort: "API Comfort", // select
	guide_page_id: "Guide Page ID", // rich_text (v2)
	first_success: "First Success", // date (v6) — set when their first API call is verified
} as const;

/** Normalize a name into a stable lookup key so "Dennis Edson",
 *  "dennis edson", and "Dennis  Edson" all match the same record. */
export function normalizeUserKey(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Schema for notion.databases.create — 2025-09-03 format (requires `type` on each property). */
export const PERSONAS_DB_PROPERTIES = {
	[PERSONA_PROPS.id]: { type: "title", title: {} },
	[PERSONA_PROPS.goal]: { type: "select", select: { options: GOALS.map((name) => ({ name })) } },
	[PERSONA_PROPS.language]: { type: "select", select: { options: LANGUAGES.map((name) => ({ name })) } },
	[PERSONA_PROPS.experience]: { type: "select", select: { options: EXPERIENCES.map((name) => ({ name })) } },
	[PERSONA_PROPS.api_comfort]: { type: "select", select: { options: API_COMFORTS.map((name) => ({ name })) } },
	[PERSONA_PROPS.guide_page_id]: { type: "rich_text", rich_text: {} },
	[PERSONA_PROPS.first_success]: { type: "date", date: {} },
	"Created By": { type: "created_by", created_by: {} },
	Created: { type: "created_time", created_time: {} },
	"Last Updated": { type: "last_edited_time", last_edited_time: {} },
};

export const PERSONAS_DB_TITLE = "DevQuest Personas";

/** Build the `properties` payload for creating/updating a persona page. */
export function buildPersonaProperties(
	update: Partial<Persona>,
	opts?: { personaId?: string },
) {
	const properties: Record<string, unknown> = {};
	if (opts?.personaId) {
		properties[PERSONA_PROPS.id] = { title: [{ text: { content: opts.personaId } }] };
	}
	for (const field of PERSONA_FIELDS) {
		const value = update[field];
		if (value != null) {
			properties[PERSONA_PROPS[field]] = { select: { name: value } };
		}
	}
	return properties;
}

// Minimal shapes for the Notion API page objects we read.
interface SelectProp {
	select?: { name?: string } | null;
}
interface TitleProp {
	title?: Array<{ plain_text?: string }>;
}
type PageProperties = Record<string, SelectProp & TitleProp>;

function selectValue<T extends string>(props: PageProperties, name: string, allowed: readonly T[]): T | null {
	const raw = props[name]?.select?.name;
	return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

/** Read a Persona out of a Notion page object returned by the API. */
export function personaFromPage(page: { properties?: unknown }): Persona {
	const props = (page.properties ?? {}) as PageProperties;
	return {
		goal: selectValue(props, PERSONA_PROPS.goal, GOALS),
		language: selectValue(props, PERSONA_PROPS.language, LANGUAGES),
		experience: selectValue(props, PERSONA_PROPS.experience, EXPERIENCES),
		api_comfort: selectValue(props, PERSONA_PROPS.api_comfort, API_COMFORTS),
	};
}

export function personaIdFromPage(page: { properties?: unknown }): string | null {
	const props = (page.properties ?? {}) as PageProperties;
	return props[PERSONA_PROPS.id]?.title?.[0]?.plain_text ?? null;
}

/** Extract a Notion ID (32 hex chars, optionally dashed) from a URL or raw ID. */
export function extractNotionId(urlOrId: string): string {
	const dashed = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	const trimmed = urlOrId.trim();
	if (dashed.test(trimmed)) return trimmed;
	const match = trimmed.replace(/[-]/g, "").match(/([0-9a-f]{32})(?!.*[0-9a-f]{32})/i);
	if (!match) throw new Error(`Could not find a Notion ID in: ${urlOrId}`);
	const hex = match[1];
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
