import { randomBytes } from "crypto";
import { getKv } from "./kv";

export interface InstallRecord {
  installKey: string;
  botId: string;
  workspaceId: string;
  workspaceName: string;
  accessToken: string;
  refreshToken: string | null;
  updatedAt: string;
}

const installKeyOf = (key: string) => `install:${key}`;
const botKeyOf = (botId: string) => `bot:${botId}`;

/**
 * Persist a fresh authorization. If this bot (workspace connection) has been
 * installed before, reuse its install key and overwrite the token pair —
 * re-authorization mints new tokens and invalidates the old ones, and reusing
 * the key means an already-configured worker keeps working.
 */
export async function saveAuthorization(data: {
  botId: string;
  workspaceId: string;
  workspaceName: string;
  accessToken: string;
  refreshToken: string | null;
}): Promise<InstallRecord> {
  const r = getKv();
  const existingKey = await r.get<string>(botKeyOf(data.botId));
  const installKey = existingKey ?? `dvq_${randomBytes(24).toString("hex")}`;
  const record: InstallRecord = {
    ...data,
    installKey,
    updatedAt: new Date().toISOString(),
  };
  await r.set(installKeyOf(installKey), record);
  await r.set(botKeyOf(data.botId), installKey);
  return record;
}

export async function getInstall(
  installKey: string
): Promise<InstallRecord | null> {
  return getKv().get<InstallRecord>(installKeyOf(installKey));
}

export async function updateTokens(
  installKey: string,
  accessToken: string,
  refreshToken: string | null
): Promise<void> {
  const r = getKv();
  const record = await r.get<InstallRecord>(installKeyOf(installKey));
  if (!record) throw new Error(`No install record for key`);
  await r.set(installKeyOf(installKey), {
    ...record,
    accessToken,
    refreshToken,
    updatedAt: new Date().toISOString(),
  });
}
