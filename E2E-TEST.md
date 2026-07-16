# DevQuest — End-to-End Test (OAuth installer flow)

Full clean-slate test of the `oauth-installer` branch: OAuth install → questionnaire →
worker deploy → agent conversations → live stack sync. File failures as GitHub issues
with the phase/step number.

**Terms used below**
- **Master workspace** — your workspace; produces the central docs KB.
- **Test workspace** — a separate workspace acting as the "customer."
  ⚠️ Must be a DIFFERENT workspace than master (same Notion account is fine).
  Installing/deploying into master overwrites the producer worker's env (its
  sync would then consume its own feed and the KB silently freezes) and
  creates duplicate-titled databases that break discovery-by-title everywhere.
  Phases 4–6 need the test workspace on Business+ with Workers enabled;
  phases 0–3 and 7 work on any plan.
- `APP_URL` — `https://devquest.slowlybalding.com`
- Logs — Vercel dashboard → project → Logs (every failure path logs its cause there).

---

## Phase 0 — Preflight (one-time)

- [ ] **0.1** Vercel project: root directory = `installer`, production branch = `oauth-installer`,
      latest deployment is commit `a356afa` or later. ⚠️ Never use "Redeploy" on an old
      deployment — it rebuilds *that commit* and pins stale code.
- [ ] **0.2** Env vars (Production): `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`,
      `SESSION_SECRET`, `APP_URL` (no trailing slash), `NOTION_MASTER_TOKEN`, and the
      attached Redis store's `REDIS_URL`. Redeploy after any env change.
- [ ] **0.3** Notion public integration: redirect URI is exactly
      `$APP_URL/api/auth/callback`; Read/Insert/Update content capabilities enabled.
- [ ] **0.4** Master KB reachable: the `NOTION_MASTER_TOKEN` integration is connected to
      the master workspace's **DevQuest Docs Knowledge Base** database (or an ancestor
      page). If not, `/api/kb` returns 503 and workers silently fall back to llms.txt.
- [ ] **0.5** Master worker has synced at least once (`ntn workers sync status` in the
      master workspace) so the master KB has rows. Optional: add rows to the master
      **DevQuest Doc Sources** DB (e.g. Stripe, Anthropic — labels must match the
      questionnaire chips) so those serve centrally.
- [ ] **0.6** Webhook subscription: notion.so/my-integrations → DevQuest → Webhooks →
      URL `$APP_URL/api/webhooks/notion`, event `page.content_updated`. Notion POSTs a
      one-time `verification_token` — copy it from the `/api/webhooks/notion` function
      logs and paste it back into the webhook settings to activate.

## Phase 1 — Install flow

- [ ] **1.1** Visit `APP_URL`. Landing page loads; footer mentions "a few quick
      (skippable) questions."
- [ ] **1.2** Connect to Notion → choose the **test workspace** → authorize.
- [ ] **1.3** You land on `/setup` ("Tell us about your team"), showing the workspace name.
- [ ] **1.4** Select 2+ tools (e.g. Stripe, Anthropic). Add a **custom** source
      (e.g. name `Bun`, URL `https://bun.sh/llms.txt`) — it appears as a removable chip.
- [ ] **1.5** Teams: `frontend, backend, security`. Languages: TypeScript chip + free
      text `Go`.
- [ ] **1.6** Submit → lands on `/install` success page within ~15s.
- [ ] **1.7** Success page shows: workspace name; links for parent page, Company Config,
      your three team names, Personas DB, **Doc Sources DB**; a single `npx …#oauth-installer`
      command containing a `dvq_…` key and `APP_URL`; collapsed manual steps.
      **Save the `dvq_` key — it is shown only once.**

## Phase 2 — Workspace contents (in the test workspace)

- [ ] **2.1** DevQuest parent page exists with sub-pages.
- [ ] **2.2** Company Config: labels are **bold** (no literal `**`); Languages =
      `TypeScript, Go`; **Tools & Services** lists your picks including the custom one.
- [ ] **2.3** Team pages exist for frontend/backend/security (your names, not defaults).
- [ ] **2.4** Personas DB exists with Goal/Language/Experience/API Comfort selects.
- [ ] **2.5** Doc Sources DB has one row per selected tool **plus** the custom source,
      each with URL and Type (custom URL's type auto-detected).

## Phase 3 — API endpoints (terminal, with the `dvq_` key)

- [ ] **3.1** Central KB:
      `curl -s "$APP_URL/api/kb?sources=notion,stripe" -H "Authorization: Bearer dvq_..."`
      → JSON with `entries`, `served`, `available`. `stripe` in `served` only if the
      master KB carries it (0.5). First call slow, repeat fast (cache). 503 → see 0.4.
- [ ] **3.2** Proxy: `curl -s "$APP_URL/api/notion/v1/users/me" -H "Authorization: Bearer dvq_..."`
      → bot user JSON for the test workspace.
- [ ] **3.3** Bad key rejected: repeat 3.2 with `Bearer dvq_wrong` → 401 JSON.

## Phase 4 — Worker deploy

- [ ] **4.1** In an empty directory, run the success page's npx command verbatim.
      Steps stream: clone (branch `oauth-installer`) → npm install → `ntn login`
      (**log into the test workspace**) → check → deploy → env set ×2 → sync trigger.
      If deploy complains about a workspace mismatch: delete `devquest/workers.json`,
      re-run.
- [ ] **4.2** `cd devquest && ntn workers sync status` until complete.
- [ ] **4.3** Test workspace now has a **DevQuest Docs Knowledge Base** with Notion docs
      plus entries from your selected sources (central-served AND custom/direct — Bun
      entries prove the direct-fetch path).
- [ ] **4.4** Vercel logs show `GET /api/kb` hits around sync time (proves the central
      feed was used, not the llms.txt fallback).

## Phase 5 — Custom Agent

- [ ] **5.1** Create the agent per `SETUP.md` step 3 — paste the **current**
      `src/system-prompt.md` (it changed: curation + free-form languages). Attach tools,
      auto-approve writes.
- [ ] **5.2** New developer conversation: "Hey, I'm building an internal dashboard —
      I've built REST APIs for years but never used Notion." Expect: `find_persona` +
      `read_company_context` calls; team question (config has teams); one question at a
      time; docs only from tool results.
- [ ] **5.3** Once all four persona fields land: agent calls `query_docs` (wide) then
      `create_guide_page` **with a `reading_path`** — check the tool result for
      `curated: true`. Guide page: persona callout, checkable reading path, starter
      code, milestones, session log.
- [ ] **5.4** Language fallback: in a fresh conversation say your language is **Go** →
      persona stores `go`; `get_starter_code` returns the HTTP flow + `agent_note`, and
      the agent presents an idiomatic **Go** snippet in chat (page title
      "My first Notion API page" preserved).
- [ ] **5.5** Milestone loop: run the starter snippet (any language), paste the created
      page URL → `verify_first_call` verifies and stamps First Success.
- [ ] **5.6** Return visit: new conversation, same name → agent recognizes you
      (`found: true`), reports guide progress; if docs were checked off, offers what's
      new / refresh.

## Phase 6 — Live stack sync (webhook)

- [ ] **6.1** Edit the test workspace's **DevQuest Company Config** page: add a line
      "We also use Twilio."
- [ ] **6.2** Within ~1–2 min: Vercel logs show the webhook event and
      `Stack sync (…): added doc sources Twilio`; a Twilio row appears in the Doc
      Sources DB. (KB entries follow on the next worker sync — or trigger one.)
- [ ] **6.3** Edit a non-config page → logs show the event resolving to
      `ignored_not_config` (no rows added).

## Phase 7 — Resilience

- [ ] **7.1** Re-auth: run the install again in the same test workspace. The **original**
      `dvq_` key still works (repeat 3.2) — tokens rotated under the same key.
      Known side effect: a duplicate set of DevQuest pages (page creation is not
      idempotent).
- [ ] **7.2** Skip path: install into a second workspace (or accept duplicates) using
      **Skip** → default template pages (Platform/Frontend/Data Engineering), empty
      Doc Sources DB, placeholder Tools & Services line.
- [ ] **7.3** Expired session: visit `$APP_URL/install` in a fresh/private browser →
      "This page has expired" with a link home. Visit `/setup` cold → redirected home
      with a friendly error.
- [ ] **7.4** OAuth cancel: start Connect → cancel on Notion's screen → landing page
      shows "You cancelled the Notion authorization." (no crash).

## Troubleshooting quick map

| Symptom | Likely cause | Where to look |
|---|---|---|
| "saving the connection failed" after OAuth | Redis unreachable / env missing | callback logs: `Failed to store authorization` |
| `/api/kb` 503 | `NOTION_MASTER_TOKEN` missing or not shared with the KB | kb logs: `Central KB read failed` |
| KB has docs but none from selected tools | Master KB lacks those sources (0.5) and direct fetch failed | sync logs + `/api/kb` `available` list |
| Worker 401s on every call | Wrong/revoked install key, or Redis lost the record | proxy logs |
| npx: "could not determine executable" | Command missing `#oauth-installer` (pre-merge) | use the success page's exact command |
| Webhook silent | Verification token never pasted back (0.6) | `/api/webhooks/notion` logs |
| Old UI appears after a push | Redeployed an old deployment | Deployments tab: check commit hash |

## After the run

- Delete duplicate DevQuest page sets in the test workspace.
- If all green: merge `oauth-installer` → `main`, drop the two branch pins
  (`scripts/devquest-setup.mjs` and `installer/app/install/page.tsx` — marked TODO),
  then retire the `npx-installer` branch.
