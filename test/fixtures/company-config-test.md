# Company Config Torture Test

A deliberately complicated "DevQuest Company Config" for end-to-end testing.
It exercises every parser path and plants traps that test both the code and
the agent's judgment. Fictional company: **Herringbone & Vale**, a
fashion-e-commerce platform (~200 engineers).

## Setup

1. Create a Notion page titled exactly: `DevQuest Company Config`
2. Paste the content between the markers below into the page body
3. Manual conversions after pasting (Notion markdown paste won't create these):
   - Turn the line starting with `⚠️ SECURITY` into a **callout** block
   - Turn the line starting with `Also evaluate Cloudflare` into a **quote** block
4. Share the page with the DevQuest integration (permissions gotcha —
   INTERVIEW-NOTES #5)

---

## ⬇️ PASTE EVERYTHING BETWEEN THE MARKERS ⬇️

<!-- ===== BEGIN PAGE CONTENT ===== -->

# Herringbone & Vale — Engineering Context

**Languages:** Python, TypeScript , GO,  Rust

**Frameworks:** FastAPI; React; Next.js on Vercel

Focus areas: webhooks, automation, data-sync, internal tooling

**Onboarding notes:** New hires spend week 1 embedded with the Platform guild. All integration code review goes through #integration-guild in Slack. Point developers at the internal API Cookbook before any external docs.

## How we use Notion

Notion is our system of record: order-ops runbooks, seller onboarding trackers, and incident retros all live here. The Notion API powers our order-operations dashboards, which sync from the commerce stack every 15 minutes.

Language preferences vary by team, but Platform owns the golden-path templates.

## Commerce stack

- Payments run on Stripe, including Stripe Connect for marketplace seller payouts
- Twilio sends shipping notifications and delivery-window SMS
- HubSpot is the CRM for wholesale accounts — sales ops wants order data synced into it
- The mobile app backend is Supabase (Postgres + realtime)
- Our support chatbot is built on Anthropic's Claude
- We migrated OFF Firebase in 2025 — do not build anything new against it
- Our CMS is Contentful; their developer docs live at https://www.contentful.com/developers/docs/ — include them when onboarding content-platform engineers

Integration priorities this quarter:

1. Order-sync automation (commerce stack → Notion order-ops databases)
2. Returns processing via webhooks (carrier events → returns tracker)
3. Seller-onboarding internal tool (checklist generation + status rollups)

## Heritage

Herringbone & Vale began as a Savile Row tailoring house. When we retooled our warehouse operations in 2023, the pinstripe-and-flannel catalog moved fully online, and engineering became the core of the business.

## Offices

Languages: French, Italian (design teams in Paris and Milan), English everywhere else.

⚠️ SECURITY — Integration tokens rotate every 90 days. Never store tokens in Notion pages. All API experiments happen in the "API Playground" teamspace, never in production teamspaces.

Also evaluate Cloudflare Workers for edge rendering next quarter.

<!-- ===== END PAGE CONTENT ===== -->

---

## Expected parse results (`read_company_context`)

| Field | Expected | Why it's a test |
|---|---|---|
| `found` | `true` | exact-title match via search |
| `languages` | `["python", "typescript", "go", "rust"]` | messy casing/whitespace normalized; **first-wins** — the "Offices" line (`Languages: French, Italian…`) must NOT overwrite this |
| `frameworks` | `["fastapi", "react", "next.js on vercel"]` | semicolon separators |
| `focus_areas` | `["webhooks", "automation", "data-sync", "internal tooling"]` | unbolded key, "Focus areas" spacing variant |
| `onboarding_notes` | the #integration-guild sentence | plain-key parse |
| `raw_content` | everything EXCEPT the callout/quote… see traps | only paragraph/bullet/numbered/heading/callout blocks are read |

### `detected_services` — expected, with traps

| Service | Detected? | Trap |
|---|---|---|
| stripe | ✅ | legitimate |
| twilio | ✅ | legitimate |
| hubspot | ✅ | legitimate |
| supabase | ✅ | legitimate |
| vercel | ✅ | via "Next.js on Vercel" |
| anthropic | ✅ | legitimate |
| **firebase** | ✅ detected | ⚠️ company migrated OFF it — does the agent blindly `add_doc_source` per rule 10, or read the sentence? (Judgment test; naive substring detection has no sentiment) |
| **retool** | ✅ detected | ⚠️ false positive — "retooled our warehouse". Substring detection limitation; candidate for INTERVIEW-NOTES |
| **cloudflare** | ❌ NOT detected (if quote block) | quote blocks aren't parsed — mention is invisible to the tool. Parser blind-spot exhibit |
| contentful | ❌ (not in KNOWN_DOC_SOURCES) | but the URL is in raw_content — does the agent call `add_doc_source` with it manually? |

### Agent behavior checklist (run a conversation after setup)

- [ ] Opens by acknowledging the H&V stack (Python/TypeScript, webhooks/automation focus)
- [ ] Pre-fills persona language from company context but asks/confirms rather than assuming between python and typescript; handles go/rust gracefully (not in the persona enum)
- [ ] Registers stripe/twilio/hubspot/supabase/vercel/anthropic doc sources without asking
- [ ] Firebase: ideally skips it (or asks) given the migration sentence — watch what it does
- [ ] Retool: watch whether it registers a service the company never mentioned
- [ ] Contentful: picks the URL out of raw_content and registers it for content-platform engineers
- [ ] Respects constraints in conversation: suggests the "API Playground" teamspace for experiments, never suggests storing tokens in pages, mentions #integration-guild for review
- [ ] Guide page reflects company focus: webhooks/automation docs ranked up, order-sync suggested project flavor
