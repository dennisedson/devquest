"use client";

import { useState } from "react";
import { KNOWN_DOC_SOURCES } from "@/lib/doc-sources";

const LANGUAGES = [
  { key: "typescript", label: "TypeScript" },
  { key: "python", label: "Python" },
  { key: "curl", label: "cURL / REST" },
];

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e5e5",
  borderRadius: 12,
  padding: "1.25rem 1.5rem",
  marginBottom: "1rem",
};

const chipLabel = (selected: boolean): React.CSSProperties => ({
  display: "inline-block",
  padding: "0.4rem 0.8rem",
  margin: "0 0.5rem 0.5rem 0",
  borderRadius: 999,
  border: selected ? "1px solid #000" : "1px solid #d4d4d4",
  background: selected ? "#000" : "#fff",
  color: selected ? "#fff" : "#333",
  fontSize: "0.875rem",
  cursor: "pointer",
  userSelect: "none",
});

interface CustomTool {
  name: string;
  url: string;
}

export default function SetupForm() {
  const [tools, setTools] = useState<string[]>([]);
  const [customTools, setCustomTools] = useState<CustomTool[]>([]);
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [otherLanguages, setOtherLanguages] = useState("");
  const [teamsText, setTeamsText] = useState("");
  const [submitting, setSubmitting] = useState<"answers" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (list: string[], set: (v: string[]) => void, key: string) =>
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

  function addCustomTool() {
    const name = customName.trim();
    const url = customUrl.trim();
    if (!name || !url || customTools.length >= 10) return;
    setCustomTools([...customTools, { name, url }]);
    setCustomName("");
    setCustomUrl("");
  }

  async function submit(skipped: boolean) {
    setSubmitting(skipped ? "skip" : "answers");
    setError(null);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          skipped
            ? { skipped: true }
            : {
                skipped: false,
                tools,
                customTools,
                languages: [
                  ...languages,
                  ...otherLanguages
                    .split(",")
                    .map((l) => l.trim())
                    .filter(Boolean),
                ],
                teams: teamsText
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean)
                  .slice(0, 10),
              }
        ),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Setup failed (${res.status})`);
      }
      window.location.href = "/install";
    } catch (err) {
      setSubmitting(null);
      setError(err instanceof Error ? err.message : "Setup failed. Please try again.");
    }
  }

  const busy = submitting !== null;

  return (
    <div>
      <div style={card}>
        <p style={{ margin: "0 0 0.25rem", fontWeight: 600 }}>
          What tools does your team use?
        </p>
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", color: "#888" }}>
          Their developer docs are added to your knowledge base automatically.
        </p>
        {Object.entries(KNOWN_DOC_SOURCES).map(([key, { label }]) => (
          <span
            key={key}
            style={chipLabel(tools.includes(key))}
            onClick={() => !busy && toggle(tools, setTools, key)}
          >
            {label}
          </span>
        ))}
        {customTools.map((t, i) => (
          <span
            key={`custom-${i}`}
            style={chipLabel(true)}
            title="Click to remove"
            onClick={() => !busy && setCustomTools(customTools.filter((_, j) => j !== i))}
          >
            {t.name} ✕
          </span>
        ))}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            disabled={busy}
            placeholder="Something else? Name…"
            style={{ flex: 1, minWidth: 0, padding: "0.5rem 0.65rem", borderRadius: 8, border: "1px solid #d4d4d4", fontSize: "0.875rem" }}
          />
          <input
            type="url"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCustomTool()}
            disabled={busy}
            placeholder="Docs URL (llms.txt, OpenAPI, sitemap…)"
            style={{ flex: 2, minWidth: 0, padding: "0.5rem 0.65rem", borderRadius: 8, border: "1px solid #d4d4d4", fontSize: "0.875rem" }}
          />
          <button
            onClick={addCustomTool}
            disabled={busy || !customName.trim() || !customUrl.trim()}
            style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "1px solid #000", background: "#fff", fontSize: "0.875rem", cursor: "pointer" }}
          >
            Add
          </button>
        </div>
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.75rem", color: "#aaa" }}>
          Custom docs stay private to your workspace.
        </p>
      </div>

      <div style={card}>
        <p style={{ margin: "0 0 0.25rem", fontWeight: 600 }}>
          What departments or teams do you have?
        </p>
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", color: "#888" }}>
          Each gets its own context page the agent reads when onboarding
          someone on that team. Comma-separated.
        </p>
        <input
          type="text"
          value={teamsText}
          onChange={(e) => setTeamsText(e.target.value)}
          disabled={busy}
          placeholder="Platform, Frontend, Data Engineering"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "0.6rem 0.75rem",
            borderRadius: 8,
            border: "1px solid #d4d4d4",
            fontSize: "0.9375rem",
          }}
        />
      </div>

      <div style={card}>
        <p style={{ margin: "0 0 0.75rem", fontWeight: 600 }}>
          What languages do your developers use?
        </p>
        {LANGUAGES.map(({ key, label }) => (
          <span
            key={key}
            style={chipLabel(languages.includes(label))}
            onClick={() => !busy && toggle(languages, setLanguages, label)}
          >
            {label}
          </span>
        ))}
        <input
          type="text"
          value={otherLanguages}
          onChange={(e) => setOtherLanguages(e.target.value)}
          disabled={busy}
          placeholder="Others, comma-separated — Go, Rust, Java…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            marginTop: "0.5rem",
            padding: "0.5rem 0.65rem",
            borderRadius: 8,
            border: "1px solid #d4d4d4",
            fontSize: "0.875rem",
          }}
        />
      </div>

      {error && (
        <div style={{ background: "#fff3f3", border: "1px solid #fca5a5", borderRadius: 8, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#b91c1c", fontSize: "0.875rem" }}>
          {error}
        </div>
      )}

      <button
        onClick={() => submit(false)}
        disabled={busy}
        style={{
          display: "block",
          width: "100%",
          textAlign: "center",
          background: "#000",
          color: "#fff",
          padding: "0.875rem 1.5rem",
          borderRadius: 8,
          fontWeight: 600,
          fontSize: "1rem",
          border: "none",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {submitting === "answers" ? "Setting up your workspace…" : "Set up my workspace →"}
      </button>
      <button
        onClick={() => submit(true)}
        disabled={busy}
        style={{
          display: "block",
          width: "100%",
          textAlign: "center",
          background: "none",
          color: "#888",
          padding: "0.75rem",
          border: "none",
          fontSize: "0.875rem",
          cursor: busy ? "default" : "pointer",
          textDecoration: "underline",
        }}
      >
        {submitting === "skip" ? "Creating template pages…" : "Skip — use editable templates"}
      </button>
    </div>
  );
}
