import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const logDirectory = join(root, ".wrangler", "logs");
mkdirSync(logDirectory, { recursive: true });

const result = spawnSync(
  process.execPath,
  [join(root, "node_modules", "wrangler", "bin", "wrangler.js"), "types", "worker-configuration.d.ts", "--check"],
  {
    cwd: root,
    env: { ...process.env, WRANGLER_LOG_PATH: logDirectory },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
