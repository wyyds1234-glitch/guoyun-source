import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/game.js", import.meta.url), "utf8");

function gameFunction(name, nextName, context) {
  const start = source.indexOf(`  async function ${name}(`);
  const end = source.indexOf(`  async function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start);
  const sandbox = vm.createContext(context);
  vm.runInContext(source.slice(start, end), sandbox);
  return sandbox[name];
}

function bootGame(client, applyRemoteSave = async () => {}) {
  const intervals = [];
  const state = { started: true, speed: 4, calendar: { day: 1 } };
  const sandbox = vm.createContext({
    state, PERFORMANCE_MODE: false, strategicTimer: null, cloudSaveReady: false, cloudHydrationPending: true,
    window: {
      TianxiaCloudSave: client,
      setInterval(callback, delay) { intervals.push({ callback, delay }); return intervals.length; },
      clearInterval() {},
      clearTimeout() {},
    },
    render() {}, updateCloudStatus() {}, updateHeader() {}, syncStartGate() {}, toast() {}, setCloudControlsBusy() {},
    applyRemoteSave: (remote) => applyRemoteSave(sandbox, remote),
    scheduleCloudSave() {}, $: () => null,
    advanceDay() { sandbox.state.calendar.day += 1; },
  });
  const cloudStart = source.indexOf("  async function initializeCloudSave(");
  const cloudEnd = source.indexOf("  async function syncCloudNow(", cloudStart);
  const clockStart = source.indexOf("  function restartStrategicClock(");
  const clockEnd = source.indexOf("  function growEnemies(", clockStart);
  const bootStart = source.indexOf("  if (PERFORMANCE_MODE) state.speed = 0;");
  const bootEnd = source.lastIndexOf("\n})();");
  assert.ok(cloudStart >= 0 && cloudEnd > cloudStart && clockStart >= 0 && clockEnd > clockStart && bootStart >= 0 && bootEnd > bootStart);
  vm.runInContext(source.slice(cloudStart, cloudEnd)
    + source.slice(clockStart, clockEnd)
    + source.slice(bootStart, bootEnd), sandbox);
  return { sandbox, intervals };
}

test("a saved running clock waits for cloud hydration before its first tick", async () => {
  let finishLoad;
  const client = {
    snapshotAccessCode: () => ({}),
    load: () => new Promise(resolve => { finishLoad = resolve; }),
    isAutoSyncDisabled: () => false,
    ensureAccessCode: () => "test-code",
  };
  const { sandbox, intervals } = bootGame(client, async (game, remote) => { game.state = remote.state; });
  assert.equal(intervals.length, 0);
  finishLoad({ found: true, localDirty: false, autoSyncDisabled: false,
    state: { started: true, speed: 4, calendar: { day: 10 } } });
  await new Promise(setImmediate);
  assert.equal(sandbox.cloudHydrationPending, false);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].delay, 300);
  intervals[0].callback();
  assert.equal(sandbox.state.calendar.day, 11);
});

test("a saved running clock resumes after offline cloud startup", async () => {
  const client = {
    snapshotAccessCode: () => ({}),
    load: async () => ({ found: false, offline: true, localDirty: false }),
    isAutoSyncDisabled: () => false,
    ensureAccessCode: () => "test-code",
  };
  const { sandbox, intervals } = bootGame(client);
  assert.equal(intervals.length, 0);
  await new Promise(setImmediate);
  assert.equal(sandbox.cloudHydrationPending, false);
  assert.equal(intervals.length, 1);
  intervals[0].callback();
  assert.equal(sandbox.state.calendar.day, 2);
});

test("realtime changes mark cloud state dirty before the local write timer runs", () => {
  let dirtyCalls = 0;
  let scheduled = false;
  const start = source.indexOf("  function saveState(");
  const end = source.indexOf("  function scheduleCloudSave(", start);
  const sandbox = vm.createContext({
    window: {
      TianxiaCloudSave: { markDirty: () => { dirtyCalls += 1; } },
      setTimeout: () => { scheduled = true; return 1; },
      clearTimeout() {},
    },
    localSaveTimer: 0,
    lastLocalSaveAt: Date.now(),
    persistStateNow() {},
    Date,
    Math,
  });
  vm.runInContext(source.slice(start, end), sandbox);
  sandbox.saveState({ realtime: true });
  assert.equal(dirtyCalls, 1);
  assert.equal(scheduled, true);
});

test("a pending automatic save cannot recreate a deleted cloud save", async () => {
  let disabled = false;
  let timer;
  let writes = 0;
  const client = {
    isAutoSyncDisabled: () => disabled,
    save: async () => { writes += 1; },
  };
  const start = source.indexOf("  function scheduleCloudSave(");
  const end = source.indexOf("  function clamp(", start);
  const sandbox = vm.createContext({
    window: { TianxiaCloudSave: client, setTimeout: callback => { timer = callback; return 1; }, clearTimeout() {} },
    state: {}, cloudSaveReady: true, cloudHydrationPending: false, cloudSaveTimer: 0, cloudRetryAttempt: 0,
  });
  vm.runInContext(source.slice(start, end), sandbox);
  sandbox.scheduleCloudSave();
  disabled = true;
  await timer();
  assert.equal(writes, 0);
});

test("a pending automatic save cannot write into a code being imported", async () => {
  let timer;
  let writes = 0;
  const client = {
    isAutoSyncDisabled: () => false,
    save: async () => { writes += 1; },
  };
  const start = source.indexOf("  function scheduleCloudSave(");
  const end = source.indexOf("  function clamp(", start);
  const sandbox = vm.createContext({
    window: { TianxiaCloudSave: client, setTimeout: callback => { timer = callback; return 1; }, clearTimeout() {} },
    state: {}, cloudSaveReady: true, cloudHydrationPending: false, cloudSaveTimer: 0, cloudRetryAttempt: 0,
  });
  vm.runInContext(source.slice(start, end), sandbox);
  sandbox.scheduleCloudSave();
  sandbox.cloudHydrationPending = true;
  await timer();
  assert.equal(writes, 0);
});

test("startup keeps local edits made while the cloud read is pending", async () => {
  const applied = [];
  const scheduled = [];
  const client = {
    load: async () => ({ found: true, state: { gold: 200 }, localDirty: true, conflict: true }),
    ensureAccessCode: () => "test-code",
    snapshotAccessCode: () => ({}),
    isAutoSyncDisabled: () => false,
  };
  const initialize = gameFunction("initializeCloudSave", "syncCloudNow", {
    window: { TianxiaCloudSave: client },
    updateCloudStatus() {},
    applyRemoteSave: async (remote) => applied.push(remote),
    scheduleCloudSave: (immediate) => scheduled.push(immediate),
    toast() {},
    $: () => null,
    cloudSaveReady: false,
  });
  await initialize();
  assert.equal(applied.length, 0);
  assert.equal(scheduled.length, 0);
});

test("startup retries a dirty local save only when its cloud base still matches", async () => {
  const scheduled = [];
  const client = {
    load: async () => ({ found: true, localDirty: true, conflict: false }),
    ensureAccessCode: () => "test-code",
    snapshotAccessCode: () => ({}),
    isAutoSyncDisabled: () => false,
  };
  const initialize = gameFunction("initializeCloudSave", "syncCloudNow", {
    window: { TianxiaCloudSave: client },
    updateCloudStatus() {},
    applyRemoteSave: async () => assert.fail("dirty state must remain local"),
    scheduleCloudSave: (immediate) => scheduled.push(immediate),
    toast() {},
    $: () => null,
    cloudSaveReady: false,
  });
  await initialize();
  assert.deepEqual(scheduled, [true]);
});

test("startup does not recreate an intentionally deleted cloud save", async () => {
  const scheduled = [];
  const client = {
    load: async () => ({ found: false, localDirty: false, conflict: false, autoSyncDisabled: true }),
    ensureAccessCode: () => "test-code",
    snapshotAccessCode: () => ({}),
    isAutoSyncDisabled: () => true,
  };
  const initialize = gameFunction("initializeCloudSave", "syncCloudNow", {
    window: { TianxiaCloudSave: client },
    updateCloudStatus() {},
    scheduleCloudSave: immediate => scheduled.push(immediate),
    toast() {},
    $: () => null,
    cloudSaveReady: false,
  });
  await initialize();
  assert.deepEqual(scheduled, []);
});

test("incompatible cloud state cannot become the base for an automatic overwrite", async () => {
  const prior = { code: "test-code", meta: '{"revision":1}', status: { state: "ready" } };
  const restored = [];
  const suppressed = [];
  const client = {
    load: async () => ({ found: true, localDirty: false, state: { version: 99 } }),
    ensureAccessCode: () => prior.code,
    snapshotAccessCode: () => prior,
    restoreAccessCode: snapshot => restored.push(snapshot),
    suppressAutoSync: reason => suppressed.push(reason),
  };
  const initialize = gameFunction("initializeCloudSave", "syncCloudNow", {
    window: { TianxiaCloudSave: client },
    updateCloudStatus() {},
    applyRemoteSave: async () => { throw new Error("incompatible"); },
    scheduleCloudSave: () => assert.fail("incompatible remote state cannot auto-sync"),
    toast() {},
    $: () => null,
    cloudSaveReady: false,
  });
  await initialize();
  assert.deepEqual(restored, [prior]);
  assert.deepEqual(suppressed, ["incompatible"]);
});

test("sync cannot write while startup cloud hydration is pending", async () => {
  let writes = 0;
  const sync = gameFunction("syncCloudNow", "importCloudSave", {
    cloudHydrationPending: true,
    window: { TianxiaCloudSave: { save: async () => { writes += 1; } } },
    setCloudControlsBusy() {}, toast() {}, state: {},
  });
  await sync();
  assert.equal(writes, 0);
});

test("incompatible save requires confirmation before replacing the inspected cloud revision", async () => {
  const inspection = { found: true, revision: 7, updatedAt: "2026-09-20T00:00:00Z", state: { version: 99 } };
  const writes = [];
  let approve = false;
  const prompts = [];
  const client = {
    getAutoSyncReason: () => "incompatible",
    inspectRemoteSave: async () => inspection,
    overwriteRemote: async (nextState, checked) => { writes.push({ nextState, checked }); },
    save: async () => assert.fail("ordinary manual save bypassed recovery"),
  };
  const state = { gold: 123 };
  const sync = gameFunction("syncCloudNow", "importCloudSave", {
    cloudHydrationPending: false, inspectedCloudReadable: false, state,
    window: { TianxiaCloudSave: client, confirm: prompt => { prompts.push(prompt); return approve; } },
    setCloudControlsBusy() {}, updateCloudStatus() {}, normalizeLoadedState: () => null, toast() {}, Date,
  });
  await sync();
  assert.equal(writes.length, 0);
  assert.match(prompts[0], /替换这份云端存档/);
  approve = true;
  await sync();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].nextState, state);
  assert.equal(writes[0].checked, inspection);
});

test("recovery accurately identifies a newly readable remote before asking to replace it", async () => {
  const inspection = { found: true, revision: 8, updatedAt: null, state: { version: 5 } };
  let prompt;
  const sync = gameFunction("syncCloudNow", "importCloudSave", {
    cloudHydrationPending: false, inspectedCloudReadable: false, state: {},
    window: {
      TianxiaCloudSave: {
        getAutoSyncReason: () => "incompatible",
        inspectRemoteSave: async () => inspection,
        overwriteRemote: async () => assert.fail("cancelled recovery must preserve remote"),
      },
      confirm: message => { prompt = message; return false; },
    },
    setCloudControlsBusy() {}, updateCloudStatus() {}, normalizeLoadedState: () => ({}), toast() {}, Date,
  });
  await sync();
  assert.match(prompt, /现在可以读取/);
  assert.doesNotMatch(prompt, /与当前版本不兼容/);
});

test("cloud import waits for pending writes and pauses the clock until the new code loads", async () => {
  let finishPending;
  let finishLoad;
  let codeSwitches = 0;
  const intervals = [];
  const inputs = { importCloudCode: { value: "new-code" }, cloudCode: { value: "old-code" } };
  const client = {
    normalizeAccessCode: value => value,
    ensureAccessCode: () => "old-code",
    setAccessCode: () => { codeSwitches += 1; return { code: "old-code" }; },
    waitForPendingSaves: () => new Promise(resolve => { finishPending = resolve; }),
    load: () => new Promise(resolve => { finishLoad = resolve; }),
    save: async () => {},
  };
  const importStart = source.indexOf("  async function importCloudSave(");
  const importEnd = source.indexOf("  async function deleteCloudSave(", importStart);
  const clockStart = source.indexOf("  function restartStrategicClock(");
  const clockEnd = source.indexOf("  function growEnemies(", clockStart);
  const sandbox = vm.createContext({
    cloudHydrationPending: false, strategicTimer: null,
    state: { started: true, speed: 4 },
    window: {
      TianxiaCloudSave: client,
      setInterval(callback, delay) { intervals.push({ callback, delay }); return intervals.length; },
      clearInterval() {},
      clearTimeout() {},
    },
    $: id => inputs[id], setCloudControlsBusy() {}, updateHeader() {}, toast() {}, advanceDay() {},
    cloudSaveTimer: 0,
  });
  vm.runInContext(source.slice(importStart, importEnd) + source.slice(clockStart, clockEnd), sandbox);
  sandbox.restartStrategicClock();
  assert.equal(intervals.length, 1);
  const importing = sandbox.importCloudSave();
  assert.equal(sandbox.cloudHydrationPending, true);
  assert.equal(sandbox.strategicTimer, null);
  assert.equal(codeSwitches, 0);
  sandbox.restartStrategicClock();
  assert.equal(intervals.length, 1);
  finishPending();
  await new Promise(setImmediate);
  assert.equal(codeSwitches, 1);
  finishLoad({ found: false });
  await importing;
  assert.equal(sandbox.cloudHydrationPending, false);
  assert.equal(intervals.length, 2);
});

test("failed cloud import restores the prior access code and sync metadata", async () => {
  const previous = { code: "old-code", meta: '{"dirty":true,"revision":3}', status: { state: "offline" } };
  const restored = [];
  let activeCode = previous.code;
  const inputs = { importCloudCode: { value: "new-code" }, cloudCode: { value: "old-code" } };
  const client = {
    normalizeAccessCode: value => value,
    ensureAccessCode: () => previous.code,
    setAccessCode: code => { activeCode = code; return previous; },
    waitForPendingSaves: async () => {},
    getAccessCode: () => activeCode,
    restoreAccessCode: snapshot => { restored.push(snapshot); activeCode = snapshot.code; },
    load: async () => ({ offline: true }),
  };
  const importSave = gameFunction("importCloudSave", "deleteCloudSave", {
    window: { TianxiaCloudSave: client, clearTimeout() {} },
    cloudHydrationPending: false,
    restartStrategicClock() {},
    updateHeader() {}, cloudSaveTimer: 0,
    $: id => inputs[id],
    setCloudControlsBusy() {},
    toast() {},
  });
  await importSave();
  assert.deepEqual(restored, [previous]);
  assert.equal(inputs.cloudCode.value, previous.code);
});

test("importing the current code cannot discard an unsynced local save", async () => {
  const previous = { code: "same-code", meta: '{"dirty":true,"revision":3}', status: { state: "ready" } };
  const restored = [];
  const inputs = { importCloudCode: { value: "same-code" }, cloudCode: { value: "same-code" } };
  const client = {
    normalizeAccessCode: value => value,
    ensureAccessCode: () => previous.code,
    setAccessCode: () => previous,
    waitForPendingSaves: async () => {},
    getAccessCode: () => previous.code,
    restoreAccessCode: snapshot => restored.push(snapshot),
    load: async () => ({ found: true, localDirty: true, conflict: false, state: { gold: 200 } }),
  };
  const importSave = gameFunction("importCloudSave", "deleteCloudSave", {
    window: { TianxiaCloudSave: client, clearTimeout() {} },
    cloudHydrationPending: false,
    restartStrategicClock() {},
    updateHeader() {}, cloudSaveTimer: 0,
    $: id => inputs[id],
    setCloudControlsBusy() {},
    applyRemoteSave: async () => assert.fail("unsynced local state must not be replaced"),
    toast() {},
  });
  await importSave();
  assert.deepEqual(restored, [previous]);
});
