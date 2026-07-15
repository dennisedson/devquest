/**
 * Verifies docs-parser against a snapshot of developers.notion.com/llms.txt.
 * Run: npm run test:parser
 * Refresh the fixture: curl -s https://developers.notion.com/llms.txt > test/fixtures/llms.txt
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLlmsTxt } from "../src/docs-parser.js";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/llms.txt");
const entries = parseLlmsTxt(readFileSync(fixture, "utf8"));

let failures = 0;
function assert(condition: boolean, message: string) {
	if (!condition) {
		failures++;
		console.error(`  FAIL: ${message}`);
	}
}

console.log(`Parsed ${entries.length} entries\n`);

assert(entries.length >= 100, `expected >=100 entries, got ${entries.length}`);
assert(entries.every((e) => e.title.length > 0), "every entry has a title");
assert(entries.every((e) => e.url.startsWith("https://developers.notion.com/")), "every URL is a docs URL");
assert(entries.every((e) => !e.url.endsWith(".md") && !e.url.endsWith(".json")), "no raw .md/.json URLs");
assert(new Set(entries.map((e) => e.url)).size === entries.length, "URLs (primary keys) are unique");
assert(entries.every((e) => e.relevantFor.length > 0), "every entry has at least one tag");

const byCategory = new Map<string, number>();
const byDifficulty = new Map<string, number>();
for (const e of entries) {
	byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);
	byDifficulty.set(e.difficulty, (byDifficulty.get(e.difficulty) ?? 0) + 1);
}

console.log("By category:");
for (const [k, v] of [...byCategory].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(16)} ${v}`);
console.log("\nBy difficulty:");
for (const [k, v] of byDifficulty) console.log(`  ${k.padEnd(16)} ${v}`);

console.log("\nSample entries:");
for (const e of entries.filter((x) => ["Getting Started", "Auth", "Webhooks"].includes(x.category)).slice(0, 6)) {
	console.log(`  [${e.category}/${e.difficulty}] ${e.title}`);
	console.log(`    ${e.url}`);
	console.log(`    tags: ${e.relevantFor.join(", ")}`);
}

console.log(failures === 0 ? "\nAll assertions passed." : `\n${failures} assertion(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
