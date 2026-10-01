import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");
const outputDir = join(publicDir, "desktop");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

let html = await readFile(join(publicDir, "play/index.html"), "utf8");
html = html
  .replace('<base href="../" />', '<base href="./" />')
  .replace(/\s*<link rel="manifest"[^>]*>/, "")
  .replace(/\s*<button class="text-button install-button"[^>]*>[^<]*<\/button>/, "")
  .replace(/href="\/"/g, 'href="https://tianxia-ddr.pages.dev/" target="_blank" rel="noopener"')
  .replace(/href="\/download\/"/g, 'href="https://tianxia-ddr.pages.dev/download/" target="_blank" rel="noopener"')
  .replace(/\s*<script src="\.\/pwa\.js[^>]*><\/script>/, "")
  .replace(/(<script src="\.\/cloud-save\.js[^>]*><\/script>)/, '<script>window.TIANXIA_API_ORIGIN = "https://tianxia-ddr.pages.dev";</script>\n    $1')
  .replace("</body>", '    <script src="./desktop-update.js?v=desktop-v1"></script>\n  </body>');

await writeFile(join(outputDir, "index.html"), html);
await writeFile(join(outputDir, "desktop-update.js"), await readFile(join(publicDir, "desktop-update.js"), "utf8"));
for (const file of ["styles.css", "version.js", "era-config.js", "regions.js", "cloud-save.js", "geo-map.js", "game.js", "perf-harness.js", "favicon.svg"]) {
  await cp(join(publicDir, file), join(outputDir, file));
}
await cp(join(publicDir, "vendor"), join(outputDir, "vendor"), { recursive: true });
await cp(join(publicDir, "data"), join(outputDir, "data"), { recursive: true });

// Fail the build if a future script rename leaves the embedded page incomplete.
for (const match of html.matchAll(/<script\b[^>]*src="\.\/([^"?]+)(?:\?[^"]*)?"/g)) {
  await readFile(join(outputDir, match[1]));
}
if (!html.includes('window.TIANXIA_API_ORIGIN = "https://tianxia-ddr.pages.dev";')) {
  throw new Error('Desktop cloud API origin was not injected');
}

console.log(`desktop frontend prepared: ${outputDir}`);
