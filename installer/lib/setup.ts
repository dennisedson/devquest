import { notionFetch, paragraph, labeledParagraph, richText } from "./notion";
import { KNOWN_DOC_SOURCES, SOURCE_TYPES, DOC_SOURCES_DB_TITLE } from "./doc-sources";

export interface SetupResult {
  parentUrl: string;
  parentId: string;
  configUrl: string;
  teamUrls: { name: string; url: string }[];
  personasDbUrl: string;
  docSourcesUrl: string;
}

/** Answers from the install questionnaire. All optional — anything missing
 *  falls back to the editable template defaults. */
export interface SetupAnswers {
  /** Keys of KNOWN_DOC_SOURCES the company uses (e.g. ["stripe", "hubspot"]). */
  tools: string[];
  /** Department/team names (e.g. ["Platform", "Payments"]). */
  teams: string[];
  /** Primary languages (e.g. ["typescript", "python"]). */
  languages: string[];
}

const GOALS = ["internal-tool", "public-integration", "automation", "ai-agent", "exploring"];
const LANGUAGES = ["typescript", "python", "curl"];
const EXPERIENCES = ["beginner", "intermediate", "advanced"];
const API_COMFORTS = ["none", "some", "fluent"];

const DEFAULT_TEAMS = ["Platform Team", "Frontend Team", "Data Engineering"];

export async function runSetup(
  token: string,
  workspaceName: string,
  answers?: SetupAnswers
): Promise<SetupResult> {
  const toolLabels = (answers?.tools ?? [])
    .map((key) => KNOWN_DOC_SOURCES[key]?.label)
    .filter((l): l is string => Boolean(l));
  const teams = answers?.teams?.length ? answers.teams : DEFAULT_TEAMS;
  const languagesLine = answers?.languages?.length
    ? answers.languages.join(", ")
    : "TypeScript, Python";
  const toolsLine = toolLabels.length
    ? toolLabels.join(", ")
    : "(add the services your team uses — e.g. Stripe, HubSpot)";
  // 1. Parent page at workspace root (OAuth tokens can do this; internal integrations cannot)
  const parent = await notionFetch<{ id: string; url: string }>(
    token,
    "POST",
    "/pages",
    {
      parent: { type: "workspace", workspace: true },
      properties: {
        title: { title: richText("DevQuest") },
      },
      children: [
        paragraph(
          `DevQuest workspace for ${workspaceName}. ` +
            "Sub-pages: Company Config (customize your stack), team pages, and databases created by the worker."
        ),
      ],
    }
  );

  // 2. Company Config page
  const config = await notionFetch<{ id: string; url: string }>(
    token,
    "POST",
    "/pages",
    {
      parent: { page_id: parent.id },
      properties: {
        title: { title: richText("DevQuest Company Config") },
      },
      children: [
        labeledParagraph("Languages", languagesLine),
        labeledParagraph("Frameworks", "React, FastAPI"),
        labeledParagraph("Focus Areas", "automation, internal tooling, webhooks"),
        labeledParagraph("Tools & Services", toolsLine),
        labeledParagraph(
          "Onboarding Notes",
          "Edit this page to reflect your actual stack. " +
            "The DevQuest agent reads it to personalize recommendations for every developer."
        ),
      ],
    }
  );

  // 3. Team pages — from questionnaire answers, or editable defaults
  const teamUrls: { name: string; url: string }[] = [];
  for (const teamName of teams) {
    const team = await notionFetch<{ url: string }>(token, "POST", "/pages", {
      parent: { page_id: parent.id },
      properties: { title: { title: richText(teamName) } },
      children: [
        labeledParagraph("Languages", languagesLine),
        labeledParagraph("Frameworks", "React"),
        labeledParagraph("Focus Areas", "internal tooling"),
        labeledParagraph(
          "Onboarding Notes",
          `Replace this with ${teamName}-specific context. ` +
            "The agent reads this page when a developer says they're on this team."
        ),
      ],
    });
    teamUrls.push({ name: teamName, url: team.url });
  }

  // 4. Personas database — mirrors PERSONAS_DB_PROPERTIES from src/persona.ts
  const personasDb = await notionFetch<{ url: string }>(
    token,
    "POST",
    "/databases",
    {
      parent: { page_id: parent.id },
      title: richText("DevQuest Personas"),
      properties: {
        "Persona ID": { type: "title", title: {} },
        Goal: {
          type: "select",
          select: { options: GOALS.map((name) => ({ name })) },
        },
        Language: {
          type: "select",
          select: { options: LANGUAGES.map((name) => ({ name })) },
        },
        Experience: {
          type: "select",
          select: { options: EXPERIENCES.map((name) => ({ name })) },
        },
        "API Comfort": {
          type: "select",
          select: { options: API_COMFORTS.map((name) => ({ name })) },
        },
        "Guide Page ID": { type: "rich_text", rich_text: {} },
        "First Success": { type: "date", date: {} },
        "Created By": { type: "created_by", created_by: {} },
        Created: { type: "created_time", created_time: {} },
        "Last Updated": { type: "last_edited_time", last_edited_time: {} },
      },
    }
  );

  // 5. Doc Sources database — the worker's sync merges these into the KB.
  //    Same title/schema as the worker's add_doc_source tool creates, so the
  //    two paths interoperate.
  const docSourcesDb = await notionFetch<{ id: string; url: string }>(
    token,
    "POST",
    "/databases",
    {
      parent: { page_id: parent.id },
      title: richText(DOC_SOURCES_DB_TITLE),
      properties: {
        "Source Name": { type: "title", title: {} },
        URL: { type: "url", url: {} },
        Type: {
          type: "select",
          select: { options: SOURCE_TYPES.map((name) => ({ name })) },
        },
        Added: { type: "created_time", created_time: {} },
      },
    }
  );

  // Rows for the tools chosen in the questionnaire
  for (const key of answers?.tools ?? []) {
    const source = KNOWN_DOC_SOURCES[key];
    if (!source) continue;
    await notionFetch(token, "POST", "/pages", {
      parent: { database_id: docSourcesDb.id },
      properties: {
        "Source Name": { title: [{ type: "text", text: { content: source.label } }] },
        URL: { url: source.url },
        Type: { select: { name: source.type } },
      },
    });
  }

  return {
    parentId: parent.id,
    parentUrl: parent.url,
    configUrl: config.url,
    teamUrls,
    personasDbUrl: personasDb.url,
    docSourcesUrl: docSourcesDb.url,
  };
}
