import { cookies } from "next/headers";

interface SetupPayload {
  workspace: string;
  installKey: string;
  parentUrl: string;
  configUrl: string;
  personasDbUrl: string;
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

  const { workspace, installKey, parentUrl, configUrl, personasDbUrl, teamUrls } = data;
  const appUrl = process.env.APP_URL ?? "";

  const deployCommands = `# 1. Clone and deploy the worker
git clone https://github.com/dennisedson/devquest && cd devquest
ntn login
npm install && npm run check && ntn workers deploy

# 2. Point the worker at DevQuest (your install key, shown below only once)
ntn workers env set NOTION_API_TOKEN=${installKey}
ntn workers env set NOTION_API_BASE_URL=${appUrl}/api/notion

# 3. Trigger the knowledge base sync
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
          </ul>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e5e5e5", borderRadius: 12, padding: "1.5rem", marginBottom: "1.5rem" }}>
          <p style={{ margin: "0 0 0.875rem", fontWeight: 600 }}>Two remaining steps:</p>

          <p style={{ margin: "0 0 0.5rem", fontWeight: 500 }}>1. Deploy the worker (terminal)</p>
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.8125rem", color: "#b45309" }}>
            The <code>NOTION_API_TOKEN</code> below is your DevQuest install
            key — it routes the worker through DevQuest, which keeps your
            Notion tokens fresh automatically. It is shown only on this page,
            so run (or save) these commands now. Treat it like a password.
          </p>
          <pre style={{
            background: "#f4f4f4",
            borderRadius: 6,
            padding: "0.875rem",
            fontSize: "0.8rem",
            overflowX: "auto",
            margin: "0 0 1.25rem",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}>
            {deployCommands}
          </pre>

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
