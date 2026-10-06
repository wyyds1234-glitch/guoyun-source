import { apiError } from "../_shared/http.js";

export async function onRequestGet() {
  return apiError(410, "leaderboard_disabled", "排行榜功能已停用。");
}
