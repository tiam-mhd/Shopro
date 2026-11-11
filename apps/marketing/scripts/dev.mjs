import { spawn, spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const appDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceDir = resolve(appDir, "src");
const buildScript = resolve(appDir, "scripts", "build.mjs");
const port = process.env.PORT || "5174";

function build() {
  const result = spawnSync(process.execPath, [buildScript], { cwd: appDir, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Marketing build failed.");
}

build();
const server = spawn(process.execPath, [resolve(appDir, "server.mjs")], {
  cwd: appDir,
  stdio: "inherit",
  env: { ...process.env, PORT: port, PUBLIC_URL: process.env.PUBLIC_URL || "http://localhost:" + port },
});

let timer;
const watcher = watch(sourceDir, { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { build(); }
    catch (error) { console.error(error); }
  }, 180);
});

function stop() {
  clearTimeout(timer);
  watcher.close();
  server.kill();
}

server.on("exit", (code) => {
  watcher.close();
  process.exitCode = code ?? 0;
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
