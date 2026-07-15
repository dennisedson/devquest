/**
 * Verifies query_docs ranking produces meaningfully different results for
 * contrasting personas (the core demo moment). Uses the llms.txt fixture.
 * Run: npx tsx scripts/test-scoring.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLlmsTxt } from "../src/docs-parser.js";
import { rankDocs } from "../src/query-docs.js";
import type { Persona } from "../src/persona.js";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/llms.txt");
const docs = parseLlmsTxt(readFileSync(fixture, "utf8"));

const beginnerPython: Persona = {
	goal: "automation",
	language: "python",
	experience: "beginner",
	api_comfort: "none",
};

const advancedTs: Persona = {
	goal: "public-integration",
	language: "typescript",
	experience: "advanced",
	api_comfort: "fluent",
};

function show(label: string, persona: Persona) {
	console.log(`\n=== ${label} ===`);
	const ranked = rankDocs(docs, persona);
	for (const d of ranked) console.log(`  [${d.category}/${d.difficulty}] ${d.title}`);
	return ranked;
}

const mixedExpert: Persona = {
	goal: "internal-tool",
	language: "typescript",
	experience: "advanced",
	api_comfort: "none", // expert dev, new to REST APIs
};

const a = show("Beginner Python dev, automation, new to APIs", beginnerPython);
const b = show("Advanced TS dev, public integration, API-fluent", advancedTs);
const c = show("Advanced TS dev, internal tool, NEW to APIs (mixed)", mixedExpert);

const overlap = a.filter((d) => b.some((x) => x.url === d.url)).length;
console.log(`\nOverlap between the two top-10 lists: ${overlap}/10`);

let failures = 0;
if (overlap > 4) {
	failures++;
	console.error("FAIL: personas too similar — rankings barely differ");
}
if (a.some((d) => d.difficulty === "Advanced")) {
	failures++;
	console.error("FAIL: beginner persona received Advanced docs");
}
if (!b.some((d) => d.category === "Auth")) {
	failures++;
	console.error("FAIL: public-integration persona got no Auth docs");
}

// Per-field difficulty: the mixed persona should get beginner-level API
// mechanics without being buried in beginner docs overall.
const mixedApiDocs = c.filter((d) => ["Auth", "Reference", "Webhooks"].includes(d.category ?? ""));
if (mixedApiDocs.some((d) => d.difficulty === "Advanced")) {
	failures++;
	console.error("FAIL: mixed persona (api_comfort=none) got Advanced API-mechanics docs");
}
const mixedOtherDocs = c.filter((d) => !["Auth", "Reference", "Webhooks"].includes(d.category ?? ""));
if (mixedOtherDocs.length > 0 && mixedOtherDocs.every((d) => d.difficulty === "Beginner")) {
	failures++;
	console.error("FAIL: mixed persona (experience=advanced) buried in Beginner docs outside API categories");
}

console.log(failures === 0 ? "\nAll assertions passed." : `\n${failures} assertion(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
