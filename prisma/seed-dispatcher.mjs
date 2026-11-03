import "dotenv/config";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let args;
if (process.env.NODE_ENV === "production") {
  const entrypoint = resolve(root, "apps/api/dist/cli/seed-production-subscriptions.js");
  if (!existsSync(entrypoint)) throw new Error("فایل seed production در image نیست؛ image را با نسخهٔ جدید Dockerfile دوباره بسازید.");
  args = [entrypoint];
} else {
  const tsx = resolve(root, "node_modules/tsx/dist/cli.mjs");
  if (!existsSync(tsx)) throw new Error("tsx پیدا نشد؛ در محیط توسعه npm ci را اجرا کنید.");
  const subscriptionsOnly = process.argv.includes("--subscriptions-only");
  args = [tsx, subscriptionsOnly ? "prisma/seed-subscriptions.ts" : "prisma/seed.ts"];
}

const result = spawnSync(process.execPath, args, { cwd: root, env: process.env, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
