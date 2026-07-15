/**
 * insights.ts — pure aggregation logic for the DevRel Insights digest (v5).
 *
 * DevQuest's personas + guide progress are exactly the signal DevRel teams
 * lack: who is showing up, what they're building, and where they stall.
 * This module turns raw records into a weekly digest. Deterministic and
 * side-effect free — the sync fetches, this computes.
 */

import type { Persona } from "./persona.js";
import { PERSONA_FIELDS } from "./persona.js";

export interface PersonaRecord {
	persona: Persona;
	createdTime: string | null; // ISO
	hasGuide: boolean;
}

export interface GuideProgress {
	total: number;
	completed: number;
	uncheckedTitles: string[];
}

export interface Digest {
	week: string; // e.g. "2026-W29"
	generated: string; // YYYY-MM-DD
	totalPersonas: number;
	newThisWeek: number;
	completePersonas: number;
	guidesCreated: number;
	docsChecked: number;
	docsUnchecked: number;
	goals: string;
	languages: string;
	experience: string;
	contentGaps: string;
	markdown: string;
}

/** ISO-8601 week label, e.g. "2026-W29". */
export function isoWeek(date: Date): string {
	const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	const dayNum = d.getUTCDay() || 7; // Monday=1 … Sunday=7
	d.setUTCDate(d.getUTCDate() + 4 - dayNum); // shift to the week's Thursday
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** "automation ×4, internal-tool ×2" style distribution line. */
function distribution(values: Array<string | null>): string {
	const counts = new Map<string, number>();
	for (const v of values) {
		const key = v ?? "(unset)";
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	if (counts.size === 0) return "—";
	return [...counts]
		.sort((a, b) => b[1] - a[1])
		.map(([k, n]) => `${k} ×${n}`)
		.join(", ");
}

/** Most frequent unchecked doc titles across all guides — the content gaps. */
export function topContentGaps(guides: GuideProgress[], limit = 5): string[] {
	const counts = new Map<string, number>();
	for (const g of guides) {
		for (const raw of g.uncheckedTitles) {
			// Guide to-dos are "Title — summary"; keep just the title
			const title = raw.split(" — ")[0].trim();
			if (title) counts.set(title, (counts.get(title) ?? 0) + 1);
		}
	}
	return [...counts]
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([title, n]) => (n > 1 ? `${title} (unread in ${n} guides)` : title));
}

export function buildDigest(
	personas: PersonaRecord[],
	guides: GuideProgress[],
	now: Date = new Date(),
): Digest {
	const week = isoWeek(now);
	const generated = now.toISOString().slice(0, 10);
	const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

	const complete = personas.filter((p) =>
		PERSONA_FIELDS.every((f) => p.persona[f] !== null),
	).length;
	const newThisWeek = personas.filter((p) => p.createdTime && p.createdTime >= weekAgo).length;
	const docsChecked = guides.reduce((sum, g) => sum + g.completed, 0);
	const docsTotal = guides.reduce((sum, g) => sum + g.total, 0);
	const gaps = topContentGaps(guides);

	const goals = distribution(personas.map((p) => p.persona.goal));
	const languages = distribution(personas.map((p) => p.persona.language));
	const experience = distribution(personas.map((p) => p.persona.experience));

	const markdown = [
		`# DevQuest Insights — ${week}`,
		"",
		`**${personas.length}** personas total (**${newThisWeek}** new this week), ` +
			`**${complete}** with a complete profile, **${guides.length}** guide pages.`,
		"",
		"## Who is showing up",
		`- **Goals:** ${goals}`,
		`- **Languages:** ${languages}`,
		`- **Experience:** ${experience}`,
		"",
		"## Reading progress",
		docsTotal > 0
			? `- **${docsChecked} / ${docsTotal}** recommended docs checked off (${Math.round((docsChecked / docsTotal) * 100)}%)`
			: "- No guide pages with reading paths yet",
		"",
		"## Content gaps (recommended but unread)",
		...(gaps.length > 0 ? gaps.map((g) => `- ${g}`) : ["- None detected yet"]),
		"",
		"_Generated automatically by the DevQuest insights_digest sync._",
	].join("\n");

	return {
		week,
		generated,
		totalPersonas: personas.length,
		newThisWeek,
		completePersonas: complete,
		guidesCreated: guides.length,
		docsChecked,
		docsUnchecked: docsTotal - docsChecked,
		goals,
		languages,
		experience,
		contentGaps: gaps.join("; ") || "—",
		markdown,
	};
}
