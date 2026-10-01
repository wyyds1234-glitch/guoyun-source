import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set(["node_modules", ".git", ".wrangler", "output", ".playwright-cli", "local-cache", "desktop", "target", "gen"]);
const scripts = [];

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    if (ignored.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if ([".js", ".mjs"].includes(extname(path))) scripts.push(path);
  }
}

walk(root);
for (const script of scripts) execFileSync(process.execPath, ["--check", script], { stdio: "pipe" });

const manifest = JSON.parse(readFileSync(join(root, "foundation/assets.json"), "utf8"));
for (const asset of manifest.assets) {
  const path = join(root, asset.file);
  if (!existsSync(path)) continue;
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== asset.bytes || sha256 !== asset.sha256) {
    throw new Error(`地图资源校验失败：${asset.file}`);
  }
}

console.log(`检查通过：${scripts.length} 个脚本，${manifest.assets.length} 个地图资源清单。`);
