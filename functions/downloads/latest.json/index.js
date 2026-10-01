import { readReleaseManifest } from "../../_shared/releases.js";

export async function onRequestGet({ env }) {
  const manifest = await readReleaseManifest(env.DESKTOP_ASSETS);
  return new Response(JSON.stringify({
    version: manifest.version,
    mac_arm64_url: manifest.mac_arm64_url,
    windows_x64_url: manifest.windows_x64_url,
    mac_size: manifest.mac_size,
    windows_size: manifest.windows_size,
    published_at: manifest.published_at,
  }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
      "x-content-type-options": "nosniff",
    },
  });
}
