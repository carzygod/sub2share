import "dotenv/config";
import { z } from "zod";

const optionalNonEmptyString = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}, z.string().optional());

const optionalPositiveInteger = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}, z.coerce.number().int().positive().optional());

const booleanString = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off", ""].includes(normalized)) return false;
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().default(4000),
  APP_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  API_PUBLIC_URL: optionalNonEmptyString.pipe(z.string().url().optional()),
  OPENAI_PROXY_PUBLIC_ENDPOINT: optionalNonEmptyString.pipe(z.string().url().optional()),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379/0"),
  JWT_ACCESS_SECRET: z.string().min(16),
  SUB2_BASE_URL: z.string().url(),
  SUB2_ADMIN_TOKEN: optionalNonEmptyString,
  SUB2_ADMIN_EMAIL: optionalNonEmptyString.pipe(z.string().email().optional()),
  SUB2_ADMIN_PASSWORD: optionalNonEmptyString,
  SUB2_PUBLIC_ENDPOINT: z.string().url(),
  SUB2_DEFAULT_GROUP_ID: optionalPositiveInteger,
  SUB2_SMOKE_MODEL: optionalNonEmptyString.default("gpt-5.3-codex"),
  SUB2_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  SUB2_REQUEST_RETRY_ATTEMPTS: z.coerce.number().int().nonnegative().default(2),
  SUB2_REQUEST_RETRY_BASE_MS: z.coerce.number().int().positive().default(500),
  SUB2_USAGE_SYNC_INTERVAL_MS: z.coerce.number().int().nonnegative().default(0),
  SUB2_USAGE_SYNC_ON_START: booleanString.default(false),
  OPENAI_PROXY_BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  OPENAI_PROXY_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  OPENAI_PROXY_STREAM_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  OPENAI_PROXY_MIN_WALLET_BALANCE: z.coerce.number().nonnegative().default(0),
  PAYMENT_PROVIDER: z.enum(["mock", "disabled"]).default("mock"),
  DEFAULT_DISCOUNT_RATE: z.coerce.number().default(0.2),
  MIN_RECHARGE_AMOUNT: z.coerce.number().default(10),
  MIN_WITHDRAWAL_AMOUNT: z.coerce.number().default(20),
  GOOGLE_OAUTH_CLIENT_ID: optionalNonEmptyString,
  GOOGLE_OAUTH_CLIENT_SECRET: optionalNonEmptyString,
  GOOGLE_OAUTH_REDIRECT_URI: optionalNonEmptyString.pipe(z.string().url().optional()),
  X_OAUTH_CLIENT_ID: optionalNonEmptyString,
  X_OAUTH_CLIENT_SECRET: optionalNonEmptyString,
  X_OAUTH_REDIRECT_URI: optionalNonEmptyString.pipe(z.string().url().optional())
});

export const env = envSchema.parse(process.env);

export const openAiProxyPublicEndpoint = resolveOpenAiProxyPublicEndpoint();

if (!env.SUB2_ADMIN_TOKEN && (!env.SUB2_ADMIN_EMAIL || !env.SUB2_ADMIN_PASSWORD)) {
  throw new Error("Either SUB2_ADMIN_TOKEN or SUB2_ADMIN_EMAIL/SUB2_ADMIN_PASSWORD must be configured");
}

function resolveOpenAiProxyPublicEndpoint() {
  if (env.OPENAI_PROXY_PUBLIC_ENDPOINT) {
    return env.OPENAI_PROXY_PUBLIC_ENDPOINT.replace(/\/$/, "");
  }

  if (env.API_PUBLIC_URL) {
    return `${env.API_PUBLIC_URL.replace(/\/$/, "")}/v1`;
  }

  if (env.NODE_ENV === "production") {
    throw new Error("Either OPENAI_PROXY_PUBLIC_ENDPOINT or API_PUBLIC_URL must be configured in production");
  }

  return `http://localhost:${env.API_PORT}/v1`;
}
