import { notionFetch, paragraph, richText } from "./notion";

export interface SetupResult {
  parentUrl: string;
  parentId: string;
  configUrl: string;
  teamUrls: { name: string; url: string }[];
  personasDbUrl: string;
}

const GOALS = ["internal-tool", "public-integration", "automation", "ai-agent", "exploring"];
const LANGUAGES = ["typescript", "python", "curl"];
const EXPERIENCES = ["beginner", "intermediate", "advanced"];
const API_COMFORTS = ["none", "some", "fluent"];

const DEFAULT_TEAMS = ["Platform Team", "Frontend Team", "Data Engineering"];

export async function runSetup(
  token: string,
  workspaceName: string
): Promise<SetupResult> {
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
        paragraph("**Languages:** TypeScript, Python"),
        paragraph("**Frameworks:** React, FastAPI"),
        paragraph("**Focus Areas:** automation, internal tooling, webhooks"),
        paragraph(
          "**Onboarding Notes:** Edit this page to reflect your actual stack. " +
            "The DevQuest agent reads it to personalize recommendations for every developer."
        ),
      ],
    }
  );

  // 3. Default team pages
  const teamUrls: { name: string; url: string }[] = [];
  for (const teamName of DEFAULT_TEAMS) {
    const team = await notionFetch<{ url: string }>(token, "POST", "/pages", {
      parent: { page_id: parent.id },
      properties: { title: { title: richText(teamName) } },
      children: [
        paragraph("**Languages:** TypeScript"),
        paragraph("**Frameworks:** React"),
        paragraph("**Focus Areas:** internal tooling"),
        paragraph(
          `**Onboarding Notes:** Replace this with ${teamName}-specific context. ` +
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

  return {
    parentId: parent.id,
    parentUrl: parent.url,
    configUrl: config.url,
    teamUrls,
    personasDbUrl: personasDb.url,
  };
}
