import { Redis } from "@upstash/redis";
import { randomBytes } from "crypto";

export interface InstallRecord {
  installKey: string;
  botId: string;
  workspaceId: string;
  workspaceName: string;
  accessToken: string;
  refreshToken: string | null;
  updatedAt: string;
}

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    // Vercel's Upstash marketplace integration injects UPSTASH_*; older
    // Vercel KV setups inject KV_REST_API_* — accept either.
    const url =
      process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
    const token =
      process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
    if (!url || !token) {
      throw new Error(
        "Missing Upstash Redis env vars (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)"
      );
    }
    redis = new Redis({ url, token });
  }
  return redis;
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
  const r = getRedis();
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
  return getRedis().get<InstallRecord>(installKeyOf(installKey));
}

export async function updateTokens(
  installKey: string,
  accessToken: string,
  refreshToken: string | null
): Promise<void> {
  const r = getRedis();
  const record = await r.get<InstallRecord>(installKeyOf(installKey));
  if (!record) throw new Error(`No install record for key`);
  await r.set(installKeyOf(installKey), {
    ...record,
    accessToken,
    refreshToken,
    updatedAt: new Date().toISOString(),
  });
}
