# DevQuest — End-to-End Test Checklist

Work through these from the Custom Agent chat. Each section builds on the
previous one.

---

## 0. Pre-flight

- [ ] Deploy: `npm run check && ntn workers deploy`
- [ ] In the Custom Agent settings, attach ALL tools: `find_persona`,
      `update_persona`, `query_docs`, `create_guide_page`, `read_guide_page`,
      `update_guide_page`, `read_company_context`, `add_doc_source`,
      `get_starter_code`, `verify_first_call` (skip `setup_devquest`/`whoami` —
      admin/diagnostic)
- [ ] Set the write tools (`update_persona`, `create_guide_page`,
      `update_guide_page`, `add_doc_source`, `verify_first_call`) to
      auto-approve
- [ ] Paste the latest `src/system-prompt.md` into the agent (it changed:
      guide-link-first, one-question cadence, verification flow)
- [ ] Trigger `ntn workers sync trigger docs_index` once — stamps "First Seen"
      dates the v8 test needs
- [ ] Optional: `ntn workers exec whoami -d '{}'` from CLI AND ask the agent to
      run whoami in chat — compare owners (INTERVIEW-NOTES #2 evidence)

---

## 1. v1 — New developer, full loop

Open the DevQuest agent. Start a fresh conversation.

- [ ] Say: **"hey, I want to build an internal dashboard in Python"**
- [ ] Verify the agent calls `find_persona` first (should return found=false)
- [ ] Verify it infers goal=internal-tool, language=python from your message
      (check the Personas database — fields should appear immediately)
- [ ] Verify it asks about experience or api_comfort (only one question)
- [ ] Answer: **"I've been coding for a few years but never touched a REST API"**
- [ ] Verify it sets experience=intermediate, api_comfort=none
- [ ] Verify it starts weaving in doc links after 2+ fields
- [ ] **Prompt cadence check:** until all 4 fields are set, every agent reply
      ends with exactly one question, and doc dumps stay short (2–3 links max)
- [ ] Verify it calls `create_guide_page` once all 4 fields are set —
      WITHOUT being asked
- [ ] **Ordering check:** the reply presenting the guide has the guide page
      link as its FIRST line, then a 2–3 line summary — no full reading path
      or code dump in chat
- [ ] Open the guide page — confirm it has:
  - 🧑‍💻 persona callout with your fields
  - 📚 Reading Path with checkable to-dos (grouped by category)
  - 🚀 Your First Project section
  - ⚡ Start Coding section — install command + code block in YOUR language
    (python here), key endpoints for YOUR goal, code renders correctly (v7)
  - 📝 Session Log with initial entry

---

## 2. v2 — Returning developer + guide page lifecycle

Check off 3-4 to-do items on the guide page manually. Then start a **new
conversation** with the same agent.

- [ ] Verify the agent calls `find_persona` → found=true, greets you by context
- [ ] Verify it calls `read_guide_page` and mentions your progress
      (e.g., "You've checked off 3 of 15 docs")
- [ ] Say: **"Actually I've gotten a lot better at APIs now, I'd say I'm fluent"**
- [ ] Verify it calls `update_persona` to change api_comfort to fluent
- [ ] Verify it calls `update_guide_page` with refresh_reading_path=true
- [ ] Open the guide page — the reading path should have fresh recommendations
      (beginner API docs gone, more advanced content)
- [ ] Verify a new Session Log toggle entry was appended

---

## 3. v1 — Persona contrast test (the demo moment)

Delete or archive the existing persona in the database. Start a **new
conversation**.

- [ ] Say: **"I'm an advanced TypeScript dev building a public integration,
      I've used tons of REST APIs"**
- [ ] Verify the guide page this time has almost no overlap with test 1
      (Auth, Reference, OAuth docs instead of beginner Getting Started)
- [ ] Compare the two guide pages side by side — they should share ≤2 docs

---

## 4. v3 — Company context

Create a Notion page titled exactly **"DevQuest Company Config"** with this
content:

```
**Languages:** Python, TypeScript
**Frameworks:** FastAPI, React
**Focus Areas:** webhooks, automation
**Onboarding Notes:** New developers should focus on connecting our internal
services to Notion via webhooks. We use Python for backend and TypeScript for
frontend dashboards.
```

Delete/archive existing personas. Start a **new conversation**.

- [ ] Verify the agent calls `read_company_context` (check the tool calls
      in the "steps" dropdown)
- [ ] Verify it mentions your company stack early ("I see your team uses
      Python and FastAPI...")
- [ ] Verify it suggests Python as your language rather than asking
- [ ] Say: **"I'm new here, just started this week"**
- [ ] Verify the guide page skews toward Webhooks, automation, and Python
      docs (matching company focus areas)

---

## 5. v4 — Pluggable doc sources

In the agent chat:

- [ ] Say: **"We also use HubSpot — can you add their developer docs?"**
- [ ] Verify the agent calls `add_doc_source` with source_name="HubSpot"
      and the HubSpot llms.txt URL
      (note: HubSpot may or may not have an llms.txt — if not, use any
      site that does, e.g., `https://docs.stripe.com/llms.txt`)
- [ ] Verify a "DevQuest Doc Sources" database appears in your workspace
      with the new entry
- [ ] Trigger a sync: `ntn workers sync trigger docs_index`
- [ ] After sync completes, check the KB database — new entries should
      appear with Source="HubSpot" (or whichever source you added)
- [ ] Start a new conversation and verify the guide includes docs from
      both sources

---

## 6. v6 — First-success verification

Continue any conversation where the guide exists (or ask for starter code).

- [ ] Actually run the starter snippet from the guide page (needs a real
      integration token + a shared parent page — 5 min setup at
      notion.so/profile/integrations)
- [ ] Paste the `Created:` URL into the chat
- [ ] Verify the agent calls `verify_first_call` and celebrates
- [ ] Check the persona record — "First Success" date is set
- [ ] Verify it mentions time-to-first-success (hours since persona creation)
- [ ] Paste the same URL again — `already_verified=true`, agent doesn't
      double-log the milestone
- [ ] Negative test: paste a URL of a page the integration can NOT access —
      tool should error, agent should explain gracefully (likely needs the
      page shared with the agent's connection)

---

## 7. v8 — Change awareness (what's new)

Needs: an existing persona + at least one doc that entered the KB *after*
that persona's last edit.

- [ ] Add a new doc source (e.g. Stripe) via chat, then
      `ntn workers sync trigger docs_index`
- [ ] Wait for the sync to finish (`ntn workers sync status`)
- [ ] Start a new conversation as the same developer
- [ ] Verify `find_persona` returns `whats_new` entries (check the steps
      dropdown) and the greeting mentions relevant new docs
- [ ] Sanity: a brand-new developer (no persona) gets NO what's-new noise

---

## 8. v5 — Insights digest

Best run LAST — the digest aggregates everything the earlier tests created.

- [ ] `ntn workers sync trigger insights_digest`
- [ ] A "DevQuest Insights" database appears with one row for this ISO week
- [ ] Row properties: persona totals/distributions match your Personas DB,
      guides count matches reality, docs checked/unchecked match the guide
      pages' to-dos
- [ ] Open the row's page — the markdown digest renders (headline numbers,
      "Who is showing up", "Reading progress", "Content gaps")
- [ ] Content gaps list the docs you deliberately left unchecked in test 2
- [ ] Re-trigger the sync — same week's row UPDATES (no duplicate row)

---

## 9. v3+ — Company config torture test (optional, pre-demo)

Replace the simple config from test 4 with the full
`test/fixtures/company-config-test.md` fixture and rerun a fresh conversation.
Follow the expected-results table and agent checklist in that file — record
what the agent does with the firebase and retool traps in INTERVIEW-NOTES.

---

## 9b. Team context (the "I moved teams" flow)

Your team pages (Platform Team, Frontend Team, Data Engineering) can stay
where they are — read_team_context finds them by title anywhere in the
workspace. Optionally add structured keys to a team page (same format as the
company config: `**Languages:** …`, `Focus areas: …`) plus freeform process
notes.

- [ ] Attach `read_team_context` to the agent (new tool — redeploy first)
- [ ] As a developer with an existing persona + guide, say:
      **"I just moved over to the platform team, could you get me up to
      speed on their process?"**
- [ ] Verify the agent calls `read_team_context` (steps dropdown) and the
      answer summarizes what the Platform Team page ACTUALLY says — not
      generic search results
- [ ] Verify it references your guide progress ("you've already covered X,
      the platform team also expects Y")
- [ ] If the team page declares a different stack, verify it asks before
      changing your persona (e.g. python → typescript)
- [ ] Verify the guide's session log records the team move
- [ ] Negative test: ask about a team with no page ("the growth team") —
      agent should say it can't find the page and ask for a link, not
      improvise from workspace noise

---

## 10. Edge cases

- [ ] **Empty persona:** say only "hi" — agent should start naturally,
      not crash or present an empty guide
- [ ] **Partial persona:** fill 2 fields, then close the chat. Reopen —
      agent should pick up where you left off via find_persona
- [ ] **Guide page permissions:** if the agent can't create a page, it
      should fall back to query_docs and present the reading path in chat (rule 8)
- [ ] **No company config:** delete the config page, start fresh — agent
      should proceed with generic onboarding, no errors

---

## Notes

- The "steps" dropdown in the agent chat shows which tools were called and
  their responses — use this to verify tool call order
- The Personas database and Guide Pages are the source of truth — always
  cross-check what the agent says against the actual Notion pages
- If a tool fails, the error message should tell you what went wrong (e.g.,
  "No persona found", "Guide page already exists")
