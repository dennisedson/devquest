# DevQuest Roadmap

## v1 — MVP (current)

Adaptive developer onboarding for Notion's API. AI-driven conversation
discovers a developer's persona, ranks docs deterministically, and generates
a personalized getting-started guide in chat.

- [x] Docs knowledge base (daily sync from llms.txt)
- [x] Persona tools (create, update, returning-user lookup via find_persona)
- [x] Deterministic doc ranking by persona
- [x] generate_guide tool + Custom Agent system prompt
- [x] Zero-config database discovery (no env vars for DB IDs)
- [ ] Custom Agent creation + end-to-end testing
- [ ] Persona contrast testing (Day 4)
- [ ] Demo video (Day 5-7)

## v1.1 — Multi-User Personas

- [x] **Shipped (workaround):** personas are keyed by the developer's name.
  The agent knows who it's chatting with and passes first + last name as
  `persona_id`; matching is normalized (case/whitespace) server-side, and
  `update_persona` upserts. Different developers never see each other's
  records. Personalization-grade identity, not authentication.

**Remaining (blocked on platform):** `CapabilityContext` (Workers SDK) only
exposes `notion: Client` — no user identity, so name collisions are possible
and identity is LLM-asserted. When Notion adds a `user` field to the tool
execution context (see INTERVIEW-NOTES #2):
- Add a `People` property to the personas database
- Key lookups to the calling user's Notion ID; keep name as display title
- Multi-user support becomes cryptographically sound out of the box

## v2 — Living Guide Page

The guide becomes a persistent Notion page the developer keeps and the system
learns from. Replaces the ephemeral chat response with a tangible artifact.

**Guide page structure:**
- "Current Persona" callout showing goal/language/experience/api_comfort
- Reading path as to-do items (checkable by the developer)
- Suggested first project with a starter checklist
- Conversation log — timestamped notes from each session

**Feedback loop — on return visits the agent:**
1. Reads the guide page (which to-dos are checked, what's changed)
2. Updates the persona if they've leveled up (all beginner docs done →
   bump to intermediate)
3. Re-ranks and rewrites the reading path with new recommendations
4. Appends to the conversation log

**New tools:**
- [x] `create_guide_page` — writes the initial page with structured blocks
- [x] `read_guide_page` — reads back completion state and conversation log
- [x] `update_guide_page` — appends log entries, rewrites reading path
- [x] System prompt updated for guide page flow (rules 6-8)
- [ ] End-to-end testing: create → read → check items → read again → update

## v2.1 — Progressive Guide (the guide grows with the developer)

The guide page isn't static — it matures as the developer does. Three
interlocking features make the guide a living progression system.

**Auto-leveling:**
- [x] `checkLevelUp` — triggers at ≥70% reading path completion
- [x] Level progression: beginner → intermediate → advanced (experience),
  none → some → fluent (api_comfort)
- [x] `read_guide_page` returns `level_up` and `guide_level` fields
- [x] `update_guide_page` returns `level_up` based on pre-refresh progress

**Progressive sections:**
- [x] `guideLevel` maps persona to getting-started / going-deeper /
  advanced-patterns
- [x] "Going Deeper" section (pagination, rate limiting, webhooks) —
  unlocks at intermediate
- [x] "Advanced Patterns" section (sync pipelines, OAuth, error handling) —
  unlocks at advanced
- [x] Sections built into `buildGuideBlocks` and appear based on persona level

**Milestone timeline:**
- [x] Milestones section on guide page with checkable achievements
- [x] Five milestones: complete reading path, first API call, first project,
  level up, ship to production
- [x] System prompt rule 12 — agent celebrates level-ups and references
  milestones

- [ ] E2E: create guide → check items → read → verify level-up triggers →
  refresh reading path → confirm new sections appear

## v3 — Company Context

A company installs DevQuest to onboard developers to *their* stack, not just
Notion's API. The system reads company-specific context from Notion and shapes
the guide around it.

**How it works:**
- Company creates a page titled "DevQuest Company Config" with their stack info
  (languages, frameworks, focus areas, onboarding notes)
- `read_company_context` finds it by title and parses structured fields + freeform content
- Scoring boosts docs matching company languages and focus areas
- System prompt pre-fills persona suggestions from company context

**Implementation:**
- [x] `read_company_context` tool — zero-config page discovery by title
- [x] `CompanyBoost` scoring in `scoreDoc` / `rankDocs`
- [x] System prompt rules 1 + 9 updated for company context
- [ ] End-to-end testing with a sample company config page

## v3.1 — Team-Level Config

Different teams within a company operate differently. A frontend team uses
TypeScript and React; a data team uses Python and FastAPI. Team config
eliminates redundant onboarding questions by pre-filling persona fields
from the developer's team.

**How it works:**
- Admin creates child pages under "DevQuest Company Config" — one per team
  (e.g., "Frontend Team", "Platform Team", "Data Engineering")
- Each child page uses the same format as the company config (Languages,
  Frameworks, Focus Areas, Onboarding Notes)
- `read_company_context` discovers child pages automatically and returns
  a `teams` array
- If teams exist, the agent asks "which team are you on?" first
- Team-level values override company-level defaults (e.g., if the team
  specifies only TypeScript, language is set immediately — never asked)
- Service detection scans team content too

**Implementation:**
- [x] `TeamContext` interface
- [x] `read_company_context` discovers child_page blocks and parses each
- [x] Teams array in output schema with per-team languages/frameworks/focus
- [x] Service detection scans company + team content
- [x] System prompt rules 1 + 9 updated for team-aware onboarding
- [ ] E2E: create company config with two team child pages, verify teams
  returned and persona pre-filled correctly

## v4 — Pluggable Doc Sources

DevQuest stops being Notion-specific. Any company can add their own developer
docs as a knowledge base source alongside (or instead of) Notion's docs.

**Use cases:**
- HubSpot onboarding: sync HubSpot developer docs + Notion docs into the KB
- Internal API onboarding: sync company API docs (OpenAPI specs, internal wikis)
- Multi-platform: a company building on Notion + Stripe + Twilio gets a
  unified onboarding guide across all three

**Implementation:**
- [x] `Source` select property on KB — docs tagged by origin
- [x] `add_doc_source` tool — registers a source URL + name in a config database
- [x] `parseGenericLlmsTxt` — parser for non-Notion llms.txt files
- [x] Sync reads "DevQuest Doc Sources" config DB and fetches all registered sources
- [x] Support additional parser types (OpenAPI, sitemap, raw markdown)
- [x] Auto-detect source type from URL
- [x] `parseDocSource` router — single entry point for all parser types
- [x] Schema migrations for doc sources DB (Type column added on the fly)
- [x] Auto-detect services from company config (`KNOWN_DOC_SOURCES` mapping)
- [ ] End-to-end testing with a second source (deploy + `ntn workers sync trigger`)

## v5 — DevRel Insights Digest (the data flywheel)

DevQuest collects exactly the data DevRel teams lack — personas, reading
progress, stalls — and today it just sits in a database. v5 mines it.

**What it surfaces:**
- Goal/language/experience distribution of incoming developers
- Docs recommended often but never checked off → comprehension/content gaps
- Where beginners stall vs where advanced devs skip ahead
- Doc sources (v4) that drive the most engagement

**Implementation:**
- [x] `insights.ts` — pure aggregation: persona distributions, guide progress,
  content gaps (docs recommended but unread across guides)
- [x] "DevQuest Insights" managed DB — one row per ISO week, metrics as
  properties, narrative digest as the page body (`pageContentMarkdown`)
- [x] `insights_digest` sync — weekly (`7d`), incremental, re-running a week
  updates that week's row; caps guide reads at 20/run
- [ ] E2E: deploy + `ntn workers sync trigger insights_digest`, verify the row

**Why it matters:** reframes DevQuest from a personal onboarding tool into
documentation analytics — "your docs get feedback for the first time."

## v6 — Time to First Success

Onboarding doesn't end at reading; it ends at the developer's first 200 OK.

- [x] `verify_first_call` tool — developer runs the starter snippet (which
  creates "My first Notion API page"), pastes the page URL back; the tool
  retrieves the page (proof of a working call), stamps a First Success date
  on the persona, and returns time-to-first-success in hours
- [x] "First Success" date property on personas (auto-migrated via
  `ensureDbProperties`)
- [x] System prompt rule 11 — offer starter code, verify, celebrate
- [ ] E2E: run snippet with a real token, verify milestone + celebration
- [ ] Feed time-to-first-success into the v5 digest (avg/median per week)

## v7 — Persona-Aware Starter Code

- [x] `starter-code.ts` — install command, runnable snippet, and key endpoints
  per language × goal; snippet intentionally creates the page that
  `verify_first_call` (v6) verifies — one continuous flow
- [x] "⚡ Start Coding" section on guide pages (install + code blocks +
  endpoints for their goal)
- [x] `get_starter_code` tool for showing code in chat pre-guide
- [ ] E2E: confirm code blocks render correctly on a real guide page

## v8 — Docs Change Awareness

- [x] "First Seen" date property on the KB; the sync carries a url→date map
  in persistent sync state, so first-seen dates survive daily replace cycles
- [x] `find_persona` returns `whats_new`: docs first seen after the persona's
  last edit (≈ last visit), ranked by persona relevance, top 5
- [x] System prompt rule 1 — weave what's-new into returning-dev greetings
- [ ] E2E: add a doc source, re-sync, confirm returning dev sees it as new
- [ ] Content-change detection (hash summaries, not just URLs)

## Future — Scoring Intelligence

The deterministic scoring is a solid baseline but treats persona fields
independently. A beginner at APIs who's an expert TypeScript dev gets buried
in beginner docs across the board.

**Approaches to explore:**
1. ~~Per-field difficulty modifiers~~ — **shipped** (api_comfort drives
   Auth/Reference/Webhooks difficulty, experience drives the rest)
2. LLM-assisted ranking that takes freeform context into account ("I've
   built REST APIs before but never used Notion's")
3. Hybrid: deterministic first pass for consistency, LLM re-rank of top-N
   for nuance
4. Learning from the living guide — docs the developer skipped or completed
   quickly inform future rankings
5. Explicit recommendation feedback — a "was this helpful?" checkbox per doc
   on the guide page; unhelpful docs get demoted for similar personas (the
   concrete first step toward #4)
