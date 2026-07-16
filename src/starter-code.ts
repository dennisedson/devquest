/**
 * starter-code.ts — persona-aware starter code (v7).
 *
 * Pure functions returning install commands, key endpoints, and a runnable
 * first snippet per language × goal. The snippet intentionally creates a page
 * titled "My first Notion API page" — the same artifact verify_first_call
 * (v6) verifies, so "run the snippet" → "paste the page URL" → celebration
 * is one continuous flow.
 */

import type { Goal, Language, Persona } from "./persona.js";

// Type aliases (not interfaces) so they satisfy the SDK's JSONValue return
// type — TS gives implicit index signatures to aliases but not interfaces.
export type Endpoint = {
	method: string;
	path: string;
	description: string;
};

export type StarterCode = {
	sdk_install: string;
	snippet_language: string; // Notion code-block language identifier
	snippet: string;
	key_endpoints: Endpoint[];
	/** Set when no curated snippet exists for the persona's language: an
	 *  instruction for the agent to translate the HTTP flow into that
	 *  language when presenting it. Null for curated languages. */
	agent_note: string | null;
};

const COMMON_ENDPOINTS: Record<Goal, Endpoint[]> = {
	"internal-tool": [
		{ method: "POST", path: "/v1/pages", description: "Create pages in your databases" },
		{ method: "POST", path: "/v1/data_sources/{id}/query", description: "Query database rows with filters and sorts" },
		{ method: "PATCH", path: "/v1/pages/{id}", description: "Update page properties" },
	],
	"public-integration": [
		{ method: "POST", path: "/v1/oauth/token", description: "Exchange the OAuth code for an access token" },
		{ method: "GET", path: "/v1/users/me", description: "Identify the bot and the authorizing user" },
		{ method: "POST", path: "/v1/search", description: "Find the pages a user shared with your integration" },
	],
	automation: [
		{ method: "POST", path: "/v1/pages", description: "Create pages from external events" },
		{ method: "PATCH", path: "/v1/pages/{id}", description: "Update statuses when things change upstream" },
		{ method: "GET", path: "/v1/data_sources/{id}", description: "Read the schema you are syncing into" },
	],
	"ai-agent": [
		{ method: "POST", path: "/v1/search", description: "Ground agent answers in workspace content" },
		{ method: "GET", path: "/v1/pages/{id}", description: "Read page context for the agent" },
		{ method: "POST", path: "/v1/pages", description: "Let the agent write results back" },
	],
	exploring: [
		{ method: "GET", path: "/v1/users/me", description: "Your first call — verify your token works" },
		{ method: "POST", path: "/v1/search", description: "See what your integration can access" },
		{ method: "POST", path: "/v1/pages", description: "Create your first page" },
	],
};

const TS_SNIPPET = `import { Client } from "@notionhq/client";

// Create an integration + token at notion.so/profile/integrations,
// then share a parent page with the integration.
const notion = new Client({ auth: process.env.NOTION_API_TOKEN });

const page = await notion.pages.create({
  parent: { page_id: process.env.PARENT_PAGE_ID! },
  properties: {
    title: { title: [{ text: { content: "My first Notion API page" } }] },
  },
});

console.log("Created:", page.url); // paste this URL back to DevQuest!`;

const PY_SNIPPET = `import os
from notion_client import Client

# Create an integration + token at notion.so/profile/integrations,
# then share a parent page with the integration.
notion = Client(auth=os.environ["NOTION_API_TOKEN"])

page = notion.pages.create(
    parent={"page_id": os.environ["PARENT_PAGE_ID"]},
    properties={
        "title": {"title": [{"text": {"content": "My first Notion API page"}}]}
    },
)

print("Created:", page["url"])  # paste this URL back to DevQuest!`;

const CURL_SNIPPET = `# Create an integration + token at notion.so/profile/integrations,
# then share a parent page with the integration.
curl -X POST 'https://api.notion.com/v1/pages' \\
  -H "Authorization: Bearer $NOTION_API_TOKEN" \\
  -H 'Notion-Version: 2025-09-03' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "parent": { "page_id": "'$PARENT_PAGE_ID'" },
    "properties": {
      "title": { "title": [{ "text": { "content": "My first Notion API page" } }] }
    }
  }'
# The response includes "url" — paste it back to DevQuest!`;

const BY_LANGUAGE: Record<string, Pick<StarterCode, "sdk_install" | "snippet_language" | "snippet">> = {
	typescript: {
		sdk_install: "npm install @notionhq/client",
		snippet_language: "typescript",
		snippet: TS_SNIPPET,
	},
	python: {
		sdk_install: "pip install notion-client",
		snippet_language: "python",
		snippet: PY_SNIPPET,
	},
	curl: {
		sdk_install: "# no SDK needed — curl ships with your OS",
		snippet_language: "shell",
		snippet: CURL_SNIPPET,
	},
};

/** Starter code for a persona. Returns null when no language is set.
 *  Curated languages get their hand-written snippet; anything else gets the
 *  canonical HTTP flow plus an agent_note asking the agent to translate it
 *  into the developer's language (tools for state, AI for reasoning). */
export function starterCodeFor(persona: Persona): StarterCode | null {
	if (!persona.language) return null;
	const endpoints = COMMON_ENDPOINTS[persona.goal ?? "exploring"] ?? COMMON_ENDPOINTS.exploring;
	const base = BY_LANGUAGE[persona.language.toLowerCase()];
	if (base) return { ...base, key_endpoints: endpoints, agent_note: null };

	return {
		sdk_install: `# No official Notion SDK for ${persona.language} — any HTTP client works`,
		snippet_language: "shell",
		snippet: CURL_SNIPPET,
		key_endpoints: endpoints,
		agent_note:
			`No curated ${persona.language} snippet exists. When presenting this to the developer, ` +
			`translate the HTTP flow above into idiomatic ${persona.language} using its standard ` +
			`HTTP client, keeping the token and parent page ID as environment variables and the ` +
			`page title "My first Notion API page" so verify_first_call still works.`,
	};
}
