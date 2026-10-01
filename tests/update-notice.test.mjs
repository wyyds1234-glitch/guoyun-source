import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [pwa, worker, version, html] = await Promise.all([
  readFile(new URL("../public/pwa.js", import.meta.url), "utf8"),
  readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  readFile(new URL("../public/version.js", import.meta.url), "utf8"),
  readFile(new URL("../public/play/index.html", import.meta.url), "utf8"),
]);

test("update prompt requires a strictly newer version than the active worker", () => {
  assert.match(worker, /type: "VERSION", version: APP_VERSION/);
  assert.match(pwa, /type: "GET_VERSION"/);
  assert.match(pwa, /compareVersions\(candidateVersion, activeVersion\) <= 0/);
  const appVersion = version.match(/APP_VERSION: "([\d.]+)"/)?.[1];
  assert.ok(appVersion, "the app must publish a version");
  assert.equal(worker.match(/const APP_VERSION = "([\d.]+)"/)?.[1], appVersion);
  assert.ok(html.includes(`version.js?v=app-${appVersion}`));
});

test("closing an update prompt remembers that exact release", () => {
  assert.match(pwa, /guoyun-update-notice-dismissed-version/);
  assert.match(pwa, /localStorage\.getItem\(UPDATE_NOTICE_KEY\) === candidateVersion/);
  assert.match(pwa, /localStorage\.setItem\(UPDATE_NOTICE_KEY, version\)/);
  assert.match(worker, /self\.skipWaiting\(\)/);
  assert.match(pwa, /await window\.TianxiaGame\?\.prepareForUpdate\?\.\(\)/);
  assert.match(pwa, /waitingWorker\.postMessage\(\{ type: "SKIP_WAITING" \}\)/);
});
