import { apiError, json } from "../_shared/http.js";

export async function onRequestGet({ env }) {
  try {
    const database = await env.GAME_DB.prepare("SELECT 1 AS ready").first();
    return json({
      ok: true,
      service: "tianxia-cloud",
      database: database?.ready === 1 ? "ready" : "unavailable",
      assets: "pages-static",
    });
  } catch (error) {
    console.error(JSON.stringify({ message: "health check failed", error: error instanceof Error ? error.message : String(error) }));
    return apiError(503, "cloud_unavailable", "云端服务暂不可用。");
  }
}
