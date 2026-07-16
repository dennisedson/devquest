const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You cancelled the Notion authorization. No changes were made.",
  missing_params: "Notion did not return the expected parameters. Please try again.",
  invalid_state: "The sign-in session expired or was invalid. Please try again.",
  token_exchange_failed: "Could not complete authorization with Notion. Please try again.",
  storage_failed: "Connected to Notion, but saving the connection failed. Please try again.",
  setup_failed: "Connected to Notion, but creating the workspace pages failed. Please try again.",
  setup_session_expired: "Your setup session expired. Connect to Notion again to continue.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMessage = error
    ? ERROR_MESSAGES[error] ?? "Something went wrong. Please try again."
    : null;

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
      <div style={{ maxWidth: 480, width: "100%" }}>
        <div style={{ marginBottom: "2rem" }}>
          <h1 style={{ fontSize: "2rem", fontWeight: 700, margin: "0 0 0.5rem" }}>DevQuest</h1>
          <p style={{ fontSize: "1.125rem", color: "#555", margin: 0 }}>
            A personalized Notion onboarding agent for your developer team.
          </p>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e5e5e5", borderRadius: 12, padding: "1.5rem", marginBottom: "1.5rem" }}>
          <p style={{ margin: "0 0 1rem", fontWeight: 600 }}>What gets created in your workspace:</p>
          <ul style={{ margin: 0, padding: "0 0 0 1.25rem", lineHeight: 2, color: "#444" }}>
            <li><strong>DevQuest</strong> parent page</li>
            <li><strong>DevQuest Company Config</strong> — edit with your stack</li>
            <li>Default team pages (Platform Team, Frontend Team, Data Engineering)</li>
            <li><strong>DevQuest Personas</strong> database — tracks each developer</li>
          </ul>
        </div>

        {errorMessage && (
          <div style={{ background: "#fff3f3", border: "1px solid #fca5a5", borderRadius: 8, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#b91c1c", fontSize: "0.875rem" }}>
            {errorMessage}
          </div>
        )}

        <a
          href="/api/auth/authorize"
          style={{
            display: "block",
            textAlign: "center",
            background: "#000",
            color: "#fff",
            padding: "0.875rem 1.5rem",
            borderRadius: 8,
            fontWeight: 600,
            fontSize: "1rem",
            textDecoration: "none",
          }}
        >
          Connect to Notion →
        </a>

        <p style={{ marginTop: "1rem", fontSize: "0.8125rem", color: "#888", textAlign: "center" }}>
          You&apos;ll pick a Notion workspace, then answer a few quick
          (skippable) questions about your team&apos;s stack.
        </p>
      </div>
    </main>
  );
}
