import "dotenv/config";
import { z } from "zod";

const optionalNonEmptyString = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}, z.string().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().default(4000),
  APP_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379/0"),
  JWT_ACCESS_SECRET: z.string().min(16),
  SUB2_BASE_URL: z.string().url(),
  SUB2_ADMIN_TOKEN: optionalNonEmptyString,
  SUB2_ADMIN_EMAIL: optionalNonEmptyString.pipe(z.string().email().optional()),
  SUB2_ADMIN_PASSWORD: optionalNonEmptyString,
  SUB2_PUBLIC_ENDPOINT: z.string().url(),
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

if (!env.SUB2_ADMIN_TOKEN && (!env.SUB2_ADMIN_EMAIL || !env.SUB2_ADMIN_PASSWORD)) {
  throw new Error("Either SUB2_ADMIN_TOKEN or SUB2_ADMIN_EMAIL/SUB2_ADMIN_PASSWORD must be configured");
}
