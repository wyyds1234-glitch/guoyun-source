import { RELEASE_PLATFORMS, r2AssetKey, readReleaseManifest } from "../_shared/releases.js";

const CONTENT_TYPES = { dmg: "application/x-apple-diskimage", exe: "application/vnd.microsoft.portable-executable" };

export async function onRequestGet({ request, env }) {
  const platformId = new URL(request.url).searchParams.get("platform") || "";
  const platform = RELEASE_PLATFORMS[platformId];
  if (!platform || !env.DESKTOP_ASSETS) return new Response("Installer unavailable", { status: 404, headers: { "cache-control": "no-store" } });
  const manifest = await readReleaseManifest(env.DESKTOP_ASSETS);
  const release = manifest.platforms[platformId];
  const key = r2AssetKey(platformId, manifest.version);
  if (!release?.available || !key || !release.url) return new Response("Installer unavailable", { status: 404, headers: { "cache-control": "no-store" } });
  const object = await env.DESKTOP_ASSETS.get(key);
  if (!object) return new Response("Installer unavailable", { status: 404, headers: { "cache-control": "no-store" } });
  const headers = new Headers({
    "content-type": CONTENT_TYPES[platform.extension] || "application/octet-stream",
    "content-disposition": `attachment; filename="${platform.filePattern(manifest.version)}"`,
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  if (object.size) headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS" } });
}
