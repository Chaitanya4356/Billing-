import { z } from "zod";

/**
 * Validated process environment. Every problem is reported by variable name
 * only: values (the database URL carries a password) are never echoed.
 */
const envSchema = z.object({
  DATABASE_URL: z
    .string({ error: "required" })
    .min(1, "required")
    .refine(isPostgresUrl, "must be a postgres:// or postgresql:// URL"),
  NODE_ENV: z
    .enum(["development", "test", "production"], { error: "must be one of development, test, production" })
    .default("development"),
});

export type Env = z.infer<typeof envSchema>;

function isPostgresUrl(value: string): boolean {
  try {
    const { protocol, hostname } = new URL(value);
    return (protocol === "postgres:" || protocol === "postgresql:") && hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * Parses and validates the given environment. Throws ONE error that lists
 * every missing or invalid variable (name and reason, never the value).
 */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;

  // One line per variable, first problem only.
  const problems = new Map<string, string>();
  for (const issue of result.error.issues) {
    const name = String(issue.path[0] ?? "environment");
    if (!problems.has(name)) problems.set(name, issue.message);
  }
  const lines = [...problems].map(([name, reason]) => `  - ${name}: ${reason}`);
  throw new Error(`Invalid environment configuration (copy .env.example to .env):\n${lines.join("\n")}`);
}

let cached: Env | undefined;

/** `parseEnv(process.env)`, evaluated once per process and cached. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
