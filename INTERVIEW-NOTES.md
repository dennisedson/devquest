# DevQuest — Interview Notes

Issues, workarounds, and platform feedback discovered while building DevQuest.
Organized as talking points for the founding developer advocate interview.

---

## Platform issues encountered

### 1. No `worker.agent()` — Custom Agents can't be bundled with Workers

**Problem:** The Workers SDK has `worker.tool()`, `worker.sync()`,
`worker.webhook()`, and `worker.database()` — but no way to define a Custom
Agent programmatically. Admins must manually create the agent, paste the
system prompt, enable each tool, and set permissions.

**Impact:** A marketplace install that should be one-click requires 5+ manual
steps. The system prompt is the soul of DevQuest — if it's pasted wrong or
outdated, the experience breaks.

**What I'd propose:** `worker.agent()` that bundles system prompt, tool
selection, tool permissions, and suggested prompts. Deploy ships the agent
config; Notion creates/updates the Custom Agent automatically.

```typescript
// Aspirational API
worker.agent("devquest", {
  title: "DevQuest",
  systemPrompt: fs.readFileSync("./src/system-prompt.md", "utf-8"),
  tools: {
    find_persona: { autoApprove: true },
    update_persona: { autoApprove: true },
    query_docs: { autoApprove: true },
    // ...
  },
  suggestedPrompts: [
    "I'm new here — what should I learn first?",
    "I'm building a public integration in TypeScript",
  ],
});
```

### 2. `CapabilityContext` has no user identity

**Problem:** Tool `execute` functions receive `{ notion: Client }` but no
information about which user triggered the tool call. Pages created by tools
are authored by the bot identity, so `Created By` can't distinguish
developers.

**Impact:** Multi-user personas required a workaround. We key personas by
developer name (passed by the agent from conversation context) instead of
Notion user ID. This works but relies on the LLM correctly identifying the
user — it's not cryptographically sound.

**Downstream blocker — guide page privacy:** Without user identity, bot-created
pages can't be scoped to the requesting user. Guide pages inherit visibility
from their parent, so in a multi-user workspace every developer can see every
other developer's guide. The API supports sharing pages with specific users,
but that requires the user's Notion ID — which we don't have. This makes
user identity not just a persona convenience but a privacy blocker for any
multi-user agent that creates per-user content.

**What I'd propose:** Add `user` to `CapabilityContext`:

```typescript
execute: async (input, { notion, user }) => {
  // user.id — Notion user ID of the person chatting
  // user.name — display name
}
```

**Empirical confirmation:** `users.me()` from a worker tool returns
`owner: { type: "workspace", workspace: true }` — the token is
workspace-owned with no connection to the person in the conversation.
There is no path to user identity from the runtime token.

With `user.id`, tools could create pages and immediately restrict permissions
to just that user — making per-developer guide pages private by default.

### 3. `SchemaBuilder.optional()` doesn't exist

**Problem:** The `j` schema builder from `@notionhq/workers/schema-builder`
only has `.describe()` and `.nullable()`. There is no `.optional()` method,
and all properties in `j.object()` are implicitly required.

**Impact:** For tools like `update_persona` where every field is optional
(partial updates), we had to use `.nullable()` — but the platform rejects
`null` values for nullable string fields at runtime (even though the schema
says they're allowed).

**Workaround:** Used sentinel strings (e.g., `persona_id = "new"` instead of
`null`) for fields that need to be absent vs present.

**What I'd propose:** Add `.optional()` to `SchemaBuilder` so properties can
be omitted from the input entirely, matching standard JSON Schema behavior.

**Related gotcha:** `outputSchema` is enforced strictly at runtime
(`additionalProperties: false`). Adding a field to a tool's return value
without updating its outputSchema doesn't just drop the field — it 400s the
entire tool call (`InvalidToolOutputError`). Fine as a contract, but the
failure mode punishes additive, backwards-compatible changes; a warn-and-strip
mode would be friendlier.

### 4. `databases.update()` unreliable for adding properties

**Problem:** When adding a new property to an existing database via
`notion.databases.update()`, the property sometimes isn't recognized
immediately — subsequent `pages.update()` calls fail with "X is not a
property that exists."

**Impact:** Runtime schema migrations (adding "Guide Page ID" to the personas
DB) would crash `create_guide_page`. Had to wrap in try/catch with best-effort
semantics.

**Workaround:** Built `ensureDbProperties()` — retrieves current schema,
diffs against required properties, only calls `databases.update` for missing
ones, wrapped in try/catch so it never crashes the caller.

### 5. Page permissions model creates onboarding friction

**Problem:** Internal integrations can only access pages explicitly shared
with them. There's no "grant access to all pages" option. Sharing a parent
page grants access to children, but teamspace roots can't be shared with
integrations.

**Impact:** Users create a "DevQuest Company Config" page but the agent can't
find it because the page isn't shared with the integration. This is confusing
— the page exists, the title matches, but `notion.search()` returns nothing.

**What I'd suggest documenting:** Clear install guidance that says "share your
DevQuest parent page with the integration" as step 1. Or a workspace-level
permission that grants an integration access to all pages (opt-in by admin).

**Live example:** manually created team pages ("Platform Team") sat right next
to agent-created pages in the same teamspace, yet `notion.search()` from a
tool couldn't see them — the agent's connection had access to the pages it
created (KB, guides, personas) but not to the human-created siblings. From the
user's seat this is baffling: the page is visibly *there*. The failure is
silent (search just returns nothing), so the agent reports "no such page."
Diagnosis trick: run the same tool via `ntn workers exec --local` with a
personal access token — if it works there but not in chat, it's permissions.

### 6. No way to trigger sync from a tool

**Problem:** When `add_doc_source` registers a new docs source, the actual
indexing happens on the next scheduled sync (daily). There's no
`worker.triggerSync("docs_index")` API available from within a tool handler.

**Impact:** After adding a doc source, the developer has to wait up to 24
hours (or manually run `ntn workers sync trigger`) before those docs appear
in the KB. The agent says "it will be indexed on the next sync run" which is
accurate but not instant.

**What I'd propose:** A `triggerSync(syncKey)` method available in tool
execute contexts, so `add_doc_source` can kick off an immediate re-index.

### 7. Workers/CLI docs are missing from llms.txt

**Problem:** `developers.notion.com/llms.txt` indexes ~160 doc pages but none
of the `/workers/*` or `/cli/*` pages — the platform's newest, most strategic
docs are absent from its own machine-readable index.

**Impact:** Ironic for DevQuest specifically: an app that onboards developers
by indexing Notion's docs can't recommend the Workers docs, because the index
doesn't include them. Any AI tool consuming llms.txt has the same blind spot.

**What I'd propose:** Add the Workers, CLI, and Agent SDK sections to
llms.txt. (Interview meta-point: this is exactly the kind of gap a docs
knowledge base surfaces automatically — v5's content-gap detection would have
flagged it.)

### 8. Managed databases are sync-only — tools can't write to them

**Problem:** `worker.database()` creates managed databases, but they're only
writable by syncs ("not generic worker storage" — one line in the SDK
reference). Tools needing to persist state must create regular databases via
the API and rediscover them at runtime.

**Impact:** The personas database couldn't be declared in code alongside the
docs KB. We needed a separate `setup_devquest` bootstrap tool plus title-based
discovery via `notion.search()` — which is fuzzy, so results must be re-verified
by exact title match client-side.

**What I'd propose:** Either writable worker databases
(`worker.database({ type: "owned" })` with `db.pages.create()` from tools), or
at minimum expose the managed database's runtime ID to tool contexts so
discovery isn't title-string matching.

**Observed failure mode of title discovery:** during testing, a *page* named
"DevQuest Personas" existed but the *database* didn't — search filtered to
`data_source` correctly returned nothing, and to the user this is
indistinguishable from a bug ("the thing with that name is right there in my
sidebar"). Pages and databases look identical in the sidebar; any design that
keys on titles inherits that ambiguity. Stable IDs would eliminate the whole
class.

### 9. Docs examples use the old API shape; the runtime SDK is v5

**Problem:** The Workers api-client guide shows `notion.databases.query({
database_id })` and `parent: { database_id }` (2022-06-28 shapes), but the
injected client is SDK v5 / 2025-09-03, where querying moved to
`notion.dataSources.query` and `databases.create` takes `initial_data_source`.

**Impact:** Code written faithfully from the official examples fails at
runtime. We burned a debugging cycle on `databases.create` rejecting the
documented shape, and defensive try/both-shapes code lingered until we
confirmed the v5 forms.

**What I'd propose:** Regenerate the Workers guide examples against the
current SDK version, and state the injected SDK version explicitly in the
api-client doc.

### 10. Write-tool permission prompts break conversational flow

**Problem:** Tools without `readOnlyHint` require user confirmation on every
call by default. DevQuest calls `update_persona` after nearly every developer
reply — each one interrupts the conversation with a permission prompt.

**Impact:** The core UX ("watch the persona build itself as you chat") stutters
badly until you find the per-tool auto-approve setting buried in the agent
configuration. Most builders won't know it exists.

**What I'd propose:** Let workers declare a suggested permission policy per
tool (see `worker.agent()` proposal in #1), and surface the auto-approve
setting during tool attachment, not three menus deep.

### 11. No `--watch` mode for development

**Problem:** The CLI has no file watcher. The dev cycle is
`edit → ntn workers deploy → test in Notion`, with each deploy taking several
seconds. There's `ntn workers exec --local` for testing individual tools, but
no way to auto-deploy on file save or hot-reload tool changes into an active
Custom Agent session.

**Impact:** Iteration is slow, especially when tuning agent behavior where
you need to deploy, open a new conversation, replay the same prompt, and
check the result. Compare to `wrangler dev` (Cloudflare) or `vercel dev`
which give instant feedback.

**What I'd propose:** `ntn workers dev` that watches `src/`, auto-builds, and
either live-patches the running worker or deploys incrementally. Bonus: pipe
tool execution logs to the terminal in real time.

### 12. Workers + public connections distribution story is unclear

**Problem:** Workers are deployed to a single workspace via `ntn workers deploy`.
The docs explain how to create public connections (OAuth) for multi-workspace
distribution, but never explain how Workers capabilities (tools, syncs,
webhooks) distribute when another workspace installs the public connection.
Does Notion host one copy of the Worker and route requests per-workspace? Does
each workspace get its own instance? Does the installing workspace need the
CLI at all?

**Impact:** A developer building a Worker-based product (like DevQuest) has no
documented path from "works on my workspace" to "installable by others." The
public connections guide and the Workers guide exist in isolation — neither
references the other. This is the single biggest gap for anyone trying to ship
a Worker to the Marketplace.

**What I'd propose:** A "Distributing Workers" guide that covers: how Workers
attach to public connections, what happens at install time in another
workspace, whether managed databases are created per-workspace, and a
worked example of the full lifecycle from `ntn workers new` to Marketplace
listing.

### 13. Workers require Business+ plan — limits audience

**Problem:** Workers are only available on Business and Enterprise plans. Free
and Plus plan users cannot use Workers at all. During beta, Workers are free
on Business+; starting August 11, 2026, they require Notion credits (~$0.0023
per run).

**Impact:** Any Worker-based tool on the Marketplace immediately excludes Free
and Plus workspaces. For DevQuest, this means the target audience is limited
to companies already on Business or Enterprise — which aligns with the company
onboarding use case but cuts off individual developers and small teams.

**Worth discussing:** This is a reasonable platform constraint (Workers need
server resources), but it should be prominently documented in the Workers
overview and Marketplace listing guide so builders know their audience
constraints upfront.

### 14. No free developer tier for building Workers

**Problem:** To build and test a Worker, the developer needs a Business or
Enterprise workspace. There's no free developer sandbox, no "developer plan,"
and no way to deploy a Worker without paying for Business ($18/user/month
billed monthly). The Workers quickstart doesn't mention this — a developer
can scaffold a project and write code, but `ntn workers deploy` fails unless
the workspace is on a paid plan that supports Workers.

**Impact:** This creates a significant barrier to entry for the developer
ecosystem. Compare to Cloudflare Workers (free tier with 100k requests/day),
Vercel (free hobby tier), Shopify (free partner development stores), or
HubSpot (free developer accounts with full API access and test portals).
Developers exploring the Notion platform — exactly the audience DevQuest
targets — may not have a Business account and can't justify $18/month to
experiment.

**What I'd propose:** A free developer tier or developer sandbox workspace
that allows Worker deployment with reasonable limits (e.g., capped runs,
single Worker, no production SLA). This removes friction for builders who
want to prototype before committing a team to Business. Alternatively, extend
the Business trial period specifically for developers building integrations,
or offer a free "developer workspace" through the Creator dashboard.

### 11. No sandbox/testing tier for Custom Agents — credits gate all testing

**Problem:** When workspace AI credits run out, ALL Custom Agents pause. There
is no free/sandbox tier for agent development, no per-agent budget, and no way
to dry-run an agent conversation without burning production credits.

**Impact:** Mid-E2E-testing, the trial's credits ran out and every test was
blocked behind an upgrade. Prompt iteration is the most credit-hungry phase of
agent development — exactly when a builder can least justify paying per turn.

**Workaround:** Built a simulator (`simulate/DEVQUEST-SIM.md`): a coding agent
(Claude Code) plays the DevQuest role using its own model, executing the real
worker tools via `ntn workers exec` — which stays free during the Workers
beta. Full loop, real databases, zero Notion credits. Bonus finding: the CLI
is genuinely agent-ready; the simulator took under an hour.

**What I'd propose:** A developer/sandbox tier for Custom Agents (N free runs
per day for agents in "draft" state), or let agent runs bill to a
bring-your-own-key model via the External Agents API once it ships.

---

## What we built (feature summary for the panel)

| Version | Feature | Tools |
|---|---|---|
| **v1** | Adaptive persona + deterministic doc ranking | `setup_devquest`, `update_persona`, `find_persona`, `query_docs` |
| **v2** | Living Guide Page (persistent Notion page with to-dos, session log) | `create_guide_page`, `read_guide_page`, `update_guide_page` |
| **v3** | Company context (customize onboarding to company stack) | `read_company_context` |
| **v4** | Pluggable doc sources (any llms.txt, OpenAPI, sitemap, markdown) | `add_doc_source` |
| **v4+** | Auto-detect services from company config, schema migrations | Built into existing tools |

## Key design decisions worth discussing

1. **Tools for state, AI for reasoning** — All tools are deterministic. The
   LLM decides *when* to call them and *how* to present results, but scoring,
   ranking, and persistence are pure functions. No LLM in the ranking loop.

2. **Zero-config database discovery** — Every database is found by title via
   `notion.search()` at runtime. No env vars, no database ID secrets. Any
   workspace can install DevQuest with just `deploy → go`.

3. **Deterministic scoring with per-field difficulty** — `api_comfort` drives
   difficulty for API-mechanics docs (Auth, Reference, Webhooks);
   `experience` drives everything else. An expert TypeScript dev who's new to
   REST gets beginner auth docs without being buried in beginner material
   across the board.

4. **Schema migrations in code** — `ensureDbProperties()` means app updates
   never require users to delete databases. New columns are added on the fly.

5. **Name-based multi-user** — Workaround for missing user identity in
   `CapabilityContext`. Personas keyed by developer name, normalized for
   case/whitespace. Works for demo; real fix requires platform support.

6. **Company boost scoring** — Company-matching docs get +3 weight (tripled
   from +1). When a company config exists, the guide is genuinely shaped by
   the company's stack, not just lightly tinted.

---

## Demo flow (5 minutes)

1. **Cold start** (1 min): New developer says "I want to build an internal
   dashboard in Python." Watch the agent infer fields, create persona, weave
   in docs, and generate a guide page.

2. **Contrast** (1 min): Different persona — "advanced TypeScript dev building
   a public integration, fluent with REST APIs." Compare guide pages
   side-by-side. Almost no doc overlap.

3. **Company context** (1 min): Show the DevQuest Company Config page. New
   conversation — agent leads with company stack, auto-registers HubSpot
   docs, guide skews toward company focus areas.

4. **Returning developer** (1 min): Check off some to-dos on the guide page.
   New conversation — agent reads progress, congratulates, refreshes the
   reading path.

5. **The pitch** (1 min): This is what developer onboarding looks like when
   it's adaptive, persistent, and built into the tool developers already use.
   Every company's onboarding is different — DevQuest makes Notion the
   platform that handles that.
