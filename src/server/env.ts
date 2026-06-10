import { z } from "zod";

const envSchema = z.object({
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(32),
  DATABASE_URL: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_APP_NAME: z.string().default("Open Chat Local"),
  OPENROUTER_SITE_URL: z.string().url().default("http://localhost:3000"),
  PORT: z.coerce.number().int().positive().default(3000),
  STREAMS_PORT: z.coerce.number().int().positive().default(51234),
  STREAMS_URL: z.string().url().optional().or(z.literal("")),
});

export const env = envSchema.parse(process.env);

export function requireOpenRouterApiKey() {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is required for model calls");
  }

  return env.OPENROUTER_API_KEY;
}

