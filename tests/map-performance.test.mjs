import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, homeHtml, mapEngine, game, perfHarness, pwa, regionsRuntime, styles, strategicRegions, strategicProvinces, adjacencyData, tangMapModel, tangMapModelRuntime, sources, mapVerifier] = await Promise.all([
  readFile(new URL("../public/play/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/geo-map.js", import.meta.url), "utf8"),
  readFile(new URL("../public/game.js", import.meta.url), "utf8"),
  readFile(new URL("../public/perf-harness.js", import.meta.url), "utf8"),
  readFile(new URL("../public/pwa.js", import.meta.url), "utf8"),
  readFile(new URL("../public/regions.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../public/data/strategy-regions.geojson", import.meta.url), "utf8"),
  readFile(new URL("../public/data/strategy-provinces.geojson", import.meta.url), "utf8"),
  readFile(new URL("../public/data/strategy-adjacency.json", import.meta.url), "utf8"),
  readFile(new URL("../public/data/tang-map-model.json", import.meta.url), "utf8"),
  readFile(new URL("../public/data/tang-map-model.js", import.meta.url), "utf8"),
  readFile(new URL("../public/data/SOURCES.md", import.meta.url), "utf8"),
  readFile(new URL("../scripts/verify-production-map.mjs", import.meta.url), "utf8"),
]);
const eurasiaFactions = await readFile(new URL("../public/data/eurasia-factions-741.js", import.meta.url), "utf8");
const homeCss = await readFile(new URL("../public/home.css", import.meta.url), "utf8");

test("keeps the light home route separate from the game route", async () => {
  assert.match(homeHtml, /国运 · 中国古代 · 角色扮演大战略/);
  assert.match(homeHtml, /href="\/play\/"/);
  assert.match(homeHtml, /href="\/download\/"/);
  assert.doesNotMatch(homeHtml, /id="mapPhysicalCanvas"|geo-map\.js|game\.js|云端存档/);
  assert.match(homeHtml, /天下不是固定的版图/);
  assert.match(homeHtml, /统一王朝/);
  assert.doesNotMatch(homeHtml, /home-map-preview|home-world-preview|atlas-hero|world-preview/);
  assert.doesNotMatch(homeHtml, /atlas-coast|atlas-river|atlas-stamp|山河<br/);
  const downloadHtml = await readFile(new URL("../public/download/index.html", import.meta.url), "utf8");
  assert.match(downloadHtml, /Tauri 2/);
  assert.match(downloadHtml, /Windows/);
  assert.match(downloadHtml, /macOS/);
});

test("keeps the homepage dependency surface small and internally consistent", () => {
  const ids = [...homeHtml.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "homepage must not contain duplicate DOM ids");
  assert.match(homeHtml, /home\.css\?v=home-audit-20260919-1/);
  assert.match(homeHtml, /fonts\.googleapis\.com/);
  assert.doesNotMatch(homeHtml, /@import/);
  assert.doesNotMatch(homeCss, /@import\s+url\("https:\/\/fonts\.googleapis\.com/);
  assert.match(homeHtml, /href="\/play\/">游玩网页版/);
  assert.doesNotMatch(homeHtml, /<script(?![^>]+application\/ld\+json)/i);
  assert.doesNotMatch(homeHtml, /(?:game\.js|geo-map\.js|cloud-save\.js|d3\.v7|regions\.js)/i);
  assert.match(homeHtml, /href="\/#world"|href="#world"/);
  assert.match(homeHtml, /href="#features"/);
  assert.match(homeHtml, /href="\/download\/"/);
  assert.match(homeHtml, /href="\/play\/"/);
});

test("keeps the shipped markup and runtime free of accidental duplicates", () => {
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "play page must not contain duplicate DOM ids");
  for (const source of [game, mapEngine]) {
    const names = [...source.matchAll(/^\s{2}function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((match) => match[1]);
    const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
    assert.deepEqual(duplicates, [], "runtime must not redeclare a top-level function");
  }
  assert.doesNotMatch(styles, /\.paper-noise\s*\{/);
});

test("provides persistent collapsible map-side panels", () => {
  assert.match(html, /id="toggleLeftPanel"/);
  assert.match(html, /id="toggleRightPanel"/);
  assert.match(html, /id="toggleAllPanels"/);
  assert.match(html, /data-right-tab="region"/);
  assert.match(html, /data-right-tab="army"/);
  assert.match(html, /data-right-tab="operation"/);
  assert.match(html, /data-right-tab="war"/);
  assert.doesNotMatch(html, /id="toggleBattlePlan"/);
  assert.match(game, /PANEL_STATE_KEY = "guoyun-ui-panel-state-v1"/);
  assert.match(game, /function applyPanelLayout/);
  assert.match(game, /function setRightSidebarTab/);
  assert.match(game, /function mountProvinceSidebar/);
  assert.match(game, /event\.key === "Tab"/);
  assert.match(game, /setRightPanelCollapsed\(false/);
  assert.match(styles, /body\.panels-all-collapsed \.game-shell/);
  assert.match(styles, /transform: translateX\(calc\(100% - 40px\)\)/);
  assert.match(styles, /grid-template-columns: minmax\(150px, 220px\) minmax\(0, 1fr\) max-content/);
  assert.match(styles, /\.top-actions \{[\s\S]*?max-height: 62px;[\s\S]*?white-space: nowrap;/);
  assert.match(styles, /\.pwa-update-banner \{[\s\S]*?left: 50%;[\s\S]*?top: 72px;[\s\S]*?pointer-events: none;/);
  assert.match(styles, /\.pwa-update-actions button \{[^}]*pointer-events: auto;/);
});

test("keeps the map workspace at viewport height without a black lower row", () => {
  assert.match(styles, /height: 100dvh/);
  assert.match(styles, /\.game-shell \{[\s\S]*?flex: 1 1 auto;[\s\S]*?min-height: 0;/);
  assert.match(styles, /\.map-mode-bar \{[\s\S]*?position: fixed;[\s\S]*?bottom: 0;/);
  assert.match(mapEngine, /new ResizeObserver\(queueCanvasLayout\)/);
  assert.match(mapEngine, /closest\("\.map-and-detail"\)/);
  assert.match(mapEngine, /closest\("\.stage"\)/);
});

test("keeps persistent world, UI, and physical map layers", () => {
  assert.match(html, /id="mapPhysicalCanvas"/);
  assert.match(html, /id="mapWorld"/);
  assert.match(html, /id="mapUi"/);
  assert.match(html, /id="regionBorderLayer"/);
  assert.match(html, /id="movementPathLayer"/);
  assert.match(html, /id="movementMarkerLayer"/);
  assert.match(html, /id="provinceLabelLayer"[\s\S]*id="mapUi"|id="mapUi"[\s\S]*id="provinceLabelLayer"/);
  assert.doesNotMatch(html, /id="mapViewport"/);
  assert.doesNotMatch(html, /id="roughEdge"/);
});

test("versions strategic GeoJSON with the shared map version and tolerates optional layer failures", () => {
  assert.match(mapEngine, /window\.TIANXIA_VERSION\?\.MAP_VERSION \|\| "tang741-v2"/);
  assert.match(mapEngine, /function loadOptionalMapAsset/);
  assert.match(mapEngine, /loadOptionalMapAsset\("natural-earth-rivers\.geojson"/);
  assert.match(mapEngine, /loadOptionalMapAsset\("strategy-provinces\.geojson"\)/);
  assert.doesNotMatch(mapEngine, /strategy-regions\.geojson[^\n]*tang741-v1/);
});

test("does not inject cloud-save army or war text through innerHTML", () => {
  assert.doesNotMatch(game, /button\.innerHTML = `<span class="army-flag">/);
  assert.doesNotMatch(game, /node\.innerHTML = `<b>\$\{entry\.title\}/);
  assert.match(game, /title\.textContent = String\(armyDisplayName\(army\)\)/);
  assert.match(game, /text\.textContent = String\(entry\.text/);
});

test("coalesces zoom transforms and saves only after zoom end", () => {
  assert.match(mapEngine, /const MIN_ZOOM = 0\.65/);
  assert.match(mapEngine, /const MAX_ZOOM = 48/);
  assert.match(mapEngine, /const INITIAL_ZOOM = 3\.5/);
  assert.match(mapEngine, /SCENARIO_INITIAL_VIEW = Object\.freeze\(\[\[82, 18\], \[145, 51\]\]\)/);
  assert.match(mapEngine, /\.wheelDelta\(\(event\) =>/);
  assert.match(mapEngine, /world: \{ min: MIN_ZOOM, max: 2\.0/);
  assert.match(mapEngine, /ultra: \{ min: 28, max: MAX_ZOOM/);
  assert.match(mapEngine, /requestAnimationFrame\(applyPendingTransform\)/);
  assert.match(mapEngine, /worldViewport\.attr\("transform", value\)/);
  assert.doesNotMatch(mapEngine, /uiViewport\.attr\("transform", value\)/);
  assert.match(mapEngine, /syncScreenSpaceNodes\(transform\)/);
  assert.match(mapEngine, /function screenSpaceTransform/);
  assert.match(mapEngine, /function registerScreenSpace/);
  assert.match(mapEngine, /setTimeout\(saveViewport, 1000\)/);
});

test("keeps labels, armies, and selection styling in screen space", () => {
  assert.match(mapEngine, /#mapUi \.map-label-candidate/);
  assert.match(mapEngine, /function resolveLabelCollisions/);
  assert.match(game, /screenSpaceNode\("g", \{\s*class: `strategic-region/);
  assert.match(game, /screenSpaceNode\("g", \{ class: `army-marker/);
  assert.match(game, /classList\.toggle\("selected-region-cell"/);
  assert.match(styles, /path\.selected-region-cell[\s\S]*stroke-width: 2\.4/);
  assert.match(styles, /\.map-label-candidate\.label-collided/);
  assert.match(styles, /vector-effect: non-scaling-stroke/);
  assert.doesNotMatch(game, /\$\("movementLayer"\)/);
});

test("rasterizes static geography once and leaves interaction in SVG", () => {
  assert.match(mapEngine, /function buildPhysicalRaster/);
  assert.match(mapEngine, /function clipGeometryToBounds/);
  assert.match(mapEngine, /const clippedLand = sanitizeGeographicCollection/);
  assert.match(mapEngine, /base 110m canvas owns the opaque land fill/);
  assert.match(mapEngine, /physicalRasterBuilds \+= 1/);
  assert.doesNotMatch(mapEngine, /select\("#landLayer"\)\.selectAll\("path"\)/);
  assert.match(styles, /\.map-physical-canvas\s*\{/);
});

test("keeps the ocean below transparent SVG and raster LOD layers", () => {
  assert.match(styles, /html:not\(\.perf-mode\) #mapView \.map-frame \{[\s\S]*?background-color: #879ba0;/);
  assert.match(styles, /html:not\(\.perf-mode\) #worldMap \{[\s\S]*?background-color: transparent !important;/);
  assert.match(styles, /html:not\(\.perf-mode\) #mapView \.map-physical-canvas \{[\s\S]*?background-color: transparent !important;/);
  assert.doesNotMatch(styles, /#mapView \.map-frame,\s*\nhtml:not\(\.perf-mode\) #worldMap,\s*\nhtml:not\(\.perf-mode\) #mapView \.map-physical-canvas/);
});

test("uses committed GeoJSON polygons as the interactive strategic world", () => {
  const regions = JSON.parse(strategicRegions);
  const provinces = JSON.parse(strategicProvinces);
  assert.equal(regions.type, "FeatureCollection");
  assert.equal(regions.features.length, 100);
  assert.equal(regions.metadata.sourceStatus, "modern-geometry-tang-metadata");
  assert.match(regions.metadata.sourceUrl, /geoboundaries\.org/);
  const regionIds = regions.features.map((feature) => feature.properties.region_id);
  assert.equal(new Set(regionIds).size, 100);
  assert.ok(regions.features.every((feature) => ["Polygon", "MultiPolygon"].includes(feature.geometry?.type)));
  assert.ok(regions.features.every((feature) => feature.properties.geometrySource));
  assert.ok(regions.features.every((feature) => typeof feature.properties.region_id === "string" && feature.properties.region_id.length > 0));
  const rings = [];
  const collectRings = (geometry) => {
    const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
    polygons.forEach((polygon) => polygon.forEach((ring) => rings.push(ring)));
  };
  regions.features.forEach((feature) => collectRings(feature.geometry));
  provinces.features.forEach((feature) => collectRings(feature.geometry));
  assert.ok(rings.every((ring) => ring.length >= 4 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]));
  assert.equal(provinces.type, "FeatureCollection");
  assert.equal(provinces.features.length, 15);
  assert.ok(provinces.features.every((feature) => feature.geometry?.type === "MultiPolygon"));
  assert.equal(provinces.metadata.sourceStatus, "modern-geometry-tang-metadata");
  assert.match(mapEngine, /loadCoreMapAsset\("strategy-regions\.geojson"\)/);
  assert.match(mapEngine, /loadOptionalMapAsset\("strategy-provinces\.geojson"\)/);
  assert.match(mapEngine, /window\.TIANXIA_VERSION\?\.MAP_VERSION/);
  assert.match(mapEngine, /cache: attempt === 0 \? "default" : "reload"/);
  assert.match(mapEngine, /river\/lake\/terrain\/Dao layer must not erase the usable map/);
  assert.match(mapEngine, /ensureLodAsset\("nation"\)/);
  assert.match(mapEngine, /ensureLodAsset\("tactical"\)/);
  assert.match(mapEngine, /regionSpatialIndex/);
  assert.match(mapEngine, /function normalizeStrategicFeatures\(strategyRegions\)/);
  assert.match(mapEngine, /region_id/);
  assert.doesNotMatch(mapEngine, /d3\.Delaunay|voronoi|projection\.invert/);
  assert.match(html, /id="provinceBoundaryLayer"/);
});

test("derives adjacency from shared GeoJSON boundaries", () => {
  const adjacency = JSON.parse(adjacencyData);
  const regionHash = createHash("sha256").update(strategicRegions).digest("hex");
  assert.equal(adjacency.source, "strategy-regions.geojson");
  assert.equal(adjacency.mapVersion, "tang741-v2");
  assert.equal(adjacency.sourceSha256, regionHash);
  assert.equal(adjacency.relation, "shared-polygon-boundary");
  assert.equal(adjacency.regionCount, 100);
  assert.ok(adjacency.edgeCount > 0);
  assert.ok(adjacency.edges.every((edge) => edge.type === "shared-boundary" && edge.sharedBoundaryKm > 0));
  assert.ok(adjacency.edges.every((edge) => edge.from && edge.to && Number.isFinite(edge.distance)
    && typeof edge.terrain === "string" && typeof edge.river_crossing === "boolean"
    && typeof edge.road === "boolean" && typeof edge.pass === "boolean"
    && typeof edge.port === "boolean" && typeof edge.sea_route === "boolean"
    && Number.isFinite(edge.movement_cost)));
  assert.match(html, /data\/strategy-adjacency\.js/);
  assert.match(regionsRuntime, /STRATEGY_MAP_ADJACENCY/);
  assert.doesNotMatch(regionsRuntime, /Delaunay|Voronoi|voronoi|neighbors\(index\)/);
  assert.match(mapEngine, /function buildRegionBorders\(features\)/);
  assert.match(game, /data-border-a/);
  assert.match(styles, /\.region-border\.political-border/);
  assert.match(styles, /\.region-border\.frontline-border/);
});

test("uses the versioned Tang 741 hybrid map model", () => {
  const model = JSON.parse(tangMapModel);
  assert.equal(model.modelVersion, "tang-map-model-v2");
  assert.equal(model.mapVersion, "tang741-v2");
  assert.equal(model.historyDataVersion, "tang-history-v1");
  assert.equal(model.coordinateReferenceSystem, "WGS84");
  assert.equal(model.regions.length, 100);
  assert.equal(model.daoCatalog.length, 15);
  assert.equal(model.assignmentMethod, "project-curated place grouping; all circuit assignments provisional pending CC0 Hartwell crosswalk and historical-map review");
  for (const dao of model.daoCatalog) {
    const range = model.daoRegionRanges[dao.id];
    const count = model.regions.filter((region) => region.daoId === dao.id).length;
    assert.ok(count >= range.min && count <= range.max, `${dao.name}: ${count} outside ${range.min}–${range.max}`);
  }
  assert.equal(model.daoCatalog.find((dao) => dao.id === "jiannan").shortName, "剑");
  assert.equal(model.daoCatalog.find((dao) => dao.id === "qianzhong").shortName, "黔");
  assert.ok(model.regions.find((region) => region.id === "linzi").daoId === "henan");
  assert.equal(model.regions.find((region) => region.id === "kaiyang").daoId, "henan", "琅邪/开阳不能被分到山南西道");
  const kaiyangFeature = JSON.parse(strategicRegions).features.find((feature) => feature.properties.region_id === "kaiyang");
  assert.equal(kaiyangFeature?.properties.dao_id, "henan", "地图 polygon 元数据须与唐代道归属一致");
  assert.ok(model.regions.find((region) => region.id === "liaodong").daoId !== "jiangnan_east");
  assert.equal(model.sources.historyDataCandidates[0].license, "CC0 1.0");
  assert.match(model.sources.sourceNote, /CHGIS V6\/TGAZ 数据复制进发布包/);
  assert.ok(model.regions.every((region) => region.daoAssignmentConfidence === "provisional"));
  for (const region of model.regions) {
    for (const field of ["id", "geometryId", "historicalName", "nameHistory", "daoId", "centroid", "terrain", "neighbors", "ownerId", "controllerId", "sovereignId", "population", "agriculture", "commerce", "food", "supplyCapacity", "fortification", "garrison", "unrest", "loyalty", "strategicValue", "cityIds", "roadNodeIds"]) {
      assert.ok(region[field] !== undefined, `${region.id} 缺少 ${field}`);
    }
    assert.equal(region.ownerId, "tang");
    assert.equal(region.controllerId, "tang");
  }
  assert.equal(model.cityNodes.length, 15);
  assert.equal(model.strategicPasses.length, 7);
  assert.ok(model.frontierRegions.some((frontier) => frontier.kind === "frontier_region"));
  assert.ok(model.frontierRegions.some((frontier) => frontier.kind === "protectorate_region"));
  assert.ok(model.frontierRegions.some((frontier) => frontier.kind === "military_command"));
  assert.match(tangMapModelRuntime, /window\.TANG_MAP_MODEL/);
  assert.match(regionsRuntime, /nameAtYear/);
});

test("keeps a land-clipped renderer only for source-verified foreign polygons", () => {
  assert.match(html, /data\/eurasia-factions-741\.js/);
  assert.match(eurasiaFactions, /window\.EURASIA_FACTIONS_741/);
  assert.match(eurasiaFactions, /byzantine/);
  assert.match(eurasiaFactions, /umayyad/);
  assert.match(mapEngine, /historicalPolitySource/);
  assert.match(mapEngine, /polityItems\.filter\(hasVerifiedPolityGeometry\)/);
  assert.match(mapEngine, /outer-polity-zone/);
  assert.match(mapEngine, /clip-path.*landClip|landClip.*clip-path/);
  assert.match(mapEngine, /\.attr\("d", \(feature\) => path\(feature\)\)/);
  assert.match(mapEngine, /\.attr\("data-faction-id", item\.id\)/);
  assert.doesNotMatch(mapEngine, /radius.*circle|outer-polity-zone.*circle/);
});

test("keeps production map data on an explicit public-license allowlist", () => {
  assert.match(sources, /OpenHistoricalMap/);
  assert.match(sources, /Public Domain/);
  assert.match(sources, /CC0/);
  assert.match(sources, /不能进入 `public\/data\/`/);
  assert.match(sources, /历史拼接规则/);
  assert.match(sources, /sourceStatus/);
  assert.match(mapVerifier, /const publicLicense = \/\^\(public domain\|cc0/);
  assert.match(mapVerifier, /不是公开可再分发许可/);
  assert.match(mapVerifier, /tang-map-model\.json/);
  assert.match(mapVerifier, /geometryId/);
});

test("keeps owner and controller as explicit map state fields", () => {
  assert.match(game, /ownerId: province\.owner/);
  assert.match(game, /controllerId: province\.owner/);
  assert.match(game, /function normalizeRegionControl\(region\)/);
  assert.match(game, /function setRegionControl\(region, controllerId/);
  assert.match(game, /regionController\(region\)/);
  assert.match(game, /setRegionControl\(region, "player"\)/);
  assert.match(game, /setRegionControl\(region, campaign\.owner\)/);
});

test("keeps the atlas treatment dynamic and layered", () => {
  assert.doesNotMatch(html, /<image\b/i);
  assert.match(styles, /古代中国历史舆图/);
  assert.match(styles, /\.province-boundary/);
  assert.match(styles, /political-frontier-cell/);
  assert.match(styles, /\.army-marker \.flag-pole/);
  assert.match(styles, /data-zoom-level="world"/);
  assert.match(game, /marker\.style\.setProperty\("--army-color"/);
  assert.match(game, /state\.mapMode === "military"/);
});

test("does not rebuild static strategy nodes during realtime ticks", () => {
  assert.match(game, /if \(!strategicRoutesBuilt\)/);
  assert.doesNotMatch(game, /routeLayer\.replaceChildren\(\)/);
  assert.match(game, /function renderRealtime\(\)/);
  const realtimeBody = game.match(/function renderRealtime\(\) \{([\s\S]*?)\n  \}/)?.[1] || "";
  assert.doesNotMatch(realtimeBody, /renderMap\(\)/);
  assert.match(realtimeBody, /TianxiaMap\?\.isInteracting/);
  assert.match(realtimeBody, /saveState\(\{ realtime: true \}\)/);
  assert.match(game, /else \{\s*renderRealtime\(\);\s*\}/);
  const interactionEndBody = game.match(/addEventListener\("tianxia-map-interaction-end", \(\) => \{([\s\S]*?)\n  \}\)/)?.[1] || "";
  assert.doesNotMatch(interactionEndBody, /saveState\(\)/);
  assert.doesNotMatch(interactionEndBody, /renderMap\(\)/);
  assert.match(game, /state\.logs = state\.logs\.slice\(0, 50\)/);
});

test("provides an isolated performance profiling mode", () => {
  assert.match(html, /perf-harness\.js/);
  assert.match(mapEngine, /const PERF_LEVEL = Math\.max\(0, Math\.min\(8/);
  assert.match(game, /const PERF_LEVEL = Math\.max\(0, Math\.min\(8/);
  assert.match(game, /if \(PERF_LEVEL > 0\)[\s\S]*?return;/);
  assert.match(perfHarness, /document\.body\.replaceChildren\(root\)/);
  assert.match(perfHarness, /requestAnimationFrame\(tick\)/);
  assert.match(perfHarness, /data-perf-metric/);
  assert.match(perfHarness, /perf-layer-toggle/);
  assert.match(perfHarness, /map layer updates/);
  assert.match(pwa, /if \(perfLevel > 0\) return/);
  assert.match(styles, /\.map-performance-harness/);
});

test("keeps initial UI data and time units internally consistent", () => {
  assert.match(html, /id="totalArmyValue">800</);
  assert.match(html, /id="armyStatus">2 个军团</);
  assert.match(html, /id="createArmyButton"/);
  assert.match(game, /function createNewArmy()/);
  assert.match(game, /nextArmyNumber/);
  assert.doesNotMatch(html, /\/季/);
  assert.match(html, /<small>时序推演 ·<\/small><strong>推进一个月<\/strong>/);
});

test("uses the Tang 741 scenario consistently", () => {
  assert.match(html, /唐开元二十九年/);
  assert.match(html, /国运唐代开元二十九年天下舆图/);
  assert.match(html, /关内道 &gt; 京兆府 &gt; 长安/);
  assert.match(game, /道 · \$\{daoName\} > 州府 ·/);
  assert.match(html, /唐 · 十五道 · 公元741年/);
  assert.doesNotMatch(html, /Natural Earth（公版）/);
  assert.match(game, /id: "tang"/);
  assert.match(game, /calendar: \{ year: ERA\.year, month: 1, day: 1 \}/);
  assert.match(game, /selectedRegionId = "changan"/);
  assert.match(mapEngine, /label\.append\("text"\)\.text\("唐"\)/);
});

test("uses explicit cloud sync states", () => {
  assert.match(game, /云端已同步/);
  assert.match(game, /同步中 · 云端/);
  assert.match(game, /离线 · 仅本地缓存/);
});

test("replaces stale saved adjacency with the current map topology", () => {
  assert.match(game, /neighbors: regionDefaults\[id\]\.neighbors\.map/);
  assert.match(game, /function regionNeighbors\(/);
  assert.match(game, /\.filter\(\(neighbor\) => neighbor\?\.id && state\.regions\[neighbor\.id\]\)/);
});

test("keeps map object selection independent and delegates region clicks", () => {
  assert.match(mapEngine, /\.attr\("id", \(feature\) => `region-\$\{feature\.properties\.id\}`\)/);
  assert.match(mapEngine, /\.attr\("data-region-cell", \(feature\) => feature\.properties\.id\)/);
  assert.match(mapEngine, /\.attr\("data-map-object", "region"\)/);
  assert.match(game, /let selectedRegionId = "changan"/);
  assert.match(game, /let selectedArmyIds = \[\]/);
  assert.match(game, /let selectedMapObjectType = "region"/);
  assert.match(game, /function bindTerritoryEvents\(\)/);
  assert.match(game, /layer\.addEventListener\("pointermove"/);
  assert.match(game, /layer\.addEventListener\("pointerup"/);
  assert.match(game, /layer\.addEventListener\("click"/);
  assert.match(game, /classList\.add\("hover-region-cell"/);
  assert.match(game, /prepareRegionOrder\(id\)/);
  assert.match(game, /cell\.dataset\.regionOwner = regionOwner/);
  assert.match(game, /political-frontier-cell/);
  assert.match(game, /confirmRegionOrder[\s\S]*?issueRegionOrder/);
  assert.doesNotMatch(game.match(/function bindTerritoryEvents\(\) \{[\s\S]*?\n  \}/)?.[0] || "", /issueRegionOrder\(/);
  assert.match(html, /id="battlePlanPanel"/);
  assert.match(html, /id="battlePlanList"/);
  assert.doesNotMatch(html, /id="mapContextAction"/);
  assert.match(html, /id="adjacencyList"/);
  assert.match(html, /id="orderHintArmy"/);
  assert.match(styles, /path\.selected-region-cell[\s\S]*vector-effect: non-scaling-stroke/);
  assert.match(styles, /\.territory > path:focus,\s*\.strategic-region:focus,\s*\.army-marker:focus \{ outline: none; \}/);
  assert.match(mapEngine, /function anchorDistanceSquared\(lonLat, regionId\)/);
  assert.match(mapEngine, /const uniqueMatches =/);
  assert.match(game, /const canonicalCell = window\.TianxiaMap\?\.regionAtClientPoint/);
});

test("keeps audit-critical command, role, and save paths on current state", () => {
  assert.match(game, /function primarySelectedArmy\(\)/);
  assert.match(game, /selectedArmyIds\.includes\(armyId\)/);
  assert.doesNotMatch(game, /selectedArmyIds\.(has|size|clear|delete|add)\(/);
  assert.doesNotMatch(game, /\bselectedArmyId\b/);
  assert.doesNotMatch(game, /state\.armies\[selectedArmyId\]/);
  assert.match(game, /scenarioType === "historicalScenario"/);
  assert.match(game, /const roleLabel = playerRoleLabel\(\)/);
  assert.match(game, /parsed\.scenarioType === "alternateHistory"/);
  assert.match(game, /parsed\.kingdom && parsed\.kingdom !== "大唐"/);
  assert.match(game, /const preservedProgress = order\.movementProgress/);
  assert.match(game, /if \(note\) note\.dataset\.cloudState = stateName/);
  assert.doesNotMatch(game, /note\.dataset\.cloudState = stateName;\n    note\.dataset/);
  assert.match(game, /function stopArmyOrder\(armyId, \{ render: shouldRender = true \} = \{\}\)/);
  assert.match(game, /stopArmyOrder\(army\.id, \{ render: false \}\)/);
});
