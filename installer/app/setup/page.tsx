import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import SetupForm from "./SetupForm";

interface PendingPayload {
  installKey: string;
  workspace: string;
}

export default async function SetupPage() {
  const jar = await cookies();
  const raw = jar.get("devquest_pending")?.value;
  let pending: PendingPayload | null = null;
  try {
    pending = raw
      ? (JSON.parse(Buffer.from(raw, "base64url").toString()) as PendingPayload)
      : null;
  } catch {
    pending = null;
  }
  if (!pending) redirect("/?error=setup_session_expired");

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
      <div style={{ maxWidth: 560, width: "100%" }}>
        <div style={{ marginBottom: "1.5rem" }}>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: "0 0 0.375rem" }}>
            Tell us about your team
          </h1>
          <p style={{ color: "#555", margin: 0 }}>
            Connected to <strong>{pending.workspace}</strong>. A few quick
            questions to tailor your workspace — or skip and edit the
            template pages later.
          </p>
        </div>
        <SetupForm />
      </div>
    </main>
  );
}
