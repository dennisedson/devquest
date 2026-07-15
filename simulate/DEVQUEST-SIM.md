# DevQuest Simulator — run the agent on your own AI (zero Notion credits)

When Notion credits run out, Custom Agents pause — but Workers keep running
and `ntn workers exec` still executes deployed tools for real. This harness
lets any coding agent (Claude Code, Codex, etc.) play the DevQuest role using
its own model, calling the real tools via the CLI. Real personas DB, real
guide pages, real syncs. Only the chat surface is different.

## Setup

```bash
cd <this repo>
ntn workers env pull        # ensures .env has NOTION_API_TOKEN for --local runs
claude                      # or your coding agent of choice
```

Then paste the prompt below (or tell the agent to read this file and begin).

## The simulator prompt

> Read `src/system-prompt.md` — those are your behavioral instructions. You
> are DevQuest, and I am a developer you're onboarding. Run the conversation
> exactly per those rules, with ONE mechanical difference: instead of native
> tool calls, execute the corresponding CLI command via your shell tool and
> use its JSON output as the tool result.
>
> Tool call mapping (replace the JSON with real arguments):
>
> | System-prompt tool | CLI command |
> |---|---|
> | find_persona | `ntn workers exec find_persona -d '{"persona_id":"Dennis Edson"}'` |
> | update_persona | `ntn workers exec update_persona -d '{"persona_id":"Dennis Edson","goal":"automation","language":null,"experience":null,"api_comfort":null}'` |
> | query_docs | `ntn workers exec query_docs -d '{"persona_id":"Dennis Edson","category":null,"max_results":null}'` |
> | get_starter_code | `ntn workers exec get_starter_code -d '{"persona_id":"Dennis Edson"}'` |
> | verify_first_call | `ntn workers exec verify_first_call -d '{"persona_id":"Dennis Edson","page_url":"<url>"}'` |
> | create_guide_page | `ntn workers exec create_guide_page -d '{"persona_id":"Dennis Edson","parent_page":null,"session_note":"..."}'` |
> | read_guide_page | `ntn workers exec read_guide_page -d '{"persona_id":"Dennis Edson"}'` |
> | update_guide_page | `ntn workers exec update_guide_page -d '{...}'` |
> | read_company_context | `ntn workers exec read_company_context -d '{}'` |
> | read_team_context | `ntn workers exec read_team_context -d '{"team":"platform"}'` |
> | add_doc_source | `ntn workers exec add_doc_source -d '{"source_name":"...","source_url":"...","source_type":null}'` |
>
> Notes:
> - Nullable fields must be passed explicitly as null (schema quirk).
> - The IDENTITY rule says you know my name. In this simulator you do: ask me
>   once at the start if it isn't obvious, then use it consistently.
> - After each tool call, tell me (briefly) which tool you called — I'm
>   testing the call sequence, not just the answers.
>
> Begin: greet me per rule 1.

## What this is good for

- Full E2E of every TEST-CHECKLIST section except UI-specific checks
  (auto-approve prompts, the steps dropdown, in-chat rendering)
- Prompt iteration without burning credits: edit `src/system-prompt.md`,
  restart the sim, replay a script
- **Permissions diagnosis:** exec uses your NOTION_API_TOKEN (personal access
  token = sees everything you see). If a tool works here but fails in the
  real agent chat, the agent's connection is missing page access.

## What it can't test

- Whether Notion's production agent model follows the prompt as well as your
  simulator model does (different models drift differently)
- Tool auto-approve UX, steps dropdown, agent-side rendering
- The agent's real knowledge of the current user (IDENTITY premise)

## Also worth knowing (bring-your-own-AI, officially)

- **External Agents API** (beta, waitlist): your own agents as first-class
  workspace participants — the real long-term answer to this problem
- **Agent SDK** (alpha, waitlist): call Notion agents from your own tools
- **Notion MCP** (available now): your Claude/Cursor can read and write the
  workspace via generic tools — but it cannot call worker tools, so it can't
  exercise DevQuest's machinery

INTERVIEW-NOTES angle: "credits ran out mid-testing, so I rebuilt the agent
loop on the CLI in an afternoon" is both a platform-friction data point
(#11 candidate: no sandbox/testing tier for Custom Agents) and a nice
demonstration that the CLI is genuinely agent-ready.
