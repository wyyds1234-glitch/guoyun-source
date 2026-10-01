import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { readReleaseManifest } from "../functions/_shared/releases.js";

const config = await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8");
const cargo = await readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/tauri-release.yml", import.meta.url), "utf8");
const download = await readFile(new URL("../public/download/index.html", import.meta.url), "utf8");
const builder = await readFile(new URL("../scripts/build-desktop.mjs", import.meta.url), "utf8");
const update = await readFile(new URL("../public/desktop-update.js", import.meta.url), "utf8");
const releaseClient = await readFile(new URL("../public/download/download.js", import.meta.url), "utf8");
const routesConfig = JSON.parse(await readFile(new URL("../public/_routes.json", import.meta.url), "utf8"));
const releasesApi = await readFile(new URL("../functions/api/releases.js", import.meta.url), "utf8");
const downloadApi = await readFile(new URL("../functions/api/desktop-download.js", import.meta.url), "utf8");
const latestRoute = await readFile(new URL("../functions/downloads/latest.json/index.js", import.meta.url), "utf8");
const releaseShared = await readFile(new URL("../functions/_shared/releases.js", import.meta.url), "utf8");
const routes = await readFile(new URL("../public/_routes.json", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

test("desktop package is a local Tauri bundle, not a remote webview", () => {
  const parsed = JSON.parse(config);
  assert.equal(parsed.productName, "国运");
  assert.match(parsed.version, /^\d+\.\d+\.\d+$/);
  assert.ok(cargo.includes(`version = "${parsed.version}"`));
  assert.equal(parsed.identifier, "com.guoyun.game");
  assert.equal(parsed.build.frontendDist, "../public/desktop");
  assert.equal(parsed.bundle.macOS.signingIdentity, "-");
  assert.equal(parsed.bundle.macOS.minimumSystemVersion, "11.0");
  assert.ok(parsed.bundle.icon.includes("icons/icon.png"));
  assert.ok(parsed.bundle.icon.includes("icons/icon.icns"));
  assert.ok(parsed.bundle.icon.includes("icons/icon.ico"));
  assert.ok(parsed.bundle.targets.includes("dmg"));
  assert.ok(parsed.bundle.targets.includes("nsis"));
  assert.match(parsed.plugins.updater.endpoints[0], /tianxia-ddr\.pages\.dev\/api\/desktop-updates/);
  assert.doesNotMatch(parsed.plugins.updater.endpoints[0], /github\.com/);
  assert.match(cargo, /tauri-plugin-updater/);
  assert.doesNotMatch(config, /tianxia-ddr\.pages\.dev\/play/);
  assert.match(builder, /window\.TIANXIA_API_ORIGIN/);
  assert.match(builder, /desktop-update\.js/);
});

test("desktop release pipeline builds ad-hoc macOS and Windows installers", () => {
  assert.match(workflow, /tauri-apps\/tauri-action@v1/);
  assert.match(workflow, /macos-latest/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /aarch64-apple-darwin/);
  assert.match(workflow, /Guoyun-\$\{version\}-arm64\.dmg/);
  assert.match(workflow, /Guoyun-Setup-\$\{version\}\.exe/);
  assert.match(workflow, /downloads\/mac/);
  assert.match(workflow, /downloads\/windows/);
  assert.match(workflow, /downloads\/latest\.json/);
  assert.match(workflow, /Upload installer artifact for Pages deployment/);
  assert.match(workflow, /pages deploy public --project-name=tianxia/);
  assert.match(workflow, /25 MiB/);
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(workflow, /Configure optional updater signing/);
  assert.match(workflow, /Signature=adhoc/);
  assert.match(workflow, /hdiutil attach/);
  assert.match(workflow, /releaseAssetNamePattern/);
  assert.match(workflow, /uploadUpdaterJson/);
  assert.match(update, /check_for_update/);
  assert.match(update, /install_update/);
  assert.match(update, /prepareForUpdate/);
});

test("download page never exposes unverified private-release links", () => {
  assert.doesNotMatch(download, /github\.com|releases\/latest\/download/);
  assert.match(download, /data-release-card="mac_arm64"/);
  assert.match(download, /data-release-card="windows_x64"/);
  assert.match(download, /disabled data-release-button/);
  assert.match(releaseClient, /\/downloads\/latest\.json\?client=/);
  assert.match(releasesApi, /readReleaseManifest/);
  assert.match(releaseShared, /bucket\.head/);
  assert.match(downloadApi, /platform/);
  assert.match(latestRoute, /readReleaseManifest/);
  assert.match(releaseShared, /Guoyun-\$\{version\}-arm64\.dmg/);
  assert.match(releaseShared, /Guoyun-Setup-\$\{version\}\.exe/);
  assert.match(workflow, /Commit public installers to main/);
  assert.match(workflow, /git push origin HEAD:main/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/downloads\/"\)/);
  assert.doesNotMatch(routes, /\/downloads\/\*/);
  assert.deepEqual(routesConfig.include, ["/api/*"]);
  assert.match(download, /href="\/play\/"/);
  assert.match(download, /开发中/);
  assert.match(releaseClient, /manifest\.platforms\?\.mac_arm64\?\.available === true/);
});

test("legacy release manifest validation never trusts missing installer assets", async () => {
  const source = JSON.stringify({
    version: "0.1.0",
    published_at: "2026-08-21T00:00:00.000Z",
    platforms: {
      mac_arm64: { available: true, asset: "downloads/mac/Guoyun-0.1.0-arm64.dmg", size: 111 },
      windows_x64: { available: true, asset: "downloads/windows/Guoyun-Setup-0.1.0.exe", size: 222 },
    },
  });
  const bucket = {
    async get(key) { return key === "downloads/latest.json" ? { text: async () => source } : null; },
    async head(key) { return key.endsWith(".dmg") ? { size: 111 } : null; },
  };
  const manifest = await readReleaseManifest(bucket);
  assert.equal(manifest.mac_arm64_url, "/api/desktop-download?platform=mac_arm64");
  assert.equal(manifest.mac_size, 111);
  assert.equal(manifest.windows_x64_url, null);
  assert.equal(manifest.windows_size, null);
});

test("static release manifest advertises only installers shipped with the site", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/downloads/latest.json", import.meta.url), "utf8"));
  for (const [platform, release] of Object.entries(manifest.platforms)) {
    if (!release.available) continue;
    const url = platform === "mac_arm64" ? manifest.mac_arm64_url : manifest.windows_x64_url;
    const expectedSize = platform === "mac_arm64" ? manifest.mac_size : manifest.windows_size;
    assert.match(url, /^\/downloads\/[\w.-]+\.(?:dmg|exe)$/);
    const asset = new URL(`../public${url}`, import.meta.url);
    assert.equal((await stat(asset)).size, expectedSize, `${platform} installer size`);
  }
});
