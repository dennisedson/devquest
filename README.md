# DevQuest

Adaptive developer onboarding for Notion's API, built on Notion Workers and
Custom Agents. The AI runs the conversation; the Worker tools handle state and
context retrieval. See `DevQuest-Implementation-Plan` for the full design.

## Status

v1–v8 built (persona, living guide pages, company context, pluggable doc
sources, insights digest, first-success verification, starter code, change
awareness). See `roadmap.md` for the full picture and remaining E2E items,
`SETUP.md` for deployment, and `INTERVIEW-NOTES.md` for platform findings.

## Layout
```
src/
  index.ts          Worker: 2 managed DBs, 2 syncs, 12 tools
  docs-parser.ts    Parsing/classification of docs sources (llms.txt, OpenAPI, sitemap, markdown)
  persona.ts        Persona types, personas DB schema, page read/write helpers
  query-docs.ts     Pure ranking of KB docs against a persona
  starter-code.ts   Install + snippet + endpoints per language × goal (v7)
  insights.ts       Weekly DevRel digest aggregation (v5)
  system-prompt.md  Custom Agent system prompt (paste into Notion)
scripts/
  test-parser.ts    Parser test (npm run test:parser)
  test-scoring.ts   Persona-contrast ranking test (npx tsx scripts/test-scoring.ts)
test/fixtures/
  llms.txt                 Snapshot of the live docs index (July 2026)
  company-config-test.md   Company-config torture test (paste into Notion)
```

## Commands
```bash
npm install
npm run check          # typecheck
npm run test:parser    # verify parser against fixture
npx tsx scripts/test-scoring.ts   # persona contrast + scoring assertions
ntn workers deploy     # deploy to Notion (see SETUP.md)
```
