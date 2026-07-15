/**
 * query-docs.ts — pure scoring logic for matching knowledge-base docs to a
 * persona. Deterministic and side-effect free so it can be tuned and tested
 * without touching the Notion API (Day 4 is tuning day).
 *
 * The whole KB is ~160 records, so we fetch it all and rank in code rather
 * than composing brittle compound API filters.
 *
 * Difficulty fit is per-field (Day 4): api_comfort drives difficulty for
 * API-mechanics categories (Auth, Reference, Webhooks); experience drives
 * everything else. An expert TypeScript dev who's new to REST gets beginner
 * auth docs without being buried in beginner material across the board.
 *
 * TODO (future — see roadmap "Scoring Intelligence"):
 *   - LLM-assisted ranking that takes freeform context into account
 *     (e.g. "I've built REST APIs before but never used Notion")
 *   - Hybrid: deterministic first pass, LLM re-rank of top-N
 */

import type { Category, Difficulty, Tag } from "./docs-parser.js";
import { GOALS, type Persona } from "./persona.js";

export interface KbDoc {
	title: string;
	url: string;
	summary: string;
	category: Category | null;
	difficulty: Difficulty | null;
	relevantFor: string[];
	/** Date this doc first appeared in the KB (v8 change awareness). */
	firstSeen?: string | null;
}

/** Which KB categories matter most for each goal. */
const GOAL_CATEGORIES: Record<string, string[]> = {
	"internal-tool": ["Getting Started", "Data APIs", "Auth"],
	"public-integration": ["Auth", "Getting Started", "Reference"],
	automation: ["Webhooks", "Data APIs", "Workers"],
	"ai-agent": ["MCP", "Agents", "Workers"],
	exploring: ["Getting Started", "Data APIs", "MCP"],
};

const DIFFICULTY_FOR_EXPERIENCE: Record<string, Difficulty> = {
	beginner: "Beginner",
	intermediate: "Intermediate",
	advanced: "Advanced",
};

/** Categories that are about API mechanics rather than general development.
 *  For these, REST familiarity (api_comfort) is a better difficulty signal
 *  than overall dev experience. */
const API_MECHANICS_CATEGORIES = new Set<string>(["Auth", "Reference", "Webhooks"]);

const DIFFICULTY_FOR_COMFORT: Record<string, Difficulty> = {
	none: "Beginner",
	some: "Intermediate",
	fluent: "Advanced",
};

const LANGUAGE_TAGS = new Set(["typescript", "python", "curl"]);

/** The difficulty this persona should see for this doc: api_comfort governs
 *  API-mechanics categories, experience governs the rest. Falls back to the
 *  other field when the preferred one is unknown. */
function idealDifficulty(doc: KbDoc, persona: Persona): Difficulty | null {
	const fromComfort = persona.api_comfort ? DIFFICULTY_FOR_COMFORT[persona.api_comfort] : null;
	const fromExperience = persona.experience ? DIFFICULTY_FOR_EXPERIENCE[persona.experience] : null;
	const isApiMechanics = doc.category != null && API_MECHANICS_CATEGORIES.has(doc.category);
	return isApiMechanics ? (fromComfort ?? fromExperience) : (fromExperience ?? fromComfort);
}

/** Company context that can boost scoring toward the company's stack. */
export interface CompanyBoost {
	languages: string[];
	focus_areas: string[];
}

export function scoreDoc(doc: KbDoc, persona: Persona, company?: CompanyBoost): number {
	let score = 0;
	const tags = new Set(doc.relevantFor);

	if (persona.goal) {
		const preferred = GOAL_CATEGORIES[persona.goal] ?? [];
		const idx = doc.category ? preferred.indexOf(doc.category) : -1;
		if (idx === 0) score += 3;
		else if (idx > 0) score += 2;
		if (tags.has(persona.goal)) score += 2;
		// Penalize docs explicitly aimed at *other* goals (e.g. marketplace
		// listing docs for an internal-tool builder). "exploring" is a
		// universal tag, not a competing goal, so it never triggers a penalty.
		const docGoals = doc.relevantFor.filter(
			(t) => t !== "exploring" && (GOALS as readonly string[]).includes(t),
		);
		if (docGoals.length > 0 && !docGoals.includes(persona.goal)) score -= 2;
	}

	const ideal = idealDifficulty(doc, persona);
	if (ideal) {
		if (doc.difficulty === ideal) score += 2;
		// Don't bury beginners in advanced material (and vice versa)
		if (ideal === "Beginner" && doc.difficulty === "Advanced") score -= 3;
		if (ideal === "Advanced" && doc.difficulty === "Beginner") score -= 1;
	}

	if (persona.language) {
		const docLanguages = doc.relevantFor.filter((t) => LANGUAGE_TAGS.has(t));
		if (docLanguages.length === 0 || docLanguages.includes(persona.language)) score += 1;
		else score -= 1; // tagged for other languages only
	}

	if (persona.api_comfort === "none") {
		if (tags.has("api-basics")) score += 2;
	} else if (persona.api_comfort === "fluent") {
		if (tags.has("api-basics")) score -= 1;
	}

	// Company context boosts — strongly prioritize docs matching the company's
	// stack so company-relevant content dominates the top of the reading path.
	if (company) {
		// Boost docs tagged for languages the company uses
		if (company.languages.length > 0) {
			const docLangs = doc.relevantFor.filter((t) => LANGUAGE_TAGS.has(t));
			if (docLangs.some((l) => company.languages.includes(l))) score += 3;
		}
		// Boost docs in categories matching company focus areas
		if (company.focus_areas.length > 0 && doc.category) {
			const catLower = doc.category.toLowerCase();
			if (company.focus_areas.some((f) => catLower.includes(f) || f.includes(catLower))) {
				score += 3;
			}
		}
	}

	return score;
}

export interface RankOptions {
	category?: string | null;
	maxResults?: number | null;
}

export function rankDocs(docs: KbDoc[], persona: Persona, options: RankOptions = {}, company?: CompanyBoost): KbDoc[] {
	const { category, maxResults } = options;
	const limit = maxResults ?? 10;

	return docs
		.filter((d) => (category ? d.category === category : true))
		.map((d) => ({ doc: d, score: scoreDoc(d, persona, company) }))
		.sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title))
		.slice(0, limit)
		.map((s) => s.doc);
}

// ---------------------------------------------------------------------------
// Notion page → KbDoc extraction
// ---------------------------------------------------------------------------

interface RichTextLike {
	plain_text?: string;
}
type KbPageProperties = Record<
	string,
	{
		title?: RichTextLike[];
		rich_text?: RichTextLike[];
		url?: string | null;
		select?: { name?: string } | null;
		multi_select?: Array<{ name?: string }>;
		date?: { start?: string | null } | null;
	}
>;

function plain(items?: RichTextLike[]): string {
	return (items ?? []).map((t) => t.plain_text ?? "").join("");
}

export function kbDocFromPage(page: { properties?: unknown }): KbDoc {
	const props = (page.properties ?? {}) as KbPageProperties;
	return {
		title: plain(props.Title?.title),
		url: props.Link?.url ?? plain(props.URL?.rich_text),
		summary: plain(props.Summary?.rich_text),
		category: (props.Category?.select?.name as Category | undefined) ?? null,
		difficulty: (props.Difficulty?.select?.name as Difficulty | undefined) ?? null,
		relevantFor: (props["Relevant For"]?.multi_select ?? [])
			.map((o) => o.name ?? "")
			.filter(Boolean) as Tag[],
		firstSeen: props["First Seen"]?.date?.start ?? null,
	};
}
