import { apiError, json } from "../_shared/http.js";

export async function onRequestGet({ env }) {
  try {
    const result = await env.GAME_DB.prepare(`
      SELECT kingdom, ruler, world_year, prestige, province_count, troop_count, updated_at
      FROM game_saves
      WHERE slot = 'primary'
      ORDER BY province_count DESC, prestige DESC, troop_count DESC
      LIMIT 50
    `).all();
    return json({ ok: true, rankings: result.results || [] });
  } catch (error) {
    console.error(JSON.stringify({ message: "leaderboard read failed", error: error instanceof Error ? error.message : String(error) }));
    return apiError(500, "leaderboard_failed", "排行榜暂不可用。");
  }
}
