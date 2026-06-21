import { config } from "dotenv";
import { resolve } from "node:path";

// Load the repo-root .env when running db scripts directly (tsx).
// Apps load their own env; this is only for the db CLI scripts.
config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
