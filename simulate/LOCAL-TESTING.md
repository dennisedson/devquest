# DevQuest — Local / CLI Testing

Everything needed to test DevQuest from the command line, with zero Notion
credits. Workers keep running when Custom Agents are paused, so `ntn workers
exec` exercises the real deployed tools against the real databases.

---

## One-time setup

```bash
# 1. Authenticated CLI against the workspace under test
ntn login

# 2. Personal access token so exec'd tools can call the Notion API.
#    Create one at notion.so/profile/integrations, then:
ntn workers env set NOTION_API_TOKEN=ntn_...
ntn workers env pull            # writes .env for --local runs

# 3. Deploy current code
npm run check && ntn workers deploy

# 4. Populate the knowledge base (also stamps First Seen for v8)
ntn workers sync trigger docs_index
ntn workers sync status         # wait until the cycle completes
```

Notes:
- A personal access token sees everything YOU see — so CLI results are the
  *permissions ceiling*. If a tool works here but fails in agent chat, the
  agent's connection is missing page access (INTERVIEW-NOTES #5).
- `exec` runs the DEPLOYED code. After editing src/, redeploy first.
  `exec --local` runs your local build instead — faster for iteration.

## The smoke test

```bash
bash simulate/smoke.sh
```

Runs every tool in TEST-CHECKLIST order with a throwaway persona
("CLI Smoke Test"), continuing past failures. What each step should show:

| Step | Tool | Pass looks like |
|---|---|---|
| 0 | whoami | bot user + owner info (record for INTERVIEW-NOTES #2) |
| 1 | read_company_context | found=true, teams[] non-empty if team pages are nested under the config |
| 2 | read_team_context | found=true + Platform Team page content — **the permissions probe** |
| 3 | find_persona | found=false (fresh name) |
| 4 | update_persona | persona created, missing_fields=[] |
| 5 | query_docs | 5 beginner/automation-flavored docs |
| 6 | get_starter_code | pip install + python snippet |
| 7 | create_guide_page | guide_page_url returned |
| 8 | read_guide_page | reading path to-dos + 1 session log entry |
| 9 | find_persona | found=true; whats_new populated if docs entered the KB after step 4 |
| 10 | insights_digest | sync triggers; check the Insights DB row after |

Manual follow-ups (printed by the script):
- Open the guide page URL — Start Coding section renders, code block is python
- Open **DevQuest Insights** — this week's row exists and counts look right
- First-success flow needs a real page you created via the API:
  `ntn workers exec verify_first_call -d '{"persona_id":"CLI Smoke Test","page_url":"<url>"}'`
- Cleanup: archive the "CLI Smoke Test" persona row + its guide page

## Conversation-level testing (the full agent loop)

Raw exec calls test the tools; `DEVQUEST-SIM.md` (this folder) tests the
*conversation*. Open Claude Code in the repo root, tell it to read that file,
and it plays DevQuest — following src/system-prompt.md and executing tools via
the CLI. Use it for prompt iteration and the checklist's conversational
sections; save real agent credits for final rehearsals + recording.

## What CLI testing cannot cover

- Notion's production agent model following the prompt (different model =
  different drift) — needs at least one live credited session
- Tool auto-approve UX, the steps dropdown, in-chat rendering
- The agent's knowledge of the current user (the IDENTITY premise)

## Handy extras

```bash
ntn workers sync status                      # live sync dashboard
ntn workers sync state reset docs_index      # full re-sync (also resets First Seen memory)
ntn workers runs logs <runId>                # debug a failed run
ntn workers capabilities list                # everything deployed
```
