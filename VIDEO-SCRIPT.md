# DevQuest — Demo Video Script (v2: the onboarding story)

Target: **4:45–5:15**. Three acts: **I onboarded myself → then a team → then
discovered the goldmine.** Under-the-hood cuts are woven in to showcase the
engineering — the video's real job is getting Dennis hired.

Spoken lines in quotes; screen directions in brackets. Optional beats marked
CUT-IF-LONG.

---

## Staging checklist (before recording)

- [ ] Personas DB: only YOUR real persona archived/reset — Act 1's cold start
      must be genuinely cold
- [ ] KB freshly synced; Insights DB has a populated week row from a staging
      pass (that row is Act 3's money shot — clear personas/guides after
      staging, keep the insights row)
- [ ] Company config + team pages (Frontend/Platform/Data Engineering) ready —
      clean versions, not the torture test
- [ ] Second persona (advanced TS, public integration) pre-built with its
      guide page open in a tab for the contrast moment
- [ ] Terminal pre-staged: `NOTION_API_TOKEN` + `PARENT_PAGE_ID` exported,
      starter script saved; editor open on `src/index.ts` and
      `src/system-prompt.md` tabs for the under-the-hood cuts
- [ ] Agent: latest prompt, all tools attached, write tools auto-approved
- [ ] Pre-record a full happy-path take as fallback footage

---

## ACT 1 — I had to onboard myself

### 0:00–0:35 — Hook: the honest origin

[Cold open: developers.notion.com getting-started. Slow scroll. Then cut to
your face or voiceover.]

> "A few weeks ago I started preparing for this role — which meant learning
> Notion's brand-new developer platform. First stop: the docs. And the docs
> are *good* — but there are a hundred and sixty pages of them, and on day
> one I had no idea which forty mattered for me. The docs don't know who I
> am. So instead of reading them top to bottom... I built the thing I
> wished existed. And I built it ON the platform I was trying to learn."

### 0:35–1:15 — DevQuest onboards its own author

[Notion. Fresh DevQuest conversation, Personas DB visible in side panel.]

Type: **"hey, I'm brand new to the Notion API — I want to build an
automation in Python"**

> "This is DevQuest. Watch the database on the right — one message, and it
> already knows what I'm building and my language. It asks only what it
> can't infer."

[Answer its question. Persona completes. Guide page created — click in.]

> "Four fields — goal, language, experience, API comfort. If a field doesn't
> change the output, it doesn't exist. And the second the profile completes,
> I get a living guide: a reading path matched to my level, a first project,
> and runnable starter code in my language. This exact page is how I
> actually learned this platform."

### 1:15–1:50 — Under the hood #1: it's one Worker

[Cut to editor: src/index.ts header. Then terminal.]

> "Under the hood, this is one Notion Worker. A daily **sync** pulls Notion's
> entire docs index into a managed database — parsed, categorized, tagged by
> difficulty. Thirteen deterministic **tools** store persona fields, rank
> docs, and write guide pages. Deploying all of it is one command."

[`ntn workers deploy` — show it complete in seconds.]

[Flash src/system-prompt.md.]

> "And here's the part I love: there is no decision tree in the code. The
> entire branching logic is thirteen rules of plain English in the agent's
> system prompt. Tools for state, AI for reasoning."

### 1:50–2:25 — First success (Act 1 climax)

[Terminal, pre-staged. Run the starter snippet from the guide.]

> "The guide's snippet creates a real page through the API. I run it, paste
> the URL back... and DevQuest *verifies* my first successful call, stamps
> the milestone, and tells me my time-to-first-success. My onboarding didn't
> end with a reading list — it ended with a working API call. That metric
> matters; hold that thought."

## ACT 2 — Then I stopped thinking about me

### 2:25–3:10 — A team in different buckets

[Company Config page, then the team pages: Frontend / Platform / Data Eng.]

> "Onboarding one developer is nice. Companies onboard *teams* — and a
> frontend dev, a platform engineer, and a data engineer need completely
> different paths. So DevQuest reads company context: your stack, your
> focus areas, and per-team pages. A new hire says 'I just joined the
> platform team' and gets that team's stack, their process, their
> priorities."

[The contrast: your beginner-Python guide and the pre-staged advanced-TS
public-integration guide side by side.]

> "Same thirteen tools, same thirteen rules — zero overlapping docs between
> these two guides. There is no tree with two branches. There is no tree."

### 3:10–3:30 — CUT-IF-LONG: under the hood #2: any docs, not just Notion's

[Flash the Doc Sources database / KNOWN_DOC_SOURCES map in code.]

> "And the knowledge base is pluggable — the same sync ingests any llms.txt,
> OpenAPI spec, or sitemap. Mention Stripe in your company config and your
> new hires' guides include Stripe's docs too. Onboarding to your whole
> stack, not just to Notion."

## ACT 3 — The goldmine

### 3:30–4:15 — What DevRel gets for free

[Open DevQuest Insights: the weekly row, then the narrative digest page.]

> "Here's what I'd care about most if I were doing developer relations at
> Notion. Every persona, every checked-off doc, every stall is *signal*.
> This digest builds itself weekly: who's showing up and what they're
> building — that's product guidance. Which docs get recommended but never
> read — that's the docs roadmap. Time-to-first-success per cohort — that's
> THE onboarding metric. Docs sites have always had analytics. Docs
> *comprehension* has never had any. This is that."

### 4:15–4:50 — Close: the circle

[Back to your own guide page. Hold on it.]

> "I built DevQuest to onboard one developer — me, for this application.
> It turned into a system for onboarding teams, and a feedback engine for
> the people who write the docs. One Worker, thirteen tools, thirteen rules
> of English, built in a week on a platform that launched two months ago.
> Along the way I filed fifteen platform findings with proposed fixes —
> because the fastest way to learn where a platform needs advocacy... is to
> build at its edge. That's the job. I'd love to do it."

[End card: DevQuest — repo/contact.]

---

## Timing budget

| Beat | Time | Running |
|---|---|---|
| Hook: origin story | 0:35 | 0:35 |
| Self-onboarding demo | 0:40 | 1:15 |
| Under the hood #1 (Worker/sync/tools/prompt) | 0:35 | 1:50 |
| First success | 0:35 | 2:25 |
| Team buckets + contrast | 0:45 | 3:10 |
| Under the hood #2 (pluggable sources) | 0:20 | 3:30 |
| Insights flywheel | 0:45 | 4:15 |
| Close | 0:35 | 4:50 |

Over 5:15? Cut under-the-hood #2 first, then tighten the hook. Never cut
first-success, the contrast, or the insights beat — they carry the three acts.

## Recording notes

- The hook lands hardest if it's self-deprecating and true — "I built a tool
  instead of reading the docs" is a developer joke that doubles as the thesis.
- Under-the-hood #1 is the hiring beat: real code, real deploy, on camera.
  Don't rush it, don't extend it — 35 seconds of competence, not a tutorial.
- Act transitions carry the argument: say "then I stopped thinking about me"
  and "here's what I'd care about most if I were doing developer relations at
  Notion" exactly — they signpost the three acts.
- Verify the spoken numbers (13 tools, 13 rules, 15 findings, 160 docs)
  against the code before recording — they've moved before.
- If beta latency drags on camera: jump-cut and name it ("beta latency,
  trimmed") — platform awareness, not a flaw.
