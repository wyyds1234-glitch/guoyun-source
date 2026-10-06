(() => {
  "use strict";

  // /play?perf=1..8 is a map-only profiling document.  Do not even create
  // the cloud client, access-code storage or retry state in that mode.
  if (Number(new URLSearchParams(window.location.search).get("perf") || 0) > 0) return;

  const ACCESS_CODE_KEY = "tianxia-cloud-access-code-v1";
  const META_KEY = "tianxia-cloud-save-meta-v1";
  // The web build uses same-origin Pages Functions.  The Tauri build is a
  // local bundle, so it supplies the production API origin at build time.
  const API_ORIGIN = String(window.TIANXIA_API_ORIGIN || "").replace(/\/+$/, "");
  const API_URL = `${API_ORIGIN}/api/save`;
  const CODE_PATTERN = /^TX-[A-Z2-9]{8}(?:-[A-Z2-9]{8}){3}$/;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let status = { state: "syncing", message: "正在同步云端", updatedAt: null };
  let saveQueue = Promise.resolve();
  let dirtyGeneration = 0;
  let accessCodeGeneration = 0;
  const remoteInspections = new WeakSet();

  function emit(next) {
    status = { ...status, ...next };
    window.dispatchEvent(new CustomEvent("tianxia-cloud-status", { detail: status }));
  }

  function readMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY) || "{}") || {}; } catch { return {}; }
  }

  function isAutoSyncDisabled() { return readMeta().autoSyncDisabled === true; }
  function getAutoSyncReason() { return readMeta().autoSyncReason || null; }

  function writeMeta(next) {
    try { localStorage.setItem(META_KEY, JSON.stringify({ ...readMeta(), ...next })); } catch { /* Local cache is optional. */ }
  }

  function normalizeAccessCode(value) {
    const compact = String(value || "").toUpperCase().replace(/[^A-Z2-9]/g, "");
    if (!compact.startsWith("TX") || compact.length !== 34) return null;
    const body = compact.slice(2);
    const code = `TX-${body.match(/.{1,8}/g).join("-")}`;
    return CODE_PATTERN.test(code) ? code : null;
  }

  function encodeBase32(bytes) {
    let bits = 0;
    let value = 0;
    let output = "";
    for (const byte of bytes) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        output += alphabet[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    return output;
  }

  function generateAccessCode() {
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    const body = encodeBase32(bytes).slice(0, 32);
    return `TX-${body.match(/.{1,8}/g).join("-")}`;
  }

  function getAccessCode() {
    try { return normalizeAccessCode(localStorage.getItem(ACCESS_CODE_KEY)); } catch { return null; }
  }

  function ensureAccessCode() {
    const existing = getAccessCode();
    if (existing) return existing;
    const created = generateAccessCode();
    localStorage.setItem(ACCESS_CODE_KEY, created);
    return created;
  }

  function snapshotAccessCode() {
    return { code: ensureAccessCode(), meta: localStorage.getItem(META_KEY), status: { ...status } };
  }

  function setAccessCode(value) {
    const code = normalizeAccessCode(value);
    if (!code) throw new Error("存档码格式不正确");
    const previous = snapshotAccessCode();
    if (code === previous.code) return previous;
    localStorage.setItem(ACCESS_CODE_KEY, code);
    accessCodeGeneration += 1;
    writeMeta({ dirty: false, lastSyncedAt: null, revision: null, autoSyncDisabled: false, autoSyncReason: null });
    emit({ state: "idle", message: "已更换云端存档码", updatedAt: null });
    return previous;
  }

  function restoreAccessCode(previous) {
    const code = normalizeAccessCode(previous?.code);
    if (!code || typeof previous?.status !== "object" || previous.status === null) {
      throw new Error("无法恢复此前的存档码");
    }
    localStorage.setItem(ACCESS_CODE_KEY, code);
    if (previous.meta === null) localStorage.removeItem(META_KEY);
    else localStorage.setItem(META_KEY, previous.meta);
    accessCodeGeneration += 1;
    status = { ...previous.status };
    window.dispatchEvent(new CustomEvent("tianxia-cloud-status", { detail: status }));
  }

  function suppressAutoSync(reason = "incompatible") {
    writeMeta({ autoSyncDisabled: true, autoSyncReason: reason });
    emit({ state: "failed", message: "云端自动同步已暂停", updatedAt: null });
  }

  function authHeaders(code, jsonBody = false) {
    const headers = { authorization: `Bearer ${code}` };
    if (jsonBody) headers["content-type"] = "application/json";
    return headers;
  }

  async function request(url, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
        credentials: API_ORIGIN ? "omit" : "same-origin",
      });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function load() {
    const code = ensureAccessCode();
    const generation = accessCodeGeneration;
    const initialMeta = readMeta();
    const initialRevision = Number(initialMeta.revision) || null;
    const initialAutoSyncDisabled = initialMeta.autoSyncDisabled === true;
    const cancelled = () => getAccessCode() !== code || accessCodeGeneration !== generation;
    const superseded = () => cancelled()
      || (Number(readMeta().revision) || null) !== initialRevision
      || isAutoSyncDisabled() !== initialAutoSyncDisabled;
    const cancelledResult = { found: false, cancelled: true };
    emit({ state: "syncing", message: "正在读取云端存档" });
    if (cancelled()) return cancelledResult;
    try {
      const response = await request(API_URL, { headers: authHeaders(code) });
      if (superseded()) return cancelledResult;
      if (response.ok) {
        const body = await response.json();
        if (superseded()) return cancelledResult;
        const localMeta = readMeta();
        const localDirty = Boolean(localMeta.dirty);
        const baseRevision = Number(localMeta.revision) || null;
        const autoSyncDisabled = localMeta.autoSyncDisabled === true;
        if (!body.save) {
          if (!localDirty) writeMeta({ revision: null, dirty: false });
          const conflict = localDirty && baseRevision !== null;
          emit(conflict
            ? { state: "conflict", message: "云端存档已删除，请先处理本地修改", updatedAt: null }
            : autoSyncDisabled
              ? { state: "idle", message: "云端自动同步已暂停", updatedAt: null }
              : localDirty
              ? { state: "syncing", message: "本地修改待同步", updatedAt: null }
              : { state: "ready", message: "云端存档已启用，等待首次写入", updatedAt: null });
          return cancelled() ? cancelledResult : { found: false, localDirty, conflict, autoSyncDisabled };
        }
        const remoteRevision = Number(body.save.revision) || null;
        const conflict = localDirty && baseRevision !== remoteRevision;
        // An unsynced local snapshot must retain the revision it was based on.
        // Adopting a newer remote revision here would let its next PUT silently
        // overwrite another device's progress instead of reporting a conflict.
        if (!localDirty) writeMeta({ lastSyncedAt: body.save.updatedAt, dirty: false, revision: remoteRevision });
        emit(conflict
          ? { state: "conflict", message: "云端版本冲突，请先读取最新存档", updatedAt: null }
          : autoSyncDisabled
            ? { state: "idle", message: "云端自动同步已暂停", updatedAt: null }
            : localDirty
            ? { state: "syncing", message: "本地修改待同步", updatedAt: null }
            : { state: "ready", message: "云端存档已读取", updatedAt: body.save.updatedAt });
        return cancelled() ? cancelledResult : { found: true, ...body.save, localDirty, conflict, autoSyncDisabled };
      }
      if (response.status === 404) {
        const localMeta = readMeta();
        const localDirty = Boolean(localMeta.dirty);
        const autoSyncDisabled = localMeta.autoSyncDisabled === true;
        if (!localDirty) writeMeta({ revision: null, dirty: false });
        const conflict = localDirty && (Number(localMeta.revision) || null) !== null;
        emit(conflict
          ? { state: "conflict", message: "云端存档已删除，请先处理本地修改", updatedAt: null }
          : autoSyncDisabled
            ? { state: "idle", message: "云端自动同步已暂停", updatedAt: null }
            : localDirty
            ? { state: "syncing", message: "本地修改待同步", updatedAt: null }
            : { state: "ready", message: "云端存档已启用，等待首次写入", updatedAt: null });
        return cancelled() ? cancelledResult : { found: false, localDirty, conflict, autoSyncDisabled };
      }
      throw new Error(`cloud load ${response.status}`);
    } catch (error) {
      if (superseded()) return cancelledResult;
      emit({ state: "offline", message: navigator.onLine ? "云端暂不可用，使用本地缓存" : "当前离线，使用本地缓存" });
      return cancelled() ? cancelledResult : { found: false, offline: true, error, localDirty: isDirty(), conflict: false, autoSyncDisabled: isAutoSyncDisabled() };
    }
  }

  async function inspectRemoteSave() {
    const code = ensureAccessCode();
    const generation = accessCodeGeneration;
    const initialRevision = Number(readMeta().revision) || null;
    const initialAutoSyncReason = getAutoSyncReason();
    const superseded = () => getAccessCode() !== code || accessCodeGeneration !== generation
      || (Number(readMeta().revision) || null) !== initialRevision
      || getAutoSyncReason() !== initialAutoSyncReason;
    const response = await request(API_URL, { headers: authHeaders(code) });
    if (superseded()) return { cancelled: true };
    if (!response.ok && response.status !== 404) throw new Error(`cloud inspect ${response.status}`);
    const body = response.ok ? await response.json() : { save: null };
    if (superseded()) return { cancelled: true };
    const revision = body.save ? Number(body.save.revision) : 0;
    if (!Number.isSafeInteger(revision) || revision < (body.save ? 1 : 0)) {
      throw new Error("云端存档版本号无效");
    }
    const inspection = Object.freeze({
      found: Boolean(body.save), revision, updatedAt: body.save?.updatedAt || null,
      state: body.save?.state || null, code, generation,
    });
    remoteInspections.add(inspection);
    return inspection;
  }

  function isCurrentInspection(inspection) {
    return remoteInspections.has(inspection)
      && inspection.code === getAccessCode()
      && inspection.generation === accessCodeGeneration;
  }

  function overwriteRemote(state, inspection) {
    if (!isCurrentInspection(inspection)) {
      const error = new Error("云端存档检查已失效，请重新读取");
      error.code = "save_conflict";
      return Promise.reject(error);
    }
    return queueSave(state, { manual: true, inspection });
  }

  function save(state, { manual = false } = {}) {
    return queueSave(state, { manual });
  }

  function waitForPendingSaves() { return saveQueue; }

  function queueSave(state, { manual = false, inspection = null } = {}) {
    const code = ensureAccessCode();
    const snapshot = JSON.stringify(state);
    const generation = dirtyGeneration;
    const job = saveQueue.then(() => {
      if (getAccessCode() !== code) {
        const error = new Error("存档已切换，旧同步已取消");
        error.code = "save_conflict";
        throw error;
      }
      if (isAutoSyncDisabled() && !manual) {
        const error = new Error("云端自动同步已暂停");
        error.code = "auto_sync_disabled";
        throw error;
      }
      if (manual && getAutoSyncReason() === "incompatible" && !inspection) {
        const error = new Error("请先确认要覆盖的云端存档版本");
        error.code = "recovery_required";
        throw error;
      }
      if (inspection && !isCurrentInspection(inspection)) {
        const error = new Error("云端存档检查已失效，请重新读取");
        error.code = "save_conflict";
        throw error;
      }
      return writeSave(snapshot, code, generation, manual, inspection);
    });
    // One failed request must not poison subsequent manual retries.
    saveQueue = job.catch(() => {});
    return job;
  }

  async function writeSave(snapshot, code, generation, manual, inspection) {
    emit({ state: "syncing", message: "正在写入云端" });
    try {
      if (inspection && !isCurrentInspection(inspection)) {
        const error = new Error("云端存档检查已失效，请重新读取");
        error.code = "save_conflict";
        throw error;
      }
      if (inspection) remoteInspections.delete(inspection);
      const response = await request(API_URL, {
        method: "PUT",
        headers: authHeaders(code, true),
        body: JSON.stringify({
          state: JSON.parse(snapshot),
          clientUpdatedAt: new Date().toISOString(),
          expectedRevision: inspection?.revision ?? (Number.isFinite(Number(readMeta().revision)) ? Number(readMeta().revision) : null),
        }),
      });
      if (response.status === 409) {
        const conflict = new Error("cloud save conflict");
        conflict.code = "save_conflict";
        emit({ state: "conflict", message: "云端版本冲突，请先读取最新存档" });
        throw conflict;
      }
      if (response.status === 507) {
        const error = new Error("云端存档空间已满；本地进度仍保留，但暂时无法同步新存档。请联系管理员处理。");
        error.code = "save_storage_full";
        emit({ state: "failed", message: error.message });
        throw error;
      }
      if (!response.ok) throw new Error(`cloud save ${response.status}`);
      const body = await response.json();
      if (getAccessCode() !== code) return body;
      writeMeta({ lastSyncedAt: body.updatedAt, dirty: dirtyGeneration !== generation, revision: Number(body.revision) || 1, autoSyncDisabled: manual ? false : isAutoSyncDisabled(), autoSyncReason: manual ? null : readMeta().autoSyncReason || null });
      emit({ state: "ready", message: "国事已保存至云端", updatedAt: body.updatedAt });
      return body;
    } catch (error) {
      if (getAccessCode() !== code) throw error;
      writeMeta({ dirty: true });
      if (error?.code !== "save_conflict" && error?.code !== "save_storage_full") {
        emit({ state: "offline", message: navigator.onLine ? "云端写入失败，已保留本地缓存" : "当前离线，已保留本地缓存" });
      }
      throw error;
    }
  }

  function remove() {
    const code = getAccessCode();
    if (!code) return Promise.resolve();
    const generation = dirtyGeneration;
    const job = saveQueue.then(async () => {
      const response = await request(API_URL, { method: "DELETE", headers: authHeaders(code) });
      if (!response.ok) throw new Error(`cloud delete ${response.status}`);
      if (getAccessCode() !== code) return;
      writeMeta({ dirty: dirtyGeneration !== generation, lastSyncedAt: null, revision: null, autoSyncDisabled: true, autoSyncReason: "deleted" });
      emit({ state: "idle", message: "云端存档已清除，自动同步已暂停", updatedAt: null });
    });
    saveQueue = job.catch(() => {});
    return job;
  }

  function markDirty() {
    dirtyGeneration += 1;
    writeMeta({ dirty: true, localUpdatedAt: new Date().toISOString() });
  }

  function isDirty() { return Boolean(readMeta().dirty); }
  function getStatus() { return { ...status }; }

  window.addEventListener("online", () => {
    if (isDirty()) emit({ state: "syncing", message: "网络已恢复，等待云端同步" });
  });

  window.TianxiaCloudSave = {
    ensureAccessCode,
    getAutoSyncReason,
    getAccessCode,
    getStatus,
    isAutoSyncDisabled,
    isDirty,
    load,
    markDirty,
    normalizeAccessCode,
    inspectRemoteSave,
    overwriteRemote,
    remove,
    restoreAccessCode,
    save,
    setAccessCode,
    snapshotAccessCode,
    suppressAutoSync,
    waitForPendingSaves,
  };
})();
