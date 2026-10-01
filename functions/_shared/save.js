export const MAX_SAVE_BYTES = 512 * 1024;
export const SAVE_SLOT = "primary";
export const GAME_VERSION = 5;
export const MAP_VERSION = "tang741-v2";
export const HISTORY_DATA_VERSION = "tang-history-v1";

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function boundedText(value, maxLength, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : fallback;
}

function validText(value, maxLength = 120) {
  return value === undefined || (typeof value === "string" && value.length <= maxLength);
}

function validateTextFields(state) {
  for (const key of ["ruler", "kingdom", "characterName", "politicalPath", "scenarioType"]) {
    if (!validText(state[key], 80)) return "存档文字字段无效。";
  }
  for (const army of Object.values(state.armies || {})) {
    if (!validText(army?.name, 80) || !validText(army?.commander, 80) || !validText(army?.status, 160)) {
      return "军团文字字段无效。";
    }
  }
  if (!Array.isArray(state.logs || [])) return "日志数据无效。";
  if ((state.logs || []).length > 80) return "日志数量超出限制。";
  for (const entry of state.logs || []) {
    if (!entry || typeof entry !== "object" || !validText(entry.text, 600) || !validText(entry.date, 80) || !validText(entry.type, 40)) {
      return "日志文字字段无效。";
    }
  }
  for (const campaign of Object.values(state.enemyCampaigns || {})) {
    if (!campaign || typeof campaign !== "object" || !validText(campaign.factionName, 80)) return "敌军战役字段无效。";
  }
  return null;
}

function validateDynamicState(state) {
  const provinces = Object.entries(state.provinces || {});
  const regions = Object.entries(state.regions || {});
  const armies = Object.entries(state.armies || {});
  if (provinces.length > 32 || regions.length > 160 || armies.length > 64) return "存档对象数量超出限制。";
  for (const [, province] of provinces) {
    if (!province || typeof province !== "object") return "州郡状态无效。";
    for (const key of ["owner", "ownerId", "controllerId"]) {
      if (province[key] !== undefined && typeof province[key] !== "string") return "州郡控制者无效。";
    }
  }
  for (const [, region] of regions) {
    if (!region || typeof region !== "object") return "战略区域状态无效。";
    for (const key of ["owner", "ownerId", "controllerId"]) {
      if (region[key] !== undefined && typeof region[key] !== "string") return "战略区域控制者无效。";
    }
    for (const key of ["garrison", "fort", "population", "grain", "economy", "unrest"]) {
      if (region[key] !== undefined && (!Number.isFinite(Number(region[key])) || Number(region[key]) < 0 || Number(region[key]) > 1e12)) {
        return "战略区域数值无效。";
      }
    }
  }
  for (const [, army] of armies) {
    if (!army || typeof army !== "object") return "军团状态无效。";
    for (const key of ["infantry", "archers", "cavalry", "morale", "supply"]) {
      if (army[key] !== undefined && (!Number.isFinite(Number(army[key])) || Number(army[key]) < 0 || Number(army[key]) > 1e9)) {
        return "军团数值无效。";
      }
    }
  }
  return null;
}

export function parseSaveBody(raw) {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > MAX_SAVE_BYTES) {
    return { error: "存档超过 512KB 限制。" };
  }

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return { error: "存档不是有效的 JSON。" };
  }

  const state = envelope?.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return { error: "缺少有效游戏状态。" };
  if (finiteNumber(state.version, -1) !== GAME_VERSION) return { error: "存档版本与当前游戏不兼容。" };
  if (!state.provinces || typeof state.provinces !== "object") return { error: "存档缺少州郡数据。" };
  if (!state.regions || typeof state.regions !== "object") return { error: "存档缺少战略区域数据。" };
  const stateError = validateDynamicState(state);
  if (stateError) return { error: stateError };
  const textError = validateTextFields(state);
  if (textError) return { error: textError };

  const expectedRevisionValue = envelope?.expectedRevision ?? state.saveRevision;
  const hasExpectedRevision = expectedRevisionValue !== null && expectedRevisionValue !== undefined && expectedRevisionValue !== "";
  const numericExpectedRevision = hasExpectedRevision ? finiteNumber(expectedRevisionValue, -1) : null;
  if (hasExpectedRevision && numericExpectedRevision < 0) return { error: "存档版本号无效。" };
  const expectedRevision = hasExpectedRevision ? Math.floor(numericExpectedRevision) : null;

  const provinceCount = Object.values(state.provinces).filter((province) => province?.owner === "player").length;
  const troopCount = Object.values(state.armies || {}).reduce((sum, army) => {
    return sum + finiteNumber(army?.infantry) + finiteNumber(army?.archers) + finiteNumber(army?.cavalry);
  }, 0);

  return {
    value: {
      state,
      summary: {
        ruler: boundedText(state.ruler, 40, "无名君主"),
        kingdom: boundedText(state.kingdom, 40, "无名国号"),
        year: Math.max(1, Math.round(finiteNumber(state.calendar?.year, 189))),
        month: Math.min(12, Math.max(1, Math.round(finiteNumber(state.calendar?.month, 1)))),
        day: Math.min(31, Math.max(1, Math.round(finiteNumber(state.calendar?.day, 1)))),
        gold: Math.max(0, Math.round(finiteNumber(state.gold))),
        grain: Math.max(0, Math.round(finiteNumber(state.grain))),
        population: Math.max(0, Math.round(finiteNumber(state.population))),
        prestige: Math.max(0, Math.round(finiteNumber(state.prestige))),
        provinceCount,
        troopCount: Math.max(0, Math.round(troopCount)),
        actionPoints: Math.max(0, Math.round(finiteNumber(state.actionPoints))),
        mapVersion: boundedText(state.mapVersion, 32, MAP_VERSION),
        historyDataVersion: boundedText(state.historyDataVersion, 32, HISTORY_DATA_VERSION),
      },
      clientUpdatedAt: boundedText(envelope.clientUpdatedAt, 32) || new Date().toISOString(),
      expectedRevision,
    },
  };
}
