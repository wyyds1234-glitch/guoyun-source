import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [game, regions, mapEngine, factions, html, styles] = await Promise.all([
  readFile(new URL("../public/game.js", import.meta.url), "utf8"),
  readFile(new URL("../public/regions.js", import.meta.url), "utf8"),
  readFile(new URL("../public/geo-map.js", import.meta.url), "utf8"),
  readFile(new URL("../public/data/eurasia-factions-741.js", import.meta.url), "utf8"),
  readFile(new URL("../public/play/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
]);

test("742-era historical UI no longer uses the Shence Army or a new-emperor opening", () => {
  assert.match(game, /name: "羽林第一军"/);
  assert.doesNotMatch(game, /name: "神策第一军"/);
  assert.doesNotMatch(game, /text:\s*["`].*(?:奉新主即位|王业自长安始)/);
  assert.match(game, /characterMode === "historical"/);
  assert.match(game, /架空推演：.*不代表公元741年的真实历史/);
  assert.match(game, /if \(isPlayerEmperor\(\)\) return "天子临御"/);
  assert.match(html, /唐玄宗已在位近三十年/);
  assert.doesNotMatch(html, /请自长安起兵|成就一统之业/);
  assert.doesNotMatch(html, /偏安之主|神策第一军/);
});

test("historical resource labels consistently use guan and frontier placenames avoid obsolete Han labels", () => {
  assert.doesNotMatch(game, /fmt\(cost\.gold\) 金|income\.gold\) 金/);
  assert.doesNotMatch(html, /resource-icon">铢|[0-9]+ 金 ·/);
  assert.match(html, /resource-icon">贯/);
  assert.match(regions, /gaogouli", "辽东边地"/);
  assert.match(regions, /chaoxian", "大同江流域"/);
  assert.match(regions, /chaoxian[^\n]*"city"/);
  assert.match(regions, /xijuan[^\n]*"city"/);
  assert.doesNotMatch(factions, /name: "拜占庭帝国"/);
  assert.match(factions, /name: "东罗马帝国"/);
  for (const id of ["hexi", "anxi", "beiting", "kucha", "khotan"]) {
    assert.match(factions, new RegExp(`id: "${id}"[^\\n]*displayOnMap: false`));
  }
});

test("army selection clear returns the detail pane to the selected region and legacy names stay consistent", () => {
  const clearHandler = game.slice(game.indexOf('$("cancelArmySelection").addEventListener'), game.indexOf('$("selectAllArmies")'));
  assert.match(clearHandler, /selectedArmyIds = \[\]/);
  assert.match(clearHandler, /selectedMapObjectType = "region"/);
  assert.match(clearHandler, /renderProvinceCard\(\)/);
  assert.match(game, /已选：\$\{armyDisplayName\(selected\[0\]\)\}/);
  assert.match(game, /当前征募对象：\$\{armyDisplayName\(recruitTarget\)\}/);
});

test("compact map layout keeps the map in the viewport and moves the right rail to a drawer", () => {
  const compactLayout = styles.slice(styles.indexOf("@media (max-width: 940px)"));
  assert.match(compactLayout, /grid-template-columns: 66px minmax\(0, 1fr\)/);
  assert.match(compactLayout, /\.stage \{ grid-column: 2; grid-row: 1/);
  assert.match(compactLayout, /\.right-rail \{\s*position: fixed/);
  assert.doesNotMatch(compactLayout, /flex-direction: column;\s*overflow: auto/);
  const compactOverride = styles.slice(styles.lastIndexOf("/* Re-assert the compact two-column layout"));
  assert.match(compactOverride, /body\.panels-left-collapsed \.game-shell[\s\S]*?grid-template-columns: 40px minmax\(0, 1fr\) !important/);
  assert.doesNotMatch(compactOverride, /grid-template-columns:[^;]*370px/);
});

test("a transient failed map fetch gets one cache-busting retry using the current map version", async () => {
  const source = mapEngine.slice(mapEngine.indexOf("  function mapAssetVersion("), mapEngine.indexOf("  async function loadOptionalMapAsset("));
  const calls = [];
  const context = vm.createContext({
    MAP_DATA_VERSION: "test-map-v9",
    window: { TIANXIA_VERSION: { MAP_VERSION: "test-map-v9" }, setTimeout: (callback) => callback() },
    diagnostics: { geoJsonFetches: 0 },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) throw new TypeError("Failed to fetch");
      return { ok: true, json: async () => ({ type: "FeatureCollection", features: [] }) };
    },
  });
  vm.runInContext(source, context);
  const result = await vm.runInContext('loadMapAsset("strategy-regions.geojson")', context);
  assert.equal(result.type, "FeatureCollection");
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /v=test-map-v9/);
  assert.equal(calls[0].options.cache, "default");
  assert.equal(calls[1].options.cache, "reload");
  assert.equal(context.diagnostics.geoJsonFetches, 2);
});

test("missing tactical polygons degrade to the available map instead of aborting initialization", () => {
  const start = mapEngine.indexOf("  function normalizeStrategicFeatures(");
  const end = mapEngine.indexOf("  function planarRingArea(", start);
  const context = vm.createContext({
    regionList: [{ id: "available", name: "甲", province: "jingji", admin: "京兆府" }, { id: "missing", name: "乙", province: "jingji", admin: "京兆府" }],
    window: { TianxiaMap: {} },
    rewindStrategicGeometry: (geometry) => geometry,
    geometryBounds: () => [0, 0, 1, 1],
    console: { error() {} },
  });
  vm.runInContext(`${mapEngine.slice(start, end)}; this.normalizeStrategicFeatures = normalizeStrategicFeatures;`, context);
  const result = context.normalizeStrategicFeatures({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: { region_id: "available" } }],
  });
  assert.deepEqual(Array.from(result, (feature) => feature.properties.region_id), ["available"]);
  assert.deepEqual(Array.from(context.window.TianxiaMap.degradedRegions), ["missing"]);
});
