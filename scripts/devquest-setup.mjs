#!/usr/bin/env node
/**
 * devquest-setup — one-command worker deploy after the OAuth install.
 *
 * Usage (shown on the installer success page with values filled in):
 *   npx --yes github:dennisedson/devquest <install-key> <installer-url>
 *
 * Wraps: git clone → npm install → ntn login → deploy → env set → first sync.
 * The install key routes the worker's Notion API traffic through the DevQuest
 * installer proxy, which keeps OAuth tokens refreshed automatically.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const REPO_URL = "https://github.com/dennisedson/devquest.git";
// TODO: drop the branch pin (here and on the success page) once
// oauth-installer merges to main.
const REPO_BRANCH = "oauth-installer";
const CLONE_DIR = "devquest";

const [installKey, installerUrl] = process.argv.slice(2);

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function run(label, command, args, opts = {}) {
  console.log(`\n▸ ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit", ...opts });
  if (result.error?.code === "ENOENT") {
    fail(`Command not found: ${command}`);
  }
  if (result.status !== 0) {
    fail(`${label} failed (exit code ${result.status}). Fix the error above and re-run this command.`);
  }
}

function has(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

// --- Validate arguments ------------------------------------------------------

if (!installKey || !installerUrl) {
  fail(
    "Usage: npx --yes github:dennisedson/devquest <install-key> <installer-url>\n" +
      "  Get both from the DevQuest install success page."
  );
}
if (!installKey.startsWith("dvq_")) {
  fail(`The install key should start with "dvq_" — got "${installKey.slice(0, 8)}…". Copy it from the install success page.`);
}
let proxyBase;
try {
  proxyBase = `${new URL(installerUrl).origin}/api/notion`;
} catch {
  fail(`"${installerUrl}" is not a valid URL.`);
}

// --- Preflight ---------------------------------------------------------------

console.log("DevQuest worker setup\n=====================");

if (!has("git")) fail("git is required. Install it, then re-run.");
if (!has("ntn")) {
  fail(
    "The Notion CLI (ntn) is required. Install it with:\n\n" +
      "  curl -fsSL https://ntn.dev | bash\n\n" +
      "then re-run this command.\n" +
      "Note: Workers require a Notion Business or Enterprise plan, enabled in Settings → Workers."
  );
}

// --- Clone (or reuse an existing checkout) -----------------------------------

const targetDir = path.resolve(CLONE_DIR);
if (existsSync(targetDir)) {
  console.log(`\n▸ Using existing ./${CLONE_DIR} directory (delete it for a fresh clone)`);
} else {
  run("Cloning DevQuest", "git", ["clone", "-b", REPO_BRANCH, REPO_URL, CLONE_DIR]);
}
const cwd = { cwd: targetDir };

// --- Install, login, deploy ----------------------------------------------------

run("Installing dependencies", "npm", ["install"], cwd);
console.log("\nNext: log in to Notion. Make sure you pick the SAME workspace you installed DevQuest into.");
run("Notion login", "ntn", ["login"], cwd);
run("Type check", "npm", ["run", "check"], cwd);
run("Deploying worker", "ntn", ["workers", "deploy"], cwd);

// --- Point the worker at the DevQuest proxy ------------------------------------

run("Setting NOTION_API_TOKEN", "ntn", ["workers", "env", "set", `NOTION_API_TOKEN=${installKey}`], cwd);
run("Setting NOTION_API_BASE_URL", "ntn", ["workers", "env", "set", `NOTION_API_BASE_URL=${proxyBase}`], cwd);

// --- First sync ----------------------------------------------------------------

run("Triggering knowledge base sync", "ntn", ["workers", "sync", "trigger", "docs_index"], cwd);

console.log(`
✓ Worker deployed and connected.

One manual step remains — create the Custom Agent in Notion:
  1. Sidebar → New agent → name it DevQuest
  2. Paste src/system-prompt.md (in ./${CLONE_DIR}) as the system prompt
  3. Attach the worker tools and set write tools to auto-approve
     (full table: ./${CLONE_DIR}/SETUP.md, step 3)

Check sync progress with:  cd ${CLONE_DIR} && ntn workers sync status

If the deploy complained about a workspace mismatch, delete ${CLONE_DIR}/workers.json
and re-run this command — it will create a fresh worker in your workspace.
`);
