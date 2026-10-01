export async function onRequestGet({ env }) {
  if (!env.DESKTOP_ASSETS) return new Response("Updater unavailable", { status: 404, headers: { "cache-control": "no-store" } });
  const object = await env.DESKTOP_ASSETS.get("updates/latest.json");
  if (!object) return new Response("Updater unavailable", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(object.body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
      "x-content-type-options": "nosniff",
    },
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS" } });
}
