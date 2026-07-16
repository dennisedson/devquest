import { Redis as UpstashRedis } from "@upstash/redis";
import IORedis from "ioredis";

/**
 * Minimal key-value client over whichever Redis credentials the deployment
 * has. Vercel's storage integrations inject different shapes:
 *   - Upstash REST:  UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *   - legacy KV:     KV_REST_API_URL + KV_REST_API_TOKEN
 *   - Redis (new):   REDIS_URL (rediss:// TCP connection string)
 * Values are stored as JSON either way.
 */
export interface Kv {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<void>;
}

function upstashKv(url: string, token: string): Kv {
  const redis = new UpstashRedis({ url, token });
  return {
    async get<T>(key: string) {
      return (await redis.get<T>(key)) ?? null;
    },
    async set(key, value, opts) {
      if (opts?.ex) await redis.set(key, value, { ex: opts.ex });
      else await redis.set(key, value);
    },
  };
}

function tcpKv(url: string): Kv {
  const redis = new IORedis(url, { maxRetriesPerRequest: 3 });
  return {
    async get<T>(key: string) {
      const raw = await redis.get(key);
      if (raw == null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    },
    async set(key, value, opts) {
      const serialized = JSON.stringify(value);
      if (opts?.ex) await redis.set(key, serialized, "EX", opts.ex);
      else await redis.set(key, serialized);
    },
  };
}

let kv: Kv | null = null;

export function getKv(): Kv {
  if (kv) return kv;

  const restUrl =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const restToken =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (restUrl && restToken) {
    kv = upstashKv(restUrl, restToken);
    return kv;
  }

  const tcpUrl = process.env.REDIS_URL ?? process.env.KV_URL;
  if (tcpUrl) {
    kv = tcpKv(tcpUrl);
    return kv;
  }

  throw new Error(
    "No Redis credentials found — set REDIS_URL, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN"
  );
}
