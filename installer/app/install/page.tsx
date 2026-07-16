import { cookies } from "next/headers";

interface SetupPayload {
  workspace: string;
  installKey: string;
  parentUrl: string;
  configUrl: string;
  personasDbUrl: string;
  docSourcesUrl?: string;
  teamUrls: { name: string; url: string }[];
}

function readPayload(raw: string | undefined): SetupPayload | null {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString()) as SetupPayload;
  } catch {
    return null;
  }
}

export default async function InstallPage() {
  const jar = await cookies();
  const data = readPayload(jar.get("devquest_setup")?.value);

  if (!data) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p>
          This page has expired — the setup details (including your install
          key) are only shown once. <a href="/">Run the install again</a>
        </p>
      </main>
    );
  }

  const { workspace, installKey, parentUrl, configUrl, personasDbUrl, docSourcesUrl, teamUrls } = data;
  const appUrl = process.env.APP_URL ?? "";

  const setupCommand = `npx --yes github:dennisedson/devquest#oauth-installer ${installKey} ${appUrl}`;

  const manualCommands = `# What the command above runs, step by step:
git clone -b oauth-installer https://github.com/dennisedson/devquest && cd devquest
npm install
ntn login   # pick the SAME workspace you just installed into
npm run check && ntn workers deploy
ntn workers env set NOTION_API_TOKEN=${installKey}
ntn workers env set NOTION_API_BASE_URL=${appUrl}/api/notion
ntn workers sync trigger docs_index`;

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
      <div style={{ maxWidth: 560, width: "100%" }}>
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>✓</div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: "0 0 0.375rem" }}>
            DevQuest is set up
          </h1>
          <p style={{ color: "#555", margin: 0 }}>
            Workspace: <strong>{workspace}</strong>
          </p>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e5e5e5", borderRadius: 12, padding: "1.5rem", marginBottom: "1.5rem" }}>
          <p style={{ margin: "0 0 0.875rem", fontWeight: 600 }}>Created in your workspace:</p>
          <ul style={{ margin: 0, padding: "0 0 0 1.25rem", lineHeight: 2 }}>
            <li><a href={parentUrl} target="_blank" rel="noopener">DevQuest</a> — parent page</li>
            <li><a href={configUrl} target="_blank" rel="noopener">DevQuest Company Config</a> — edit with your stack</li>
            <li>
              {teamUrls.map((t, i) => (
                <span key={t.name}>
                  {i > 0 && ", "}
                  <a href={t.url} target="_blank" rel="noopener">{t.name}</a>
                </span>
              ))}{" "}
              pages
            </li>
            <li><a href={personasDbUrl} target="_blank" rel="noopener">DevQuest Personas</a> database</li>
            {docSourcesUrl && (
              <li><a href={docSourcesUrl} target="_blank" rel="noopener">DevQuest Doc Sources</a> — the docs in your knowledge base</li>
            )}
          </ul>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e5e5e5", borderRadius: 12, padding: "1.5rem", marginBottom: "1.5rem" }}>
          <p style={{ margin: "0 0 0.875rem", fontWeight: 600 }}>Two remaining steps:</p>

          <p style={{ margin: "0 0 0.5rem", fontWeight: 500 }}>1. Deploy the worker — one command (terminal)</p>
          <pre style={{
            background: "#f4f4f4",
            borderRadius: 6,
            padding: "0.875rem",
            fontSize: "0.8rem",
            overflowX: "auto",
            margin: "0 0 0.5rem",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}>
            {setupCommand}
          </pre>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", color: "#b45309" }}>
            The command contains your DevQuest install key — it routes the
            worker through DevQuest, which keeps your Notion tokens fresh
            automatically. It is shown only on this page, so run (or save) it
            now, and treat it like a password. Requires the Notion CLI
            (<code>curl -fsSL https://ntn.dev | bash</code>) and a Business+
            plan with Workers enabled.
          </p>
          <details style={{ margin: "0 0 1.25rem" }}>
            <summary style={{ fontSize: "0.8125rem", color: "#555", cursor: "pointer" }}>
              Prefer to run the steps yourself?
            </summary>
            <pre style={{
              background: "#f4f4f4",
              borderRadius: 6,
              padding: "0.875rem",
              fontSize: "0.8rem",
              overflowX: "auto",
              margin: "0.5rem 0 0",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}>
              {manualCommands}
            </pre>
          </details>

          <p style={{ margin: "0 0 0.5rem", fontWeight: 500 }}>2. Create the Custom Agent (Notion UI)</p>
          <ol style={{ margin: 0, padding: "0 0 0 1.25rem", lineHeight: 2, color: "#444" }}>
            <li>Sidebar → <strong>New agent</strong> → name it <strong>DevQuest</strong></li>
            <li>Paste <code>src/system-prompt.md</code> as the system prompt</li>
            <li>Attach all worker tools, set write tools to auto-approve</li>
          </ol>
        </div>

        <p style={{ fontSize: "0.8125rem", color: "#888", textAlign: "center" }}>
          After the sync completes, open the DevQuest agent and say hello.
        </p>
      </div>
    </main>
  );
}
