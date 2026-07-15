# DevQuest — Setup Guide

## What you get after install

| Component | Created by | When |
|---|---|---|
| **DevQuest Docs Knowledge Base** | `docs_index` sync | Automatically on first sync (daily refresh) |
| **DevQuest Personas** database | `setup_devquest` tool | First conversation (agent calls it automatically) |
| **DevQuest Doc Sources** database | `add_doc_source` tool | On demand when external doc sources are registered |
| **DevQuest Company Config** page | Admin (manual) | Optional — admin creates it to customize onboarding |
| **Guide Pages** | `create_guide_page` tool | One per developer, created during onboarding |

---

## Fresh workspace checklist (e.g. new trial account)

Everything is code or config — nothing from an old workspace needs migrating.

1. New account → Business trial → Settings → Features → **Workers** → activate
2. `ntn logout && ntn login` (auth against the NEW workspace)
3. `npm run check && ntn workers deploy`
4. Upload environment variables to the new worker:
   ```bash
   ntn workers env set NOTION_API_TOKEN=ntn_...       # personal access token for this workspace
   ntn workers env set NOTION_API_BASE_URL=https://api.notion.com
   ```
   Create the token: workspace Settings → My connections → Develop or manage integrations.
5. `ntn workers sync trigger docs_index` → wait for `ntn workers sync status`
   to finish (populates the KB + stamps First Seen dates for v8)
6. Create a parent page (e.g. "DevQuest"), then:
   `ntn workers exec setup_devquest -d '{"parent_page":"https://app.notion.com/p/DevQuest-39e11b195f6c80849a01df0e5e03f30d"}'`
7. Recreate content pages under it: **DevQuest Company Config** (paste
   `test/fixtures/company-config-test.md` for the torture test, or the simple
   version from TEST-CHECKLIST §4) and team pages (Platform Team, etc.)
8. **Share the parent page with the worker's connection** (••• → Connections)
   so tools can see manually created pages — this caused the Platform Team
   miss last time
9. Create the Custom Agent: paste `src/system-prompt.md`, attach all tools
   except `setup_devquest`/`whoami`, auto-approve the write tools
10. Smoke test: `ntn workers exec read_team_context --local -d '{"team":"platform"}'`
    → expect found=true, then run one live agent conversation

Credit discipline: iterate in `simulate/DEVQUEST-SIM.md` (free — Workers beta);
spend agent credits only on final rehearsals and the recording.

---

## Install steps

### 1. Prerequisites

- Notion **Business or Enterprise plan** — Workers are not available on Free
  or Plus. During beta (until August 11, 2026), Workers are free on Business+.
  After that, they consume Notion credits (~$0.0023 per run).
- Node.js 18+
- Notion CLI: `curl -fsSL https://ntn.dev | bash`
- Workspace admin must enable Workers in Settings → Workers (off by default)

### 2. Deploy

```bash
git clone <repo-url> && cd notionDocsChooseYourOwnAdventure
npm install
ntn login
npm run check && ntn workers deploy
```

The first deploy creates the Worker and starts the `docs_index` sync. Within
minutes, a **DevQuest Docs Knowledge Base** database appears in the workspace
with ~160 Notion developer docs, classified by category, difficulty, and
persona tags.

### 3. Create the Custom Agent

This step is manual — the Workers SDK does not yet support bundling agent
configuration with a deployment (see INTERVIEW-NOTES.md).

1. In Notion sidebar → **New agent** (or search → "Custom Agent")
2. Name it **DevQuest**
3. Paste the contents of `src/system-prompt.md` into the system prompt field
4. Under **Tools**, attach these worker tools:

   | Tool | Type | Auto-approve? |
   |---|---|---|
   | `find_persona` | Read | Yes (read-only) |
   | `update_persona` | Write | **Yes** (writes on every learned field) |
   | `query_docs` | Read | Yes (read-only) |
   | `create_guide_page` | Write | **Yes** (creates the guide page) |
   | `read_guide_page` | Read | Yes (read-only) |
   | `update_guide_page` | Write | **Yes** (refreshes guide + session log) |
   | `read_company_context` | Read | Yes (read-only) |
   | `add_doc_source` | Write | **Yes** (registers external doc sources) |
   | `setup_devquest` | Write | **Yes** (one-time DB creation) |

   Skip `whoami` — it's a diagnostic tool, not needed for conversations.

5. **Important:** Set all write tools to auto-approve. Without this, the agent
   prompts for confirmation on every persona update and the experience stutters.

### 4. (Optional) Company context

Create a Notion page titled exactly **"DevQuest Company Config"** with content
like:

```
**Languages:** Python, TypeScript
**Frameworks:** FastAPI, React
**Focus Areas:** webhooks, automation
**Onboarding Notes:** New developers should focus on connecting our internal
services to Notion via webhooks.
```

**Important:** Share this page with the DevQuest connection (click `···` →
Add connections → DevQuest). The integration can only access pages explicitly
shared with it.

If the config mentions known services (Stripe, HubSpot, Vercel, etc.), the
agent automatically registers their developer docs as additional knowledge
base sources.

### 5. Test

Open the DevQuest agent and say something like:

> "Hey, I want to build an internal dashboard in Python"

The agent should:
- Call `find_persona` and `read_company_context` in parallel
- Infer goal and language from your message
- Ask about experience or API comfort (one question at a time)
- Create a personalized guide page when all four fields are set

---

## For returning developers

Start a new conversation. The agent calls `find_persona` with your name,
finds your existing record, and picks up where you left off. If you've
checked off docs on your guide page, it notices and adapts.

---

## Adding external doc sources

The agent handles this conversationally. Say something like:

> "We also use Stripe — can you add their docs?"

It calls `add_doc_source` with the Stripe llms.txt URL. The next sync cycle
indexes those docs into the KB alongside Notion's. Supported source formats:

- **llms.txt** — markdown link index (most common)
- **OpenAPI spec** — JSON endpoint definitions
- **Sitemap XML** — URL discovery from sitemap.xml
- **Raw markdown** — single markdown file split by headings

Source type is auto-detected from the URL.

---

## Useful CLI commands

```bash
# Deploy
npm run check && ntn workers deploy

# Trigger a sync manually
ntn workers sync trigger docs_index

# Check sync status
ntn workers sync status

# Reset sync state (re-index from scratch)
ntn workers sync state reset docs_index

# Test a tool from CLI
ntn workers exec find_persona -d '{"persona_id":"Dennis Edson"}'
ntn workers exec read_company_context -d '{}'

# View run logs
ntn workers runs logs <runId>
```

---

## Architecture notes

- **Zero-config database discovery:** All databases are found by title via
  `notion.search()` at runtime. No database ID env vars needed.
- **Schema migrations:** `ensureDbProperties()` adds missing columns to
  existing databases on the fly. Upgrades don't require users to delete and
  recreate databases.
- **Sync:** Mode `replace`, schedule `1d`, batch size 100. Aborts if llms.txt
  parses to 0 entries (format-change protection).
- **Scoring:** Deterministic persona-based ranking with company boost weights.
  Company-matching docs get +3 (vs +2-3 for persona field matches).
- **Multi-user:** Personas keyed by developer name (passed by the agent from
  conversation context). Each developer gets their own persona and guide page.
