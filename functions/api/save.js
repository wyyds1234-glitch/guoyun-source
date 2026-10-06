import { hashAccessCode, readBearerAccessCode } from "../_shared/auth.js";
import { apiError, json } from "../_shared/http.js";
import { MAP_VERSION, MAX_SAVE_BYTES, parseSaveBody, SAVE_SLOT } from "../_shared/save.js";

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;
const requestBuckets = new Map();
const ALLOWED_APP_ORIGINS = new Set([
  "https://tianxia-ddr.pages.dev",
  "tauri://localhost",
  "https://tauri.localhost",
  "http://tauri.localhost",
]);

function corsHeaders(request) {
  const origin = request.headers.get("origin");
  if (!origin || !ALLOWED_APP_ORIGINS.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, PUT, DELETE, OPTIONS",
    vary: "Origin",
  };
}

function responseFor(request, response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(request))) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonFor(request, data, init = {}) {
  return responseFor(request, json(data, { ...init, headers: { ...corsHeaders(request), ...(init.headers || {}) } }));
}

function errorFor(request, status, code, message, init = {}) {
  return responseFor(request, apiError(status, code, message, { ...init, headers: { ...corsHeaders(request), ...(init.headers || {}) } }));
}

async function readBoundedBody(request, maxBytes) {
  if (!request.body) return { text: "" };
  const reader = request.body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - totalBytes) {
        // Reject immediately even if transport cancellation fails or stalls.
        void reader.cancel("request body too large").catch(() => {});
        return { tooLarge: true };
      }
      bytes.set(value, totalBytes);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, totalBytes)) };
  } catch {
    return { invalidEncoding: true };
  }
}

function allowRequest(playerId) {
  const now = Date.now();
  const recent = (requestBuckets.get(playerId) || []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    requestBuckets.set(playerId, recent);
    return false;
  }
  recent.push(now);
  requestBuckets.set(playerId, recent);
  if (requestBuckets.size > 2048) requestBuckets.delete(requestBuckets.keys().next().value);
  return true;
}

async function identify(request) {
  const accessCode = readBearerAccessCode(request);
  if (!accessCode) return { playerId: null, limited: false };
  const playerId = await hashAccessCode(accessCode);
  return { playerId, limited: !allowRequest(playerId) };
}

export async function onRequestGet({ request, env }) {
  const identity = await identify(request);
  if (!identity.playerId) return errorFor(request, 401, "access_code_required", "需要有效的云端存档码。");
  if (identity.limited) return errorFor(request, 429, "rate_limited", "请求过于频繁，请稍后再试。");
  const playerId = identity.playerId;

  try {
    const row = await env.GAME_DB.prepare(`
      SELECT state_json, revision, updated_at, game_version, map_version, save_version
      FROM game_saves
      WHERE player_id = ?1 AND slot = ?2
    `).bind(playerId, SAVE_SLOT).first();
    if (!row) return jsonFor(request, { ok: true, save: null });

    return jsonFor(request, {
      ok: true,
      save: {
        state: JSON.parse(row.state_json),
        revision: row.revision,
        updatedAt: row.updated_at,
        gameVersion: row.game_version,
        mapVersion: row.map_version || MAP_VERSION,
        saveVersion: row.save_version || row.revision,
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ message: "cloud save read failed", error: error instanceof Error ? error.message : String(error) }));
    return errorFor(request, 500, "save_read_failed", "读取云端存档失败。");
  }
}

export async function onRequestPut({ request, env }) {
  const identity = await identify(request);
  if (!identity.playerId) return errorFor(request, 401, "access_code_required", "需要有效的云端存档码。");
  if (identity.limited) return errorFor(request, 429, "rate_limited", "请求过于频繁，请稍后再试。");
  const playerId = identity.playerId;

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_SAVE_BYTES) return errorFor(request, 413, "save_too_large", "存档超过 512KB 限制。");
  let body;
  try {
    body = await readBoundedBody(request, MAX_SAVE_BYTES);
  } catch {
    return errorFor(request, 400, "invalid_save", "无法读取存档请求体。");
  }
  if (body.tooLarge) return errorFor(request, 413, "save_too_large", "存档超过 512KB 限制。");
  if (body.invalidEncoding) return errorFor(request, 400, "invalid_save", "存档必须使用有效的 UTF-8 编码。");
  const parsed = parseSaveBody(body.text);
  if (parsed.error) return errorFor(request, 400, "invalid_save", parsed.error);

  const { state, summary, clientUpdatedAt, expectedRevision } = parsed.value;
  const savedAt = new Date().toISOString();
  try {
    const current = await env.GAME_DB.prepare(
      "SELECT revision, updated_at, map_version FROM game_saves WHERE player_id = ?1 AND slot = ?2",
    ).bind(playerId, SAVE_SLOT).first();
    if (current && (expectedRevision === null || expectedRevision !== Number(current.revision))) {
      return errorFor(request, 409, "save_conflict", "云端存档已在另一台设备更新，请先读取最新版本。", {
        headers: { "x-save-revision": String(current.revision) },
      });
    }
    if (!current && expectedRevision !== null && expectedRevision !== 0) {
      return errorFor(request, 409, "save_conflict", "云端存档版本已变化，请先重新读取。", {
        headers: { "x-save-revision": "0" },
      });
    }
    const statements = [
      env.GAME_DB.prepare(`
        INSERT INTO players (id, created_at, last_seen_at)
        VALUES (?1, ?2, ?2)
        ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at
      `).bind(playerId, savedAt),
      env.GAME_DB.prepare(`
        INSERT INTO game_saves (
          player_id, slot, game_version, state_json, revision, client_updated_at, updated_at,
          ruler, kingdom, world_year, world_month, world_day, gold, grain, population,
          prestige, province_count, troop_count, map_version, save_version
        ) SELECT ?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, 1
        WHERE ?19 = 0 OR EXISTS (
          SELECT 1 FROM game_saves WHERE player_id = ?1 AND slot = ?2 AND revision = ?19
        )
        ON CONFLICT(player_id, slot) DO UPDATE SET
          game_version = excluded.game_version,
          state_json = excluded.state_json,
          revision = game_saves.revision + 1,
          client_updated_at = excluded.client_updated_at,
          updated_at = excluded.updated_at,
          ruler = excluded.ruler,
          kingdom = excluded.kingdom,
          world_year = excluded.world_year,
          world_month = excluded.world_month,
          world_day = excluded.world_day,
          gold = excluded.gold,
          grain = excluded.grain,
          population = excluded.population,
          prestige = excluded.prestige,
          province_count = excluded.province_count,
          troop_count = excluded.troop_count,
          map_version = excluded.map_version,
          save_version = game_saves.revision + 1
        WHERE game_saves.revision = ?19
        RETURNING revision
      `).bind(
        playerId, SAVE_SLOT, state.version, JSON.stringify(state), clientUpdatedAt, savedAt,
        summary.ruler, summary.kingdom, summary.year, summary.month, summary.day,
        summary.gold, summary.grain, summary.population, summary.prestige,
        summary.provinceCount, summary.troopCount, summary.mapVersion || MAP_VERSION,
        expectedRevision ?? 0,
      ),
    ];
    // Compare-and-write must be atomic; the earlier read is only a fast reject.
    // RETURNING belongs to this write, never a later writer's revision.
    const results = await env.GAME_DB.batch(statements);
    const saved = results[1]?.results?.[0];
    if (!saved) return errorFor(request, 409, "save_conflict", "云端存档已更新，请先读取最新版本。");
    return jsonFor(request, { ok: true, revision: saved.revision, updatedAt: savedAt, mapVersion: summary.mapVersion || MAP_VERSION });
  } catch (error) {
    console.error(JSON.stringify({ message: "cloud save write failed", error: error instanceof Error ? error.message : String(error) }));
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("game_player_quota_exceeded") || message.includes("game_save_quota_exceeded")) {
      return errorFor(request, 507, "save_storage_full", "云端存档空间已满；本地进度仍保留，但暂时无法同步新存档。请联系管理员处理。");
    }
    return errorFor(request, 500, "save_write_failed", "写入云端存档失败。");
  }
}

export async function onRequestDelete({ request, env }) {
  const identity = await identify(request);
  if (!identity.playerId) return errorFor(request, 401, "access_code_required", "需要有效的云端存档码。");
  if (identity.limited) return errorFor(request, 429, "rate_limited", "请求过于频繁，请稍后再试。");
  const playerId = identity.playerId;

  try {
    await env.GAME_DB.prepare("DELETE FROM game_saves WHERE player_id = ?1 AND slot = ?2")
      .bind(playerId, SAVE_SLOT).run();
    return jsonFor(request, { ok: true });
  } catch (error) {
    console.error(JSON.stringify({ message: "cloud save delete failed", error: error instanceof Error ? error.message : String(error) }));
    return errorFor(request, 500, "save_delete_failed", "删除云端存档失败。");
  }
}

export function onRequestOptions({ request }) {
  return responseFor(request, new Response(null, { status: 204, headers: corsHeaders(request) }));
}
