import { readReleaseManifest } from "../_shared/releases.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=60, stale-while-revalidate=300",
  "x-content-type-options": "nosniff",
};

export async function onRequestGet({ env }) {
  return new Response(JSON.stringify(await readReleaseManifest(env.DESKTOP_ASSETS)), { headers: JSON_HEADERS });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS" } });
}
