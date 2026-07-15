# DevQuest — Demo Video Script

Target: **4:30–5:00**. Structure: hook → problem → insight → live demo →
first success → contrast → flywheel close. Spoken lines in quotes; screen
directions in brackets. Optional beats marked CUT-IF-LONG.

---

## Staging checklist (before recording)

- [ ] Personas DB: empty (archive test rows) — the cold start must be cold
- [ ] KB freshly synced; Insights DB has at least one populated week row
      (run a staging pass first, then clear ONLY personas/guides — the
      insights row from staging is your closing shot)
- [ ] Company config page ready (simple version, not the torture test — the
      demo needs clean parses, not traps)
- [ ] Two browser/desktop windows arranged: agent chat left, sidebar/database
      panel right — persona updates must be visible live
- [ ] Starter-snippet environment prepped: terminal with `NOTION_API_TOKEN`
      and `PARENT_PAGE_ID` already exported, script file ready to run —
      NOTHING gets typed live except the demo conversation
- [ ] Agent: latest system prompt, all tools attached, write tools
      auto-approved (no permission popups on camera)
- [ ] Pre-record a full happy-path take as fallback footage (beta latency
      insurance — see risk table in the implementation plan)

---

## 0:00–0:25 — Hook

[Cold open on developers.notion.com getting-started page. Slow scroll.]

> "Every developer documentation site has the same problem. You land on
> getting started, and there are forty links staring at you. Which ones
> matter? That depends entirely on who you are — but the docs don't know
> who you are. What if they did?"

## 0:25–0:50 — The problem

[Split screen or quick cuts: the same docs page twice.]

> "A Python beginner building her first automation and a TypeScript veteran
> shipping a marketplace integration need completely different starting
> points. Today, they get the same page. Notion just launched a developer
> platform — Workers, Custom Agents, a CLI. So I built the onboarding those
> docs deserve, on the platform itself."

## 0:50–1:20 — The insight

[Editor: src/index.ts header comment, then flash src/system-prompt.md.]

> "DevQuest is one Notion Worker: thirteen deterministic tools, two syncs,
> and zero decision trees. Every tool does exactly one thing — store a
> persona field, rank docs, write a guide page. The entire branching logic
> is thirteen rules of plain English in the agent's system prompt. The AI
> decides what to ask and when; the code never guesses."

[Beat. Point at the rules.]

> "That distinction — tools for state, AI for reasoning — is the whole
> architecture."

## 1:20–2:40 — Live demo: cold start to guide

[Notion. Fresh DevQuest conversation. Personas DB visible in side panel.]

Type: **"hey! I want to build an internal dashboard for my team in Python"**

> "Watch the database on the right. One message — and it already knows my
> goal and my language. No quiz. It asks about the one thing it can't infer."

Answer its question: **"been coding for years, but I've never used a REST API"**

[Persona row completes. Guide page gets created. Click into it.]

> "Four fields. That's the entire persona — if a field doesn't change the
> output, it doesn't exist. And the moment it's complete, I get this: a
> living guide page. A reading path I can check off, matched to my level.
> A first project. And — my favorite part — starter code in *my* language,
> ready to run."

## 2:40–3:15 — First success (the climax)

[Terminal, pre-staged. Run the snippet from the guide.]

> "This snippet creates a real page through the API. Let's run it."

[`Created: https://notion.so/...` appears. Copy URL, paste into DevQuest chat.]

> "I paste the URL back... and DevQuest verifies the call actually worked,
> stamps the milestone on my persona, and tells me my time-to-first-success.
> Onboarding didn't end with a reading list. It ended with a working API
> call."

## 3:15–3:45 — The contrast

[New conversation, or pre-recorded cut. Second persona: advanced TS dev,
public integration, API-fluent. Show both guide pages side by side.]

> "Now, a different developer — TypeScript veteran, building a public
> integration. Same thirteen tools. Same thirteen rules. Completely
> different guide: OAuth flows, token lifecycle, marketplace listing.
> Zero overlapping docs. That's not a decision tree with two branches —
> there is no tree."

## 3:45–4:10 — CUT-IF-LONG: it knows your company

[Flash the Company Config page, then a greeting that leads with the stack.]

> "Install it at a company, and it reads your stack. A new hire at a Python
> shop gets Python defaults, the team's focus areas, even the team's own
> onboarding notes — and if your company uses Stripe or HubSpot, DevQuest
> pulls their docs into the same knowledge base."

## 4:10–4:45 — The flywheel close

[Open the DevQuest Insights database. The weekly digest row + narrative page.]

> "And here's the part I'd care about most if I ran developer relations:
> every persona, every checked-off doc, every stall becomes data. Which
> docs get recommended but never read? Where do beginners give up? Docs
> sites have analytics. Docs *comprehension* never has — until now."

[Back to the guide page. Hold.]

> "This is documentation that learns who you are, keeps up with what ships,
> and tells its authors what's missing. One Worker. Thirteen tools.
> Thirteen rules. Built on the platform it teaches."

[End card: DevQuest — repo/contact.]

---

## Timing budget

| Beat | Time | Running |
|---|---|---|
| Hook | 0:25 | 0:25 |
| Problem | 0:25 | 0:50 |
| Insight | 0:30 | 1:20 |
| Cold start → guide | 1:20 | 2:40 |
| First success | 0:35 | 3:15 |
| Contrast | 0:30 | 3:45 |
| Company context (optional) | 0:25 | 4:10 |
| Flywheel close | 0:35 | 4:45 |

Over 5:00? Cut the company beat first, then trim the problem section — never
cut first-success or the contrast; they carry the argument.

## Recording notes

- Record persona-DB updates and guide creation in real time once; if beta
  latency drags, jump-cut the waits and say "beta latency, trimmed for time" —
  it shows platform awareness (risk table).
- The contrast beat works best pre-staged: record the TS conversation earlier,
  keep both guide pages open in tabs.
- Speak the numbers ("thirteen tools, thirteen rules") consistently — check
  against the code before recording in case the counts have moved.
