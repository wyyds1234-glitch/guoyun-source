import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const html = await readFile(new URL("../public/play/index.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

test("/play resource URLs resolve to deployed root assets", async () => {
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((url) => /\.(?:css|js|svg|webmanifest)(?:\?|$)/.test(url));

  assert.ok(assets.length > 0);
  for (const url of assets) {
    assert.ok(url.startsWith("/"), `${url} must not resolve relative to /play/`);
    const pathname = new URL(url, "https://example.invalid").pathname;
    const path = fileURLToPath(new URL(`../public${pathname}`, import.meta.url));
    await assert.doesNotReject(access(path), `${url} must exist in the Pages upload root`);
  }
  for (const name of ["styles.css", "game.js", "geo-map.js", "version.js", "pwa.js"]) {
    const asset = assets.find((url) => new URL(url, "https://example.invalid").pathname === `/${name}`);
    assert.ok(asset?.includes("?v="), `${name} needs a cache-busting version`);
    assert.ok(sw.includes(JSON.stringify(asset)), `${name} must use the same URL in the offline shell`);
  }
});
