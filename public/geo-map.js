(() => {
  "use strict";

  const WIDTH = 1200;
  const HEIGHT = 760;
  const RASTER_SCALE = 2;
  // Keep one zoom contract for wheel, touchpad, buttons and camera presets.
  // Markers/labels live in the screen-space layer, so increasing this range
  // never makes UI glyphs grow with the geographic layer.
  const MIN_ZOOM = 0.65;
  // The strategic map remains the same persistent SVG/canvas scene at every
  // scale.  A wider range lets players move from the world view down to a
  // city/army view without rebuilding geography or changing marker sizing.
  const MAX_ZOOM = 48;
  const INITIAL_ZOOM = 3.5;
  // v6 deliberately invalidates the old camera.  The previous projection was
  // fitted to a spherical Polygon, which made d3-geo treat the bounds as a
  // large geodesic shape and pushed the useful land mass toward the bottom of
  // the viewport.
  // v8 resets the previous 2.8× camera once so existing players open on the
  // requested 大唐 core view rather than carrying an old world-scale viewport.
  const VIEW_KEY = "tianxia-geographic-viewport-v8";
  const PERF_LEVEL = Math.max(0, Math.min(8, Number(new URLSearchParams(window.location.search).get("perf") || 0) || 0));
  const PERFORMANCE_MODE = PERF_LEVEL > 0;
  const DEBUG_LAYERS_ENABLED = new URLSearchParams(window.location.search).get("debugLayers") === "1";
  const MAP_DATA_VERSION = window.TIANXIA_VERSION?.MAP_VERSION || window.TANG_MAP_MODEL?.mapVersion || "tang741-v2";
  const emptyFeatureCollection = () => ({ type: "FeatureCollection", features: [] });
  document.documentElement.classList.toggle("perf-mode", PERFORMANCE_MODE);
  const svg = d3.select("#worldMap");
  const physicalCanvas = document.querySelector("#mapPhysicalCanvas");
  const midCanvas = document.querySelector("#mapMidCanvas");
  const detailCanvas = document.querySelector("#mapDetailCanvas");
  const physicalCanvases = [physicalCanvas, midCanvas, detailCanvas].filter(Boolean);
  const worldViewport = svg.select("#mapWorld");
  const uiViewport = svg.select("#mapUi");
  const viewport = worldViewport;
  const regions = window.STRATEGY_MAP_DATA.regions;
  const regionList = Object.values(regions);
  const regionMetaById = new Map((window.TANG_MAP_MODEL?.regions || []).map((region) => [region.id, region]));
  // Keep the dataset extent and the camera extent separate.  The world extent
  // is only used to establish one stable WGS84 projection; scenario cameras
  // below decide what the player sees at startup.
  const WORLD_BOUNDS = Object.freeze([[-20, 10], [150, 65]]);
  const SCENARIO_INITIAL_VIEW = Object.freeze([[82, 18], [145, 51]]);
  const SCENARIO_EAST_ASIA_VIEW = Object.freeze([[55, 15], [150, 58]]);
  const WORLD_CAMERA_VIEW = Object.freeze([[-20, 10], [150, 65]]);
  const boundsCornerCollection = (bounds) => ({
    type: "FeatureCollection",
    features: [
      [bounds[0][0], bounds[0][1]],
      [bounds[0][0], bounds[1][1]],
      [bounds[1][0], bounds[0][1]],
      [bounds[1][0], bounds[1][1]],
    ].map((coordinates) => ({ type: "Feature", geometry: { type: "Point", coordinates } })),
  });
  const projection = d3.geoMercator()
    // Fitting four geographic corner points avoids the spherical-ring
    // ambiguity of a huge Polygon while keeping a single reusable projection.
    .fitExtent([[24, 22], [WIDTH - 24, HEIGHT - 22]], boundsCornerCollection(WORLD_BOUNDS))
    .clipExtent([[0, 0], [WIDTH, HEIGHT]]);
  const path = d3.geoPath(projection);
  const regionPointCache = new Map(regionList.map((region) => [region.id, projection([region.lon, region.lat])]));
  const provincePointCache = new Map();
  // Keep the canonical geographic features available for pointer hit-testing.
  // SVG paths may be clipped to the viewport and their bounding boxes are not
  // reliable hit targets (especially after zooming).  Hit-testing therefore
  // always uses the original Polygon/MultiPolygon geometry in lon/lat space.
  let interactiveRegionFeatures = [];
  let interactiveRegionHitCache = [];
  const regionSpatialIndex = new Map();
  const HIT_GRID_COLUMNS = 24;
  const HIT_GRID_ROWS = 16;
  const MAP_BOUNDS = [WORLD_BOUNDS[0][0], WORLD_BOUNDS[0][1], WORLD_BOUNDS[1][0], WORLD_BOUNDS[1][1]];
  const MapLODConfig = Object.freeze({
    // These labels describe the Tang strategic camera, not a modern
    // cartographic scale.  Geometry remains WGS84, while the player's mental
    // model is always 唐代：天下 → 诸道 → 京畿/战区 → 州府 → 城下。
    world: { min: MIN_ZOOM, max: 2.0, label: "天下" },
    nation: { min: 2.0, max: 4.0, label: "大唐" },
    region: { min: 4.0, max: 7.0, label: "道域" },
    district: { min: 7.0, max: 10, label: "州郡" },
    tactical: { min: 10, max: 16, label: "战区" },
    urban: { min: 16, max: 28, label: "军阵" },
    ultra: { min: 28, max: MAX_ZOOM, label: "城下" },
  });
  let currentTransform = d3.zoomIdentity;
  let pendingTransform = currentTransform;
  let transformFrame = 0;
  let currentZoomTier = "";
  let isInteracting = false;
  let saveTimer = 0;
  let canvasDisplayScale = 1;
  let canvasDisplayScaleX = 1;
  let canvasDisplayScaleY = 1;
  let resizeFrame = 0;
  let labelCollisionFrame = 0;
  let cameraPresetIndex = 0;
  const lodLoads = new Map();
  const screenSpaceNodes = new Set();
  const diagnostics = {
    geoJsonFetches: 0,
    geometryBuilds: 0,
    zoomEvents: 0,
    transformFrames: 0,
    invalidTransforms: 0,
    lodChanges: 0,
    viewportSaves: 0,
    physicalRasterBuilds: 0,
    midRasterBuilds: 0,
    highRasterBuilds: 0,
    detailRasterBuilds: 0,
    clipVertices: 0,
    screenSpaceFrames: 0,
    collisionPasses: 0,
    collidedLabels: 0,
    geometryBounds: null,
    filteredGeometryFeatures: 0,
  };

  // The historical layer is loaded from a versioned, public-data asset.  It
  // separates context label anchors from source-verified frontier geometry.
  // A land clip alone cannot turn an invented polygon into a historical one.
  const historicalPolitySource = Array.isArray(window.EURASIA_FACTIONS_741)
    ? window.EURASIA_FACTIONS_741
    : [];

  const zoom = d3.zoom()
    .scaleExtent([MIN_ZOOM, MAX_ZOOM])
    .extent([[0, 0], [WIDTH, HEIGHT]])
    .translateExtent([[-180, -120], [WIDTH + 180, HEIGHT + 120]])
    // D3's default wheel delta is deliberately conservative for a mouse
    // wheel.  Trackpads emit smaller deltas, so use a modest multiplier while
    // retaining d3-zoom's pointer-centred interpolation and rAF coalescing.
    .wheelDelta((event) => {
      const unit = event.deltaMode === 1 ? 0.075 : event.deltaMode === 2 ? 1.5 : 0.0027;
      return -event.deltaY * unit * (event.ctrlKey ? 10 : 1);
    })
    .clickDistance(5)
    .on("start", () => {
      isInteracting = true;
      window.clearTimeout(saveTimer);
      svg.classed("map-is-interacting", true);
      document.querySelector("#mapTooltip")?.classList.add("hidden");
    })
    .on("zoom", (event) => {
      diagnostics.zoomEvents += 1;
      queueTransform(event.transform);
    })
    .on("end", (event) => {
      queueTransform(event.transform);
      isInteracting = false;
      svg.classed("map-is-interacting", false);
      commitZoomTier();
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(saveViewport, 1000);
      window.dispatchEvent(new CustomEvent("tianxia-map-interaction-end"));
    });

  svg.call(zoom).on("dblclick.zoom", null);
  svg.on("dblclick", (event) => {
    const point = d3.pointer(event, svg.node());
    if (!point.every(Number.isFinite)) return;
    const mapPoint = currentTransform.invert(point);
    const k = currentTransform.k;
    const target = k < 4 ? 4 : k <= 8 ? 8 : k <= 16 ? 16 : k <= 28 ? 28 : k <= 40 ? 40 : k;
    // At the 48× ceiling a double click is a camera-centering gesture only.
    // Lower tiers advance through 4×/8×/16×/28×/40× without changing the
    // screen-space size of markers or labels.
    focusPoint(mapPoint, target);
  });

  function isValidTransform(transform) {
    return transform
      && Number.isFinite(transform.x)
      && Number.isFinite(transform.y)
      && Number.isFinite(transform.k)
      && transform.k >= MIN_ZOOM
      && transform.k <= MAX_ZOOM;
  }

  function screenSpaceTransform(x, y, transform = currentTransform, offsetX = 0, offsetY = 0) {
    if (!isValidTransform(transform) || !Number.isFinite(x) || !Number.isFinite(y)) return "translate(0 0)";
    // SVG viewBox fitting is a second scale, independent of map zoom. Undo
    // both display axes so labels remain pixel-sized on narrow MacBooks too.
    const sx = canvasDisplayScaleX || 1;
    const sy = canvasDisplayScaleY || 1;
    return `translate(${transform.x + x * transform.k + offsetX / sx} ${transform.y + y * transform.k + offsetY / sy}) scale(${1 / sx} ${1 / sy})`;
  }

  function registerScreenSpace(node, x, y, offsetX = 0, offsetY = 0) {
    if (!node || !Number.isFinite(x) || !Number.isFinite(y)) return node;
    node.dataset.mapAnchorX = String(x);
    node.dataset.mapAnchorY = String(y);
    node.dataset.mapOffsetX = String(offsetX);
    node.dataset.mapOffsetY = String(offsetY);
    node.classList.add("screen-space-node");
    node.setAttribute("transform", screenSpaceTransform(x, y, currentTransform, offsetX, offsetY));
    screenSpaceNodes.add(node);
    return node;
  }

  function syncScreenSpaceNodes(transform = currentTransform) {
    if (PERFORMANCE_MODE && !window.TianxiaPerformanceHarness) return;
    screenSpaceNodes.forEach((node) => {
      if (!node.isConnected) {
        screenSpaceNodes.delete(node);
        return;
      }
      const x = Number(node.dataset.mapAnchorX);
      const y = Number(node.dataset.mapAnchorY);
      const offsetX = Number(node.dataset.mapOffsetX || 0);
      const offsetY = Number(node.dataset.mapOffsetY || 0);
      if (Number.isFinite(x) && Number.isFinite(y)) node.setAttribute("transform", screenSpaceTransform(x, y, transform, offsetX, offsetY));
    });
    diagnostics.screenSpaceFrames += 1;
  }

  function labelPriority(node) {
    const region = node.closest?.(".strategic-region");
    if (node.classList.contains("battle-label") || node.classList.contains("battle-marker") || node.classList.contains("battle-text")) return 145;
    if (region?.classList.contains("selected")) return 135;
    if (node.classList.contains("world-empire-label")) return 125;
    if (node.classList.contains("outer-polity-label")) return Number(node.dataset.labelPriority) || 118;
    if (region?.dataset.cityImportance === "capital") return 120;
    if (region?.dataset.cityImportance === "major") return 112;
    if (node.classList.contains("province-label")) return 100;
    if (region?.classList.contains("gate")) return 92;
    if (region?.classList.contains("port")) return 88;
    if (node.classList.contains("army-marker")) return 86;
    if (node.classList.contains("river-label-marker")) return 65;
    if (region && !region.classList.contains("farm")) return 55;
    if (node.classList.contains("mountain-label-marker")) return 40;
    if (node.classList.contains("terrain-label-marker")) return 30;
    return 20;
  }

  function rectsOverlap(a, b, padding = 3) {
    return a.left < b.right + padding
      && a.right > b.left - padding
      && a.top < b.bottom + padding
      && a.bottom > b.top - padding;
  }

  function resolveLabelCollisions() {
    labelCollisionFrame = 0;
    screenSpaceNodes.forEach((node) => { if (!node.isConnected) screenSpaceNodes.delete(node); });
    const svgNode = svg.node();
    const svgRect = svgNode?.getBoundingClientRect();
    if (!svgNode || !svgRect?.width || !svgRect?.height) return;
    const candidates = [...svgNode.querySelectorAll("#mapUi .map-label-candidate")];
    candidates.forEach((node) => node.classList.remove("label-collided"));
    const visible = candidates
      .map((node) => ({ node, rect: node.getBoundingClientRect(), priority: labelPriority(node) }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0
        && rect.right >= svgRect.left && rect.left <= svgRect.right
        && rect.bottom >= svgRect.top && rect.top <= svgRect.bottom)
      .sort((a, b) => b.priority - a.priority || a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    // Army hit targets must never disappear just because a city label wins.
    // Reserve their screen-space boxes, then hide only colliding labels.
    const occupied = [...svgNode.querySelectorAll("#mapUi .map-label-obstacle")]
      .map((node) => ({ rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0
        && rect.right >= svgRect.left && rect.left <= svgRect.right
        && rect.bottom >= svgRect.top && rect.top <= svgRect.bottom);
    let collided = 0;
    visible.forEach((candidate) => {
      if (occupied.some((placed) => rectsOverlap(candidate.rect, placed.rect))) {
        candidate.node.classList.add("label-collided");
        collided += 1;
      } else {
        occupied.push(candidate);
      }
    });
    diagnostics.collisionPasses += 1;
    diagnostics.collidedLabels = collided;
  }

  function queueLabelCollisions() {
    if (PERFORMANCE_MODE && (!window.TianxiaPerformanceHarness || !window.TianxiaPerformanceHarness.enabled?.labels)) return;
    if (!labelCollisionFrame) labelCollisionFrame = window.requestAnimationFrame(resolveLabelCollisions);
  }

  function applyCanvasTransform(transform) {
    if (!isValidTransform(transform)) return;
    const value = `translate(${transform.x * canvasDisplayScaleX}px, ${transform.y * canvasDisplayScaleY}px) scale(${transform.k})`;
    physicalCanvases.forEach((canvas) => { canvas.style.transform = value; });
  }

  function layoutPhysicalCanvas() {
    resizeFrame = 0;
    if (!physicalCanvas) return;
    const svgNode = svg.node();
    const frame = svgNode?.closest(".map-frame");
    if (!svgNode || !frame) return;
    const svgRect = svgNode.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    if (!svgRect.width || !svgRect.height) return;
    // The SVG is intentionally stretched to the actual map frame.  Keeping
    // the raster layers at the exact same box prevents a letterboxed canvas
    // from exposing a second blue/grey rectangle at the right or bottom edge.
    // Geographic paths and the canvas share the same viewBox, so the affine
    // transform remains aligned even on portrait-like desktop layouts.
    canvasDisplayScaleX = svgRect.width / WIDTH;
    canvasDisplayScaleY = svgRect.height / HEIGHT;
    canvasDisplayScale = Math.min(canvasDisplayScaleX, canvasDisplayScaleY);
    const displayWidth = svgRect.width;
    const displayHeight = svgRect.height;
    physicalCanvases.forEach((canvas) => {
      canvas.style.left = `${svgRect.left - frameRect.left}px`;
      canvas.style.top = `${svgRect.top - frameRect.top}px`;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
    });
    applyCanvasTransform(currentTransform);
    syncScreenSpaceNodes(currentTransform);
    queueLabelCollisions();
  }

  function queueCanvasLayout() {
    if (!resizeFrame) resizeFrame = window.requestAnimationFrame(layoutPhysicalCanvas);
  }

  function applyPendingTransform() {
    transformFrame = 0;
    const transform = pendingTransform;
    if (!isValidTransform(transform)) {
      diagnostics.invalidTransforms += 1;
      return;
    }
    const value = `translate(${transform.x},${transform.y}) scale(${transform.k})`;
    worldViewport.attr("transform", value);
    syncScreenSpaceNodes(transform);
    svg.style("--zoom-k", transform.k);
    applyCanvasTransform(transform);
    diagnostics.transformFrames += 1;
  }

  function queueTransform(transform) {
    if (!isValidTransform(transform)) {
      diagnostics.invalidTransforms += 1;
      return;
    }
    currentTransform = transform;
    pendingTransform = transform;
    if (!transformFrame) transformFrame = window.requestAnimationFrame(applyPendingTransform);
  }

  function saveViewport() {
    // The isolated perf harness is intentionally disposable. Never let a
    // perf=1…8 session overwrite the player's normal game camera.
    if (PERFORMANCE_MODE) return;
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ x: currentTransform.x, y: currentTransform.y, k: currentTransform.k }));
      diagnostics.viewportSaves += 1;
    } catch { /* local storage may be unavailable */ }
  }

  function restoreViewport() {
    try {
      const stored = JSON.parse(localStorage.getItem(VIEW_KEY) || "null");
      if (stored && [stored.x, stored.y, stored.k].every(Number.isFinite)
        && stored.k >= MIN_ZOOM && stored.k <= MAX_ZOOM
        && Math.abs(stored.x) < WIDTH * 8 && Math.abs(stored.y) < HEIGHT * 8) {
        const restored = d3.zoomIdentity.translate(stored.x, stored.y).scale(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, stored.k)));
        svg.call(zoom.transform, restored);
        return true;
      }
    } catch { /* ignore malformed view state */ }
    setCamera(SCENARIO_INITIAL_VIEW, { scale: INITIAL_ZOOM });
    cameraPresetIndex = 0;
    updateResetButtonLabel();
    return false;
  }

  function commitZoomTier(force = false) {
    const k = currentTransform.k;
    const tier = k < MapLODConfig.world.max
      ? "world"
      : k < MapLODConfig.nation.max
        ? "nation"
        : k < MapLODConfig.region.max
          ? "region"
          : k < MapLODConfig.district.max
            ? "district"
          : k < MapLODConfig.tactical.max
            ? "tactical"
              : k < MapLODConfig.urban.max
                ? "urban"
                : "ultra";
    if (force || tier !== currentZoomTier) {
      currentZoomTier = tier;
      svg.attr("data-zoom-level", tier);
      if (physicalCanvas) physicalCanvas.hidden = false;
      if (midCanvas) midCanvas.hidden = tier === "world" || tier === "ultra" || midCanvas.dataset.ready !== "true";
      if (detailCanvas) detailCanvas.hidden = !["district", "tactical", "urban", "ultra"].includes(tier) || detailCanvas.dataset.ready !== "true";
      diagnostics.lodChanges += 1;
      window.dispatchEvent(new CustomEvent("tianxia-map-lod-change", { detail: { tier, zoom: k } }));
    }
    if (tier !== "world") ensureLodAsset("nation");
    if (["district", "tactical", "urban", "ultra"].includes(tier)) ensureLodAsset("tactical");
    svg.style("--zoom-k", k);
    queueLabelCollisions();
    const readout = document.querySelector("#mapZoomReadout");
    const zoomText = Math.abs(k - MIN_ZOOM) < 0.005 ? MIN_ZOOM.toFixed(2) : k.toFixed(1);
    if (readout) readout.textContent = `${zoomText}× · ${MapLODConfig[tier].label}`;
  }

  function position(regionOrCoordinate) {
    if (Array.isArray(regionOrCoordinate)) return projection(regionOrCoordinate);
    const region = typeof regionOrCoordinate === "string" ? regions[regionOrCoordinate] : regionOrCoordinate;
    return regionPointCache.get(region?.id) || projection([region?.lon ?? 112.4244, region?.lat ?? 34.6586]);
  }

  function provincePosition(provinceId) {
    if (provincePointCache.has(provinceId)) return provincePointCache.get(provinceId);
    const points = regionList.filter((region) => region.province === provinceId).map(position);
    const point = [d3.mean(points, (item) => item[0]), d3.mean(points, (item) => item[1])];
    provincePointCache.set(provinceId, point);
    return point;
  }

  function isPointVisible(pointOrRegion, padding = 80, transform = currentTransform) {
    const point = Array.isArray(pointOrRegion) ? pointOrRegion : position(pointOrRegion);
    if (!point || point.length < 2 || !isValidTransform(transform)) return false;
    const x = transform.x + point[0] * transform.k;
    const y = transform.y + point[1] * transform.k;
    return x >= -padding && x <= WIDTH + padding && y >= -padding && y <= HEIGHT + padding;
  }

  function focusPoint(point, scale = 5) {
    const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
    const transform = d3.zoomIdentity.translate(WIDTH / 2, HEIGHT / 2).scale(k).translate(-point[0], -point[1]);
    svg.transition().duration(420).ease(d3.easeCubicOut).call(zoom.transform, transform);
  }

  function focusRegion(regionId) {
    const region = regions[regionId];
    if (region) focusPoint(position(region), Math.max(4.5, currentTransform.k));
  }

  function doubleClickRegion(regionId) {
    const region = regions[regionId];
    if (!region) return;
    const k = currentTransform.k;
    focusPoint(position(region), k < 4 ? 4 : k <= 8 ? 8 : k <= 16 ? 16 : k <= 28 ? 28 : k <= 40 ? 40 : k);
  }

  function focusProvince(provinceId) {
    const points = regionList.filter((region) => region.province === provinceId).map(position);
    if (!points.length) return;
    const xExtent = d3.extent(points, (point) => point[0]);
    const yExtent = d3.extent(points, (point) => point[1]);
    const dx = Math.max(42, xExtent[1] - xExtent[0]);
    const dy = Math.max(42, yExtent[1] - yExtent[0]);
    const k = Math.max(2.1, Math.min(6.2, 0.72 / Math.max(dx / WIDTH, dy / HEIGHT)));
    focusPoint([(xExtent[0] + xExtent[1]) / 2, (yExtent[0] + yExtent[1]) / 2], k);
  }

  function resetView() {
    // “全” is an intentional world-view command, not a gradual zoom-out
    // cycle.  A second click returns to the Tang core so the primary camera
    // never opens on an over-compressed Eurasian overview.
    const worldActive = currentZoomTier === "world" || cameraPresetIndex === 2;
    cameraPresetIndex = worldActive ? 0 : 2;
    setCamera(worldActive ? SCENARIO_INITIAL_VIEW : WORLD_CAMERA_VIEW, {
      animate: true,
      scale: worldActive ? INITIAL_ZOOM : null,
    });
    updateResetButtonLabel();
  }

  function hasVerifiedPolityGeometry(item) {
    const source = item.geometrySource;
    return source?.status === "verified" && source.year === 741
      && /^https:\/\//.test(source.url || "")
      && /^(CC0|Public Domain|CC BY 4.0|CC BY-SA 4.0|ODbL 1.0)$/.test(source.license || "")
      && ["Polygon", "MultiPolygon"].includes(item.geometry?.type);
  }

  function buildOuterPolities() {
    // A label anchor is NOT a territorial claim. Unverified hand-authored
    // bounding rings must never become visible country geometry.
    const polityItems = historicalPolitySource.filter((item) =>
      item.displayOnMap !== false && isValidCoordinate(item.labelAnchor));
    const verifiedItems = polityItems.filter(hasVerifiedPolityGeometry)
      .filter((item) => geometryHasValidCoordinates(item.geometry))
      .map((item) => ({ ...item, feature: {
        type: "Feature", geometry: rewindStrategicGeometry(item.geometry),
        properties: { factionId: item.id, name: item.name, kind: item.kind },
      } }));
    const layer = viewport.select("#outerPolityLayer").attr("clip-path", "url(#landClip)");
    const zones = layer.selectAll("g.outer-polity").data(verifiedItems, (item) => item.id).join("g")
      .attr("class", "outer-polity")
      .attr("data-faction-id", (item) => item.id)
      .attr("data-boundary-status", "verified");
    zones.each(function renderZone(item) {
      d3.select(this).selectAll("path.outer-polity-zone").data([item.feature]).join("path")
        .attr("class", "outer-polity-zone")
        .attr("d", (feature) => path(feature))
        .attr("fill", item.color).style("--polity-color", item.color)
        .attr("data-faction-id", item.id)
        .attr("vector-effect", "non-scaling-stroke").attr("pointer-events", "none");
    });
    const labels = uiViewport.select("#outerPolityLabelLayer").selectAll("g.outer-polity-label")
      .data(polityItems, (item) => item.id).join("g")
      .attr("class", (item) => `outer-polity-label map-label-candidate${item.labelDetail ? " outer-detail-label" : ""}`)
      .attr("data-faction-id", (item) => item.id)
      .attr("data-label-priority", (item) => item.labelPriority || 118)
      .attr("data-boundary-status", (item) => hasVerifiedPolityGeometry(item) ? "verified" : "unverified");
    labels.each(function register(item) {
      const [x, y] = projection(item.labelAnchor);
      registerScreenSpace(this, x, y);
    });
    labels.selectAll("text.polity-name").data((item) => [item]).join("text")
      .attr("class", "polity-name").text((item) => item.name);
    labels.selectAll("text.polity-type").remove();
    labels.selectAll("title").data((item) => [item]).join("title")
      .text((item) => `${item.name} · ${item.kind}；方位标注，不代表疆界`);
  }

  function buildWorldLabels() {
    const [x, y] = position([108.5, 31.8]);
    const label = uiViewport.select("#worldLabelLayer").append("g")
      .attr("class", "world-empire-label map-label-candidate");
    registerScreenSpace(label.node(), x, y);
    label.append("text").text("唐");
  }

  function drawGeo(context, canvasPath, datum, { fill = null, stroke = null, lineWidth = 1, dash = [] } = {}) {
    context.save();
    context.beginPath();
    canvasPath(datum);
    if (fill) { context.fillStyle = fill; context.fill(); }
    if (stroke) {
      context.strokeStyle = stroke;
      context.lineWidth = lineWidth;
      context.setLineDash(dash);
      context.stroke();
    }
    context.restore();
  }

  function buildPhysicalRaster(land, rivers, lakes, terrain, land50, land10) {
    if (!physicalCanvas) return;
    physicalCanvas.width = WIDTH * RASTER_SCALE;
    physicalCanvas.height = HEIGHT * RASTER_SCALE;
    const context = physicalCanvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!context) return;
    context.setTransform(RASTER_SCALE, 0, 0, RASTER_SCALE, 0, 0);
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.lineJoin = "round";
    context.lineCap = "round";
    const canvasPath = d3.geoPath(projection).context(context);
    // The latitude/longitude graticule was useful while validating WGS84 but
    // reads as a modern GIS grid in the shipped game. The Tang atlas uses
    // rivers, mountain axes, dao boundaries and passes as its visual frame.
    // The physical layer is an old-silk base, not a modern satellite tile.
    // Political fills remain translucent above it so rivers and relief stay
    // legible in every map mode.
    drawGeo(context, canvasPath, land, { fill: "#d8ceb5", stroke: "rgba(94,78,61,.42)", lineWidth: .85 });
    if (PERFORMANCE_MODE) {
      if (PERF_LEVEL >= 8) {
        const highlands = terrain.features.filter((feature) => !/Plain|Basin/i.test(feature.properties.FEATURECLA));
        const lowlands = terrain.features.filter((feature) => /Plain|Basin/i.test(feature.properties.FEATURECLA));
        drawGeo(context, canvasPath, { type: "FeatureCollection", features: highlands }, { fill: "rgba(149,141,121,.28)", stroke: "rgba(91,78,61,.22)", lineWidth: .55 });
        drawGeo(context, canvasPath, { type: "FeatureCollection", features: lowlands }, { fill: "rgba(200,191,165,.26)", stroke: "rgba(124,110,86,.14)", lineWidth: .45 });
        drawGeo(context, canvasPath, lakes, { fill: "#879ba0", stroke: "rgba(83,111,116,.58)", lineWidth: .75 });
      }
      physicalCanvas.dataset.ready = "true";
      diagnostics.physicalRasterBuilds += 1;
      queueCanvasLayout();
      return;
    }
    const highlands = terrain.features.filter((feature) => !/Plain|Basin/i.test(feature.properties.FEATURECLA));
    const lowlands = terrain.features.filter((feature) => /Plain|Basin/i.test(feature.properties.FEATURECLA));
    drawGeo(context, canvasPath, { type: "FeatureCollection", features: highlands }, { fill: "rgba(149,141,121,.28)", stroke: "rgba(91,78,61,.22)", lineWidth: .55 });
    drawGeo(context, canvasPath, { type: "FeatureCollection", features: lowlands }, { fill: "rgba(200,191,165,.26)", stroke: "rgba(124,110,86,.14)", lineWidth: .45 });
    drawGeo(context, canvasPath, lakes, { fill: "#879ba0", stroke: "rgba(83,111,116,.58)", lineWidth: .75 });
    const minorRivers = rivers.features.filter((feature) => Number(feature.properties.scalerank ?? 9) > 3);
    const majorRivers = rivers.features.filter((feature) => Number(feature.properties.scalerank ?? 9) <= 3);
    drawGeo(context, canvasPath, { type: "FeatureCollection", features: majorRivers }, { stroke: "#647f85", lineWidth: 2.15 });
    physicalCanvas.dataset.ready = "true";
    diagnostics.physicalRasterBuilds += 1;
    if (detailCanvas) {
      detailCanvas.width = WIDTH * RASTER_SCALE;
      detailCanvas.height = HEIGHT * RASTER_SCALE;
      const detailContext = detailCanvas.getContext("2d", { alpha: true, desynchronized: true });
      if (detailContext) {
        detailContext.setTransform(RASTER_SCALE, 0, 0, RASTER_SCALE, 0, 0);
        detailContext.clearRect(0, 0, WIDTH, HEIGHT);
        detailContext.lineJoin = "round";
        detailContext.lineCap = "round";
        const detailPath = d3.geoPath(projection).context(detailContext);
        drawGeo(detailContext, detailPath, { type: "FeatureCollection", features: minorRivers }, { stroke: "#809598", lineWidth: 1.15 });
        detailCanvas.dataset.ready = "true";
        diagnostics.detailRasterBuilds += 1;
      }
    }
    if (land50) buildLodCanvas(midCanvas, land50, "50m");
    if (land10) buildLodCanvas(detailCanvas, land10, "10m");
    queueCanvasLayout();
  }

  function buildLodCanvas(canvas, land, scale) {
    if (!canvas || !land?.features?.length) return;
    canvas.width = WIDTH * RASTER_SCALE;
    canvas.height = HEIGHT * RASTER_SCALE;
    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!context) return;
    context.setTransform(RASTER_SCALE, 0, 0, RASTER_SCALE, 0, 0);
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.lineJoin = "round";
    context.lineCap = "round";
    const canvasPath = d3.geoPath(projection).context(context);
    // The base 110m canvas owns the opaque land fill. Higher-resolution LOD
    // canvases only add a coastline stroke, so they cannot paint a second
    // clipped mainland rectangle above the physical layer.
    drawGeo(context, canvasPath, land, { stroke: "rgba(196,178,135,.5)", lineWidth: .85 });
    canvas.dataset.ready = "true";
    canvas.dataset.sourceScale = scale;
    if (scale === "50m") diagnostics.midRasterBuilds = (diagnostics.midRasterBuilds || 0) + 1;
    if (scale === "10m") diagnostics.highRasterBuilds = (diagnostics.highRasterBuilds || 0) + 1;
  }

  function pointSegmentDistanceSquared(point, start, end) {
    let x = start[0];
    let y = start[1];
    let dx = end[0] - x;
    let dy = end[1] - y;
    if (dx || dy) {
      const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = end[0]; y = end[1]; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = point[0] - x;
    dy = point[1] - y;
    return dx * dx + dy * dy;
  }

  function simplifyLine(points, tolerance = .055) {
    if (points.length <= 4) return points;
    const closed = points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1];
    const source = closed ? points.slice(0, -1) : points.slice();
    const keep = new Uint8Array(source.length);
    const toleranceSquared = tolerance * tolerance;
    keep[0] = 1;
    keep[source.length - 1] = 1;
    const stack = [[0, source.length - 1]];
    while (stack.length) {
      const [first, last] = stack.pop();
      let maxDistance = toleranceSquared;
      let index = -1;
      for (let cursor = first + 1; cursor < last; cursor += 1) {
        const distance = pointSegmentDistanceSquared(source[cursor], source[first], source[last]);
        if (distance > maxDistance) { maxDistance = distance; index = cursor; }
      }
      if (index > 0) {
        keep[index] = 1;
        stack.push([first, index], [index, last]);
      }
    }
    const simplified = source.filter((_, index) => keep[index]);
    if (closed && simplified.length >= 3) simplified.push(simplified[0]);
    return simplified.length >= (closed ? 4 : 2) ? simplified : points;
  }

  function simplifyLandForClip(land) {
    let vertexCount = 0;
    const simplifyGeometry = (geometry) => {
      if (!geometry) return geometry;
      let coordinates = geometry.coordinates;
      if (geometry.type === "Polygon") coordinates = coordinates.map((ring) => simplifyLine(ring));
      else if (geometry.type === "MultiPolygon") coordinates = coordinates.map((polygon) => polygon.map((ring) => simplifyLine(ring)));
      const count = (value) => {
        if (!Array.isArray(value)) return;
        if (typeof value[0] === "number") { vertexCount += 1; return; }
        value.forEach(count);
      };
      count(coordinates);
      return { ...geometry, coordinates };
    };
    const simplified = {
      type: "FeatureCollection",
      features: land.features.map((feature) => ({ ...feature, geometry: simplifyGeometry(feature.geometry) })),
    };
    diagnostics.clipVertices = vertexCount;
    return simplified;
  }

  function normalizeStrategicFeatures(strategyRegions) {
    const sourceFeatures = strategyRegions?.type === "FeatureCollection" ? strategyRegions.features : [];
    const byId = new Map(sourceFeatures
      .filter((feature) => feature?.properties?.level === "strategic-region" || feature?.properties?.region_id)
      .map((feature) => [feature.properties.region_id || feature.properties.id, feature]));
    const missing = regionList.filter((region) => !byId.has(region.id)).map((region) => region.id);
    const invalid = [];
    const normalized = regionList.filter((region) => byId.has(region.id)).flatMap((region) => {
      const feature = byId.get(region.id);
      if (!feature.geometry || !["Polygon", "MultiPolygon"].includes(feature.geometry.type)) {
        invalid.push(region.id);
        return [];
      }
      return [{
        ...feature,
        geometry: rewindStrategicGeometry(feature.geometry),
        properties: {
          ...feature.properties,
          id: region.id,
          region_id: region.id,
          province: region.province,
          admin: region.admin,
          name: region.name,
        },
      }];
    });
    const degradedRegions = [...missing, ...invalid];
    if (degradedRegions.length) {
      console.error(`战略区几何不完整，缺失或无效地区 ${degradedRegions.length} 个`, degradedRegions);
      window.TianxiaMap.degradedRegions = degradedRegions;
    }
    return normalized;
  }

  function planarRingArea(ring) {
    let area = 0;
    for (let index = 0; index < ring.length - 1; index += 1) {
      const [x, y] = ring[index] || [];
      const [nextX, nextY] = ring[index + 1] || [];
      if ([x, y, nextX, nextY].every(Number.isFinite)) area += x * nextY - nextX * y;
    }
    return area / 2;
  }

  // Natural Earth/geoBoundaries polygons are commonly counter-clockwise,
  // while d3-geo's spherical renderer treats clockwise rings as the exterior
  // of a small region.  Rewind once at initialization so a region path is the
  // region itself rather than the clipped complement of the whole viewport.
  function rewindStrategicGeometry(geometry) {
    if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return geometry;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    const coordinates = polygons.map((polygon) => polygon.map((ring, index) => {
      const area = planarRingArea(ring);
      const shouldBeClockwise = index === 0;
      if ((shouldBeClockwise && area > 0) || (!shouldBeClockwise && area < 0)) return [...ring].reverse();
      return ring;
    }));
    return { ...geometry, coordinates: geometry.type === "Polygon" ? coordinates[0] : coordinates };
  }

  function geometryBounds(geometry) {
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const visit = (value) => {
      if (!Array.isArray(value)) return;
      if (typeof value[0] === "number") {
        bounds[0] = Math.min(bounds[0], value[0]);
        bounds[1] = Math.min(bounds[1], value[1]);
        bounds[2] = Math.max(bounds[2], value[0]);
        bounds[3] = Math.max(bounds[3], value[1]);
        return;
      }
      value.forEach(visit);
    };
    visit(geometry?.coordinates);
    return bounds;
  }

  function geometryArea(geometry) {
    if (!geometry) return Infinity;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    return polygons.reduce((total, polygon) => {
      const outer = Math.abs(planarRingArea(polygon?.[0] || []));
      const holes = (polygon || []).slice(1).reduce((sum, ring) => sum + Math.abs(planarRingArea(ring)), 0);
      return total + Math.max(0, outer - holes);
    }, 0);
  }

  function anchorDistanceSquared(lonLat, regionId) {
    const region = regions[regionId];
    if (!region || !Number.isFinite(region.lon) || !Number.isFinite(region.lat)) return Infinity;
    const latitudeScale = Math.cos((Number(lonLat[1]) * Math.PI) / 180);
    const dx = (Number(lonLat[0]) - region.lon) * latitudeScale;
    const dy = Number(lonLat[1]) - region.lat;
    return dx * dx + dy * dy;
  }

  const regionPaintPriority = Object.freeze({ farm: 10, port: 20, city: 40, gate: 60, capital: 100 });

  function isValidCoordinate(value) {
    return Array.isArray(value)
      && Number.isFinite(Number(value[0]))
      && Number.isFinite(Number(value[1]))
      && Math.abs(Number(value[0])) <= 180
      && Math.abs(Number(value[1])) <= 90;
  }

  function geometryHasValidCoordinates(geometry) {
    let count = 0;
    let invalid = false;
    const visit = (value) => {
      if (!Array.isArray(value)) return;
      if (typeof value[0] === "number") {
        count += 1;
        if (!isValidCoordinate(value)) invalid = true;
        return;
      }
      value.forEach(visit);
    };
    visit(geometry?.coordinates);
    return count > 1 && !invalid;
  }

  function boundsOverlap(left, right) {
    return left[2] >= right[0][0]
      && left[0] <= right[1][0]
      && left[3] >= right[0][1]
      && left[1] <= right[1][1];
  }

  function geometryBoundsWithin(geometry, bounds) {
    const visible = [Infinity, Infinity, -Infinity, -Infinity];
    const visit = (value) => {
      if (!Array.isArray(value)) return;
      if (typeof value[0] === "number") {
        const [longitude, latitude] = value;
        if (longitude >= bounds[0][0] && longitude <= bounds[1][0]
          && latitude >= bounds[0][1] && latitude <= bounds[1][1]) {
          visible[0] = Math.min(visible[0], longitude);
          visible[1] = Math.min(visible[1], latitude);
          visible[2] = Math.max(visible[2], longitude);
          visible[3] = Math.max(visible[3], latitude);
        }
        return;
      }
      value.forEach(visit);
    };
    visit(geometry?.coordinates);
    return visible;
  }

  // Natural Earth's main Eurasia feature is a single polygon that extends
  // north of our playable window.  Letting d3-geo clip that ring only at the
  // SVG/canvas viewport can turn the out-of-window section into a straight
  // rectangular band along the top edge.  Clip geographic coordinates before
  // they reach any raster or vector layer so every LOD has the same valid
  // world window and can never paint a map-sized rectangle.
  function clipRingToBounds(ring, bounds) {
    if (!Array.isArray(ring) || ring.length < 3) return [];
    const minX = bounds[0][0];
    const minY = bounds[0][1];
    const maxX = bounds[1][0];
    const maxY = bounds[1][1];
    let output = ring
      .filter(isValidCoordinate)
      .map(([x, y]) => [Number(x), Number(y)]);
    const edges = [
      { inside: ([x]) => x >= minX, intersect: ([x1, y1], [x2, y2]) => [minX, y1 + (y2 - y1) * ((minX - x1) / (x2 - x1 || 1e-12))] },
      { inside: ([x]) => x <= maxX, intersect: ([x1, y1], [x2, y2]) => [maxX, y1 + (y2 - y1) * ((maxX - x1) / (x2 - x1 || 1e-12))] },
      { inside: ([, y]) => y >= minY, intersect: ([x1, y1], [x2, y2]) => [x1 + (x2 - x1) * ((minY - y1) / (y2 - y1 || 1e-12)), minY] },
      { inside: ([, y]) => y <= maxY, intersect: ([x1, y1], [x2, y2]) => [x1 + (x2 - x1) * ((maxY - y1) / (y2 - y1 || 1e-12)), maxY] },
    ];
    edges.forEach(({ inside, intersect }) => {
      if (!output.length) return;
      const clipped = [];
      let previous = output[output.length - 1];
      let previousInside = inside(previous);
      output.forEach((current) => {
        const currentInside = inside(current);
        if (currentInside !== previousInside) clipped.push(intersect(previous, current));
        if (currentInside) clipped.push(current);
        previous = current;
        previousInside = currentInside;
      });
      output = clipped;
    });
    if (output.length < 3) return [];
    const first = output[0];
    const last = output[output.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) output.push([...first]);
    return output;
  }

  function clipLineSegmentToBounds(start, end, bounds) {
    const minX = bounds[0][0];
    const minY = bounds[0][1];
    const maxX = bounds[1][0];
    const maxY = bounds[1][1];
    let t0 = 0;
    let t1 = 1;
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const checks = [
      [-dx, start[0] - minX],
      [dx, maxX - start[0]],
      [-dy, start[1] - minY],
      [dy, maxY - start[1]],
    ];
    for (const [p, q] of checks) {
      if (Math.abs(p) < 1e-12) {
        if (q < 0) return null;
        continue;
      }
      const ratio = q / p;
      if (p < 0) {
        if (ratio > t1) return null;
        if (ratio > t0) t0 = ratio;
      } else {
        if (ratio < t0) return null;
        if (ratio < t1) t1 = ratio;
      }
    }
    return [
      [start[0] + dx * t0, start[1] + dy * t0],
      [start[0] + dx * t1, start[1] + dy * t1],
    ];
  }

  function clipLineToBounds(line, bounds) {
    if (!Array.isArray(line) || line.length < 2) return [];
    const lines = [];
    let current = [];
    const flush = () => {
      if (current.length >= 2) lines.push(current);
      current = [];
    };
    for (let index = 1; index < line.length; index += 1) {
      const segment = clipLineSegmentToBounds(line[index - 1], line[index], bounds);
      if (!segment) {
        flush();
        continue;
      }
      const [start, end] = segment;
      const previous = current[current.length - 1];
      if (!previous || previous[0] !== start[0] || previous[1] !== start[1]) {
        if (previous) flush();
        current.push(start);
      }
      current.push(end);
    }
    flush();
    return lines;
  }

  function clipGeometryToBounds(geometry, bounds) {
    if (!geometry) return geometry;
    if (geometry.type === "Polygon") {
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((ring) => clipRingToBounds(ring, bounds)).filter((ring) => ring.length >= 4),
      };
    }
    if (geometry.type === "MultiPolygon") {
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => clipRingToBounds(ring, bounds)).filter((ring) => ring.length >= 4)).filter((polygon) => polygon.length),
      };
    }
    if (geometry.type === "LineString") {
      const lines = clipLineToBounds(geometry.coordinates, bounds);
      return lines.length === 1 ? { ...geometry, coordinates: lines[0] } : { type: "MultiLineString", coordinates: lines };
    }
    if (geometry.type === "MultiLineString") {
      return { ...geometry, coordinates: geometry.coordinates.flatMap((line) => clipLineToBounds(line, bounds)) };
    }
    if (geometry.type === "GeometryCollection") {
      return { ...geometry, geometries: geometry.geometries.map((item) => clipGeometryToBounds(item, bounds)).filter(Boolean) };
    }
    return geometry;
  }

  // Validate the downloaded Natural Earth collection once.  This prevents a
  // stray null-island point, reversed [lat,lng] record, or antimeridian-wide
  // polygon from influencing the physical raster or a camera fit.
  function sanitizeGeographicCollection(collection, label, bounds = WORLD_BOUNDS) {
    const sourceFeatures = collection?.type === "FeatureCollection" ? collection.features : [];
    const features = sourceFeatures.filter((feature) => {
      if (!geometryHasValidCoordinates(feature?.geometry)) return false;
      const featureBounds = geometryBounds(feature.geometry);
      if (!featureBounds.every(Number.isFinite)) return false;
      // A zero-area [0,0] artefact is not geography.  Real coastlines that
      // pass near the equator remain valid because they have a real extent.
      if (featureBounds[0] === 0 && featureBounds[1] === 0
        && featureBounds[2] === 0 && featureBounds[3] === 0) return false;
      // Only the configured world window participates in this map.  This also
      // keeps out-of-scope continents from inflating canvas work.
      return boundsOverlap(featureBounds, bounds);
    });
    const clippedFeatures = features.map((feature) => ({
      ...feature,
      // Physical GIS rings need the SAME winding convention as strategic
      // polygons. Otherwise d3 paints the spherical complement: a viewport-
      // sized beige/blue rectangle with coastlines visible through it.
      geometry: rewindStrategicGeometry(clipGeometryToBounds(feature.geometry, bounds)),
    })).filter((feature) => geometryHasValidCoordinates(feature.geometry));
    const result = { ...collection, features: clippedFeatures };
    // A Natural Earth mainland feature can contain Europe, Africa and Asia in
    // one ring.  For diagnostics and camera safety we measure only the part
    // inside WORLD_BOUNDS; the renderer's projection clip keeps the original
    // land geometry intact and geographically accurate.
    const boundsValues = clippedFeatures
      .map((feature) => geometryBoundsWithin(feature.geometry, bounds))
      .filter((item) => item.every(Number.isFinite));
    const merged = boundsValues.reduce((acc, item) => [
      Math.min(acc[0], item[0]),
      Math.min(acc[1], item[1]),
      Math.max(acc[2], item[2]),
      Math.max(acc[3], item[3]),
    ], [Infinity, Infinity, -Infinity, -Infinity]);
    diagnostics.geometryBounds = merged.every(Number.isFinite) ? merged : null;
    diagnostics.filteredGeometryFeatures += sourceFeatures.length - features.length;
    console.debug(`[TianxiaMap] geoBounds(${label})`, JSON.stringify(diagnostics.geometryBounds), {
      sourceFeatures: sourceFeatures.length,
      visibleFeatures: features.length,
    });
    return result;
  }

  function projectedBounds(bounds) {
    const corners = [
      [bounds[0][0], bounds[0][1]],
      [bounds[0][0], bounds[1][1]],
      [bounds[1][0], bounds[0][1]],
      [bounds[1][0], bounds[1][1]],
    ].map((coordinate) => projection(coordinate)).filter((point) => point?.every(Number.isFinite));
    return corners.length
      ? {
        minX: d3.min(corners, (point) => point[0]),
        minY: d3.min(corners, (point) => point[1]),
        maxX: d3.max(corners, (point) => point[0]),
        maxY: d3.max(corners, (point) => point[1]),
      }
      : null;
  }

  function cameraForBounds(bounds, padding = 38, forcedScale = null) {
    const extent = projectedBounds(bounds);
    if (!extent) return d3.zoomIdentity;
    const width = Math.max(1, extent.maxX - extent.minX);
    const height = Math.max(1, extent.maxY - extent.minY);
    const availableWidth = WIDTH - padding * 2;
    const availableHeight = HEIGHT - padding * 2;
    const fittedScale = Math.min(availableWidth / width, availableHeight / height);
    const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number.isFinite(forcedScale) ? forcedScale : fittedScale));
    const centerX = (extent.minX + extent.maxX) / 2;
    const centerY = (extent.minY + extent.maxY) / 2;
    return d3.zoomIdentity
      .translate(WIDTH / 2 - centerX * k, HEIGHT / 2 - centerY * k)
      .scale(k);
  }

  function updateResetButtonLabel() {
    const button = document.querySelector("#mapResetView");
    if (!button) return;
    const labels = ["展开至天下全图", "展开至天下全图", "返回大唐核心视角"];
    button.setAttribute("aria-label", labels[cameraPresetIndex] || labels[0]);
    button.title = labels[cameraPresetIndex] || labels[0];
  }

  function setCamera(bounds, { animate = false, scale = null } = {}) {
    const transform = cameraForBounds(bounds, 38, scale);
    if (animate) {
      svg.transition().duration(420).ease(d3.easeCubicOut).call(zoom.transform, transform);
    } else {
      svg.call(zoom.transform, transform);
    }
  }

  // d3.geoContains follows spherical winding rules.  A few openly licensed
  // modern administrative sources use the opposite ring winding, which makes
  // every region appear to contain the whole globe to a spherical hit test.
  // Use an even/odd planar test in the same WGS84 lon/lat coordinates instead;
  // it is winding-independent and matches the actual rendered polygon.
  function ringContains(point, ring) {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index += 1) {
      const [x, y] = ring[index] || [];
      const [previousX, previousY] = ring[previous] || [];
      if (![x, y, previousX, previousY].every(Number.isFinite)) continue;
      if ((y > point[1]) !== (previousY > point[1])
        && point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x) inside = !inside;
    }
    return inside;
  }

  function geometryContains(feature, point) {
    const geometry = feature?.geometry;
    if (!geometry) return false;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return polygons.some((polygon) => ringContains(point, polygon[0] || [])
      && !(polygon.slice(1).some((hole) => ringContains(point, hole))));
  }

  const boundaryPointKey = ([longitude, latitude]) => `${Math.round(Number(longitude) * 1e6)},${Math.round(Number(latitude) * 1e6)}`;
  const boundarySegmentKey = (a, b) => [boundaryPointKey(a), boundaryPointKey(b)].sort().join("|");

  function buildRegionBorders(features) {
    const layer = viewport.select("#regionBorderLayer");
    if (layer.empty()) return;
    const featureById = new Map(features.map((feature) => [feature.properties.region_id || feature.properties.id, feature]));
    const segments = new Map();
    const ringsOf = (feature) => feature.geometry.type === "Polygon"
      ? feature.geometry.coordinates
      : feature.geometry.coordinates.flat();
    features.forEach((feature) => {
      const regionId = feature.properties.region_id || feature.properties.id;
      ringsOf(feature).forEach((ring) => {
        for (let index = 0; index < ring.length - 1; index += 1) {
          const start = ring[index];
          const end = ring[index + 1];
          if (!Array.isArray(start) || !Array.isArray(end) || boundaryPointKey(start) === boundaryPointKey(end)) continue;
          const key = boundarySegmentKey(start, end);
          const entries = segments.get(key) || [];
          entries.push({ regionId, start, end });
          segments.set(key, entries);
        }
      });
    });
    // A shared boundary is usually made of thousands of tiny GeoJSON
    // segments.  Keep one SVG path per region pair and concatenate those
    // segments into a single path; rendering one path per segment created a
    // 70k+ node DOM on the Tang map and made the performance harness useless.
    const borderGroups = new Map();
    segments.forEach((entries, key) => {
      // Aggregated MultiPolygons still contain constituent county rings.
      // Cancel paired edges within the SAME region before finding neighbours.
      const unique = entries.filter((entry, index) => entries.findIndex((other) => other.regionId === entry.regionId) === index)
        .filter((entry) => entries.filter((other) => other.regionId === entry.regionId).length % 2 === 1);
      const pairs = [];
      if (unique.length < 2) pairs.push([unique[0], null]);
      else unique.forEach((entry, index) => unique.slice(index + 1).forEach((other) => pairs.push([entry, other])));
      pairs.forEach(([left, right]) => {
        if (!left) return;
        const otherId = right?.regionId || "";
        const [x1, y1] = projection(left.start);
        const [x2, y2] = projection(left.end);
        const pair = [left.regionId, otherId].filter(Boolean).sort();
        const groupKey = `${pair[0] || left.regionId}|${pair[1] || "outer"}`;
        const group = borderGroups.get(groupKey) || {
          key: groupKey,
          d: [],
          a: pair[0] || left.regionId,
          b: pair[1] || "",
          daoBoundary: false,
        };
        if (otherId) {
          const leftFeature = featureById.get(left.regionId);
          const rightFeature = featureById.get(otherId);
          group.daoBoundary = group.daoBoundary || Boolean(leftFeature && rightFeature
            && leftFeature.properties.province !== rightFeature.properties.province);
        }
        group.d.push(`M${x1.toFixed(3)} ${y1.toFixed(3)}L${x2.toFixed(3)} ${y2.toFixed(3)}`);
        borderGroups.set(groupKey, group);
      });
    });
    const borderFeatures = [...borderGroups.values()].map((border) => ({
      ...border,
      d: border.d.join(""),
    }));
    // A Dao outline must not stroke all of its constituent county rings.
    const daoPaths = new Map();
    borderFeatures.forEach((border) => {
      if (border.b && !border.daoBoundary) return;
      for (const regionId of [border.a, border.b].filter(Boolean)) {
        const daoId = featureById.get(regionId)?.properties.province;
        if (daoId) daoPaths.set(daoId, (daoPaths.get(daoId) || "") + border.d);
      }
    });
    viewport.select("#provinceBoundaryLayer").selectAll("path.province-boundary")
      .attr("d", (feature) => daoPaths.get(feature.properties.province_id) || "");
    layer.selectAll("path.region-border")
      .data(borderFeatures, (border) => border.key)
      .join("path")
      .attr("class", (border) => `region-border${border.daoBoundary ? " dao-border" : ""}`)
      .attr("d", (border) => border.d)
      .attr("data-border-a", (border) => border.a)
      .attr("data-border-b", (border) => border.b)
      .attr("vector-effect", "non-scaling-stroke");
    window.TianxiaMap.regionBordersReady = true;
  }

  function buildStrategicPolygons(land, strategyRegions, strategyProvinces) {
    const features = normalizeStrategicFeatures(strategyRegions);
    // Profiling and gameplay must measure identical geometry, not a cheaper
    // profiling-only substitute. Levels change visible layers, never paths.
    const renderFeatures = features;
    interactiveRegionFeatures = features;
    interactiveRegionHitCache = features.map((feature) => {
      const id = feature.properties.region_id || feature.properties.id;
      return {
        feature,
        bounds: geometryBounds(feature.geometry),
        area: geometryArea(feature.geometry),
        regionId: id,
      };
    });
    regionSpatialIndex.clear();
    interactiveRegionHitCache.forEach((entry) => {
      const [minLon, minLat, maxLon, maxLat] = entry.bounds;
      const x0 = Math.max(0, Math.min(HIT_GRID_COLUMNS - 1, Math.floor(((minLon - MAP_BOUNDS[0]) / (MAP_BOUNDS[2] - MAP_BOUNDS[0])) * HIT_GRID_COLUMNS)));
      const x1 = Math.max(0, Math.min(HIT_GRID_COLUMNS - 1, Math.floor(((maxLon - MAP_BOUNDS[0]) / (MAP_BOUNDS[2] - MAP_BOUNDS[0])) * HIT_GRID_COLUMNS)));
      const y0 = Math.max(0, Math.min(HIT_GRID_ROWS - 1, Math.floor(((minLat - MAP_BOUNDS[1]) / (MAP_BOUNDS[3] - MAP_BOUNDS[1])) * HIT_GRID_ROWS)));
      const y1 = Math.max(0, Math.min(HIT_GRID_ROWS - 1, Math.floor(((maxLat - MAP_BOUNDS[1]) / (MAP_BOUNDS[3] - MAP_BOUNDS[1])) * HIT_GRID_ROWS)));
      for (let row = y0; row <= y1; row += 1) for (let column = x0; column <= x1; column += 1) {
        const key = `${column}:${row}`;
        const bucket = regionSpatialIndex.get(key) || [];
        bucket.push(entry);
        regionSpatialIndex.set(key, bucket);
      }
    });
    window.TianxiaMap.strategyGeoJSON = { ...strategyRegions, features: renderFeatures };
    window.TianxiaMap.strategyProvinceGeoJSON = strategyProvinces;

    const clipLand = simplifyLandForClip(land);
    svg.select("#landClip").selectAll("path").data([clipLand]).join("path").attr("d", path);

    // The 15 Dao geometry is a historical administrative aggregation of the
    // same committed strategic polygons. It is a real path layer (not a text
    // label or modern-country border) and remains separate from the 100
    // interactive region hitboxes.
    const provinceFeatures = (strategyProvinces?.features || [])
      .filter((feature) => feature?.geometry && feature.properties?.province_id)
      .map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          province_id: feature.properties.province_id,
          dao_id: feature.properties.dao_id || feature.properties.province_id,
          name: feature.properties.name || feature.properties.province_id,
        },
      }));
    viewport.select("#provinceBoundaryLayer").selectAll("path.province-boundary")
      .data(provinceFeatures, (feature) => feature.properties.province_id)
      .join("path")
      .attr("class", "province-boundary")
      .attr("d", "")
      .attr("data-province-id", (feature) => feature.properties.province_id)
      .attr("data-map-object", "province")
      .attr("vector-effect", "non-scaling-stroke");

    const byProvince = d3.group(renderFeatures, (feature) => feature.properties.province);
    const paintGroups = [...byProvince].map(([provinceId, provinceFeatures]) => [
      provinceId,
      [...provinceFeatures].sort((left, right) => (
        (regionPaintPriority[left.properties.type] || 30) - (regionPaintPriority[right.properties.type] || 30)
      )),
    ]);
    const territories = viewport.select("#territoryLayer").selectAll("g.territory")
      .data(paintGroups, ([provinceId]) => provinceId)
      .join("g")
      .attr("class", "territory")
      .attr("data-id", ([provinceId]) => provinceId);
    const regionPaths = territories.selectAll("path").data(([, provinceFeatures]) => provinceFeatures).join("path")
      .attr("d", (feature) => path(feature))
      .attr("id", (feature) => `region-${feature.properties.id}`)
      .attr("data-region-cell", (feature) => feature.properties.id)
      .attr("data-region-id", (feature) => feature.properties.id)
      .attr("data-dao-id", (feature) => feature.properties.province)
      .attr("data-map-object", "region")
      .attr("tabindex", 0)
      .attr("role", "button");
    // A second, non-interactive path distinguishes a controller's occupation
    // from the legal owner without replacing the controller's political fill.
    territories.selectAll("path.occupation-hatch")
      .data(([, provinceFeatures]) => provinceFeatures, (feature) => feature.properties.id)
      .join("path")
      .attr("class", "occupation-hatch")
      .attr("d", (feature) => path(feature))
      .attr("data-occupation-region", (feature) => feature.properties.id)
      .attr("pointer-events", "none")
      .attr("aria-hidden", "true");
    // SVG has no z-index for sibling paths.  Explicitly paint capitals and
    // gates after broad county unions so a dense cluster cannot hide Chang'an
    // behind the 武关 polygon merely because the source file order changed.
    regionPaths.sort((left, right) => (
      (regionPaintPriority[left.properties.type] || 30) - (regionPaintPriority[right.properties.type] || 30)
    ));
    if (!PERFORMANCE_MODE || PERF_LEVEL >= 3) buildRegionBorders(renderFeatures);
    else viewport.select("#regionBorderLayer").selectAll("path.region-border").remove();

    const labels = uiViewport.select("#provinceLabelLayer").selectAll("g.province-label")
      .data([...byProvince], ([provinceId]) => provinceId)
      .join("g")
      .attr("class", "province-label map-label-candidate")
      .attr("data-id", ([provinceId]) => provinceId);
    if (PERF_LEVEL > 0 && PERF_LEVEL < 6) labels.attr("hidden", true);
    labels.each(function register([provinceId]) {
      const point = provincePosition(provinceId);
      registerScreenSpace(this, point[0], point[1]);
    });
    labels.each(function ensureChildren() {
      const label = d3.select(this);
      if (label.select(".province-name").empty()) {
        label.append("text").attr("class", "province-name");
        label.append("text").attr("class", "province-owner").attr("y", 17);
      }
    });
    queueLabelCollisions();
  }

  function regionAtClientPoint(clientX, clientY) {
    try {
      if (!interactiveRegionFeatures.length || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
      const svgNode = svg.node();
      if (!svgNode || !isValidTransform(currentTransform)) return null;
      let point;
      // d3.pointer accounts for the SVG viewBox and CSS scaling, so this stays
      // correct on 1080p/1440p layouts and in the in-app browser.
      point = d3.pointer({ clientX, clientY }, svgNode);
      if (!Array.isArray(point) || point.length < 2) {
        const rect = svgNode.getBoundingClientRect();
        point = [clientX - rect.left, clientY - rect.top];
      }
      const localPoint = [
        (point[0] - currentTransform.x) / currentTransform.k,
        (point[1] - currentTransform.y) / currentTransform.k,
      ];
      const invertProjection = projection["invert"];
      const lonLat = typeof invertProjection === "function" ? invertProjection(localPoint) : null;
      if (!lonLat || !Number.isFinite(lonLat[0]) || !Number.isFinite(lonLat[1])) return null;
      if (lonLat[0] < MAP_BOUNDS[0] || lonLat[0] > MAP_BOUNDS[2]
        || lonLat[1] < MAP_BOUNDS[1] || lonLat[1] > MAP_BOUNDS[3]) return null;
      const column = Math.max(0, Math.min(HIT_GRID_COLUMNS - 1, Math.floor(((lonLat[0] - MAP_BOUNDS[0]) / (MAP_BOUNDS[2] - MAP_BOUNDS[0])) * HIT_GRID_COLUMNS)));
      const row = Math.max(0, Math.min(HIT_GRID_ROWS - 1, Math.floor(((lonLat[1] - MAP_BOUNDS[1]) / (MAP_BOUNDS[3] - MAP_BOUNDS[1])) * HIT_GRID_ROWS)));
      const candidates = regionSpatialIndex.get(`${column}:${row}`) || interactiveRegionHitCache;
      const potentialMatches = candidates.filter(({ bounds }) => (
        lonLat[0] >= bounds[0] && lonLat[0] <= bounds[2]
        && lonLat[1] >= bounds[1] && lonLat[1] <= bounds[3]
      ));
      const matches = potentialMatches.filter(({ feature: candidate }) => geometryContains(candidate, lonLat));
      // At a source seam the projected centre of a very small polygon can land
      // on a shared edge or a tiny modern-source gap.  Keep the hitbox usable
      // by ranking bounded candidates as a fallback instead of returning the
      // first DOM-painted neighbour.
      const rankedMatches = matches.length ? matches : potentialMatches;
      if (!rankedMatches.length) return null;
      // Modern administrative source unions can touch or overlap at county
      // seams.  Never let DOM paint order decide the command target: choose
      // the polygon whose historical/game anchor is closest to the pointer,
      // then use the smaller geometry as a deterministic tie-breaker.
      const uniqueMatches = [...new Map(rankedMatches.map((entry) => [entry.regionId, entry])).values()];
      uniqueMatches.sort((left, right) => {
        const distance = anchorDistanceSquared(lonLat, left.regionId) - anchorDistanceSquared(lonLat, right.regionId);
        return Math.abs(distance) > 1e-8 ? distance : left.area - right.area;
      });
      const id = uniqueMatches[0].regionId;
      return document.getElementById(`region-${id}`)
        || document.querySelector(`[data-region-cell="${id}"]`);
    } catch {
      // Pointer events must never be allowed to abort the map interaction
      // handler; a null result simply leaves the current hover unchanged.
      return null;
    }
  }

  function buildPhysicalLayers([land, rivers, lakes, terrain, strategyRegions, strategyProvinces, land50, land10]) {
    buildPhysicalRaster(land, rivers, lakes, terrain, land50, land10);
    if (PERFORMANCE_MODE) {
      if (PERF_LEVEL >= 4) {
        const riverLayer = viewport.select("#riverLayer");
        const riverFeatures = rivers.features.filter((feature) => Number(feature.properties.scalerank ?? 9) <= 3);
        riverLayer.selectAll("path.perf-river").data(riverFeatures, (feature, index) => feature.properties.name || index)
          .join("path")
          .attr("class", "perf-river")
          .attr("d", (feature) => path(feature))
          .attr("vector-effect", "non-scaling-stroke");
      }
      buildStrategicPolygons(land, strategyRegions, null);
      return;
    }
    const terrainLabels = uiViewport.select("#terrainLabelLayer").selectAll("g.terrain-label-marker")
      .data(terrain.features).join("g")
      .attr("class", "terrain-label-marker map-label-candidate");
    terrainLabels.each(function register(feature) {
      const [x, y] = path.centroid(feature);
      registerScreenSpace(this, x, y);
    });
    terrainLabels.append("text").text((feature) => feature.properties.NAME_ZH || feature.properties.NAME);

    const importantRivers = rivers.features.filter((feature) => /^(Huang|Chang Jiang|Yangtze|Huai|Han|Wei|Liao)$/.test(feature.properties.name || ""));
    const riverNames = { Huang: "黄河", "Chang Jiang": "长江", Yangtze: "长江", Huai: "淮河", Han: "汉水", Wei: "渭水", Liao: "辽河" };
    const riverLabels = uiViewport.select("#riverLabelLayer").selectAll("g.river-label-marker")
      .data(importantRivers.filter((feature, index, all) => all.findIndex((item) => item.properties.name === feature.properties.name) === index))
      .join("g")
      .attr("class", "river-label-marker map-label-candidate");
    riverLabels.each(function register(feature) {
      const [x, y] = path.centroid(feature);
      registerScreenSpace(this, x, y);
    });
    riverLabels.append("text").text((feature) => riverNames[feature.properties.name]);
    buildStrategicPolygons(land, strategyRegions, strategyProvinces);
    syncScreenSpaceNodes(currentTransform);
    queueLabelCollisions();
  }

  function bindControls() {
    document.querySelector("#mapZoomIn")?.addEventListener("click", () => svg.call(zoom.scaleBy, 1.35));
    document.querySelector("#mapZoomOut")?.addEventListener("click", () => svg.call(zoom.scaleBy, 1 / 1.35));
    document.querySelector("#mapResetView")?.addEventListener("click", resetView);
  }

  // P0 layer diagnostic.  This is deliberately a DOM-only switch: it never
  // rebuilds GeoJSON, projection paths, or game state.  The ocean texture
  // entry is kept as an explicit "removed" layer so a production screenshot
  // can prove that no full-screen hatch is hiding above the geography.
  function mountLayerDebugPanel() {
    if (!DEBUG_LAYERS_ENABLED || PERFORMANCE_MODE) return;
    const frame = svg.node()?.closest(".map-frame");
    if (!frame || frame.querySelector(".map-debug-layers")) return;
    const worldMap = svg.node();
    const layers = [
      ["ocean", "Ocean"],
      ["ocean-texture", "OceanTexture"],
      ["physical-land", "PhysicalLand"],
      ["terrain", "Terrain"],
      ["political-fill", "PoliticalFill"],
      ["rivers", "Rivers"],
      ["borders", "Borders"],
      ["cities", "Cities"],
      ["armies", "Armies"],
      ["labels", "Labels"],
    ];
    const panel = document.createElement("div");
    panel.className = "map-debug-layers";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "地图图层诊断");
    const title = document.createElement("strong");
    title.textContent = "图层诊断";
    panel.appendChild(title);
    const initialState = { ocean: true, "ocean-texture": false, "physical-land": true, terrain: true, "political-fill": true, rivers: true, borders: true, cities: true, armies: true, labels: true };
    layers.forEach(([key, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.layer = key;
      button.setAttribute("aria-pressed", String(initialState[key]));
      button.textContent = `${label} ${initialState[key] ? "ON" : "OFF"}`;
      if (key === "ocean-texture") button.title = "P0 已删除全屏 SVG 纹理；此项无可渲染节点";
      button.addEventListener("click", () => {
        const enabled = button.getAttribute("aria-pressed") !== "true";
        button.setAttribute("aria-pressed", String(enabled));
        button.textContent = `${label} ${enabled ? "ON" : "OFF"}`;
        (key === "ocean" ? frame : worldMap)?.classList.toggle(`debug-hide-${key}`, !enabled);
      });
      panel.appendChild(button);
      (key === "ocean" ? frame : worldMap)?.classList.toggle(`debug-hide-${key}`, !initialState[key]);
    });
    frame.appendChild(panel);
  }

  function mapAssetVersion(filename) {
    return filename.startsWith("strategy-")
      ? (window.TIANXIA_VERSION?.MAP_VERSION || "tang741-v2")
      : "tang741-v1";
  }

  async function loadMapAsset(filename) {
    const source = `./data/${filename}?v=${encodeURIComponent(mapAssetVersion(filename))}`;
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        diagnostics.geoJsonFetches += 1;
        const response = await fetch(source, {
          credentials: "same-origin",
          cache: attempt === 0 ? "default" : "reload",
        });
        if (!response.ok) throw new Error(`${response.status} ${source}`);
        return await response.json();
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 300));
      }
    }
    throw lastError;
  }

  async function loadOptionalMapAsset(filename, fallback = emptyFeatureCollection()) {
    try {
      return await loadMapAsset(filename);
    } catch (error) {
      console.warn(`可选地图图层 ${filename} 加载失败，继续使用可用图层`, error);
      return fallback;
    }
  }

  function ensureLodAsset(level) {
    if (PERFORMANCE_MODE || lodLoads.has(level)) return lodLoads.get(level);
    const filename = level === "nation" ? "natural-earth-land-50m.geojson" : "natural-earth-land-10m.geojson";
    const canvas = level === "nation" ? midCanvas : detailCanvas;
    const promise = loadMapAsset(filename).then((land) => {
      const clippedLand = sanitizeGeographicCollection(land, `land-${level}`);
      buildLodCanvas(canvas, clippedLand, level === "nation" ? "50m" : "10m");
      if (canvas && level === "nation" && currentZoomTier !== "world" && currentZoomTier !== "ultra") canvas.hidden = false;
      if (canvas && level === "tactical" && ["district", "tactical", "urban", "ultra"].includes(currentZoomTier)) canvas.hidden = false;
      queueCanvasLayout();
      return land;
    }).catch((error) => {
      lodLoads.delete(level);
      console.warn(`LOD ${level} 加载失败`, error);
      return null;
    });
    lodLoads.set(level, promise);
    return promise;
  }

  window.TianxiaMap = {
    ready: false,
    projection,
    path,
    MapLODConfig,
    position,
    provincePosition,
    focusRegion,
    doubleClickRegion,
    focusProvince,
    resetView,
    setCamera,
    WORLD_BOUNDS,
    MIN_ZOOM,
    MAX_ZOOM,
    INITIAL_ZOOM,
    SCENARIO_INITIAL_VIEW,
    SCENARIO_EAST_ASIA_VIEW,
    screenSpaceTransform,
    registerScreenSpace,
    regionAtClientPoint,
    isPointVisible,
    refreshLabelCollisions: queueLabelCollisions,
    strategyGeoJSON: null,
    strategyProvinceGeoJSON: null,
    regionBordersReady: false,
    get isInteracting() { return isInteracting; },
    get transform() { return currentTransform; },
    get zoomTier() { return currentZoomTier; },
    getDiagnostics() {
      return {
        ...diagnostics,
        zoomTier: currentZoomTier,
        transform: { x: currentTransform.x, y: currentTransform.y, k: currentTransform.k },
        canvasConnected: Boolean(physicalCanvas?.isConnected),
        canvasReady: physicalCanvas?.dataset.ready === "true",
        canvasTransform: physicalCanvas?.style.transform || "",
        midCanvasConnected: Boolean(midCanvas?.isConnected),
        midCanvasReady: midCanvas?.dataset.ready === "true",
        detailCanvasConnected: Boolean(detailCanvas?.isConnected),
        detailCanvasReady: detailCanvas?.dataset.ready === "true",
        detailCanvasVisible: Boolean(detailCanvas && !detailCanvas.hidden),
        canvasDisplayScale,
        worldConnected: Boolean(worldViewport.node()?.isConnected),
        uiConnected: Boolean(uiViewport.node()?.isConnected),
        screenSpaceNodes: screenSpaceNodes.size,
        performanceMode: PERFORMANCE_MODE,
        lodLoads: [...lodLoads.keys()],
        hitIndexBuckets: regionSpatialIndex.size,
        worldBounds: WORLD_BOUNDS,
        scenarioInitialView: SCENARIO_INITIAL_VIEW,
        scenarioEastAsiaView: SCENARIO_EAST_ASIA_VIEW,
        cameraPresetIndex,
        geometryBounds: diagnostics.geometryBounds,
      };
    },
  };

  if (!PERFORMANCE_MODE) {
    buildOuterPolities();
    buildWorldLabels();
  }
  bindControls();
  mountLayerDebugPanel();
  const mapFrame = svg.node()?.closest(".map-frame");
  if ("ResizeObserver" in window) {
    const mapResizeObserver = new ResizeObserver(queueCanvasLayout);
    [mapFrame, svg.node()?.closest(".map-and-detail"), svg.node()?.closest(".stage")]
      .filter(Boolean)
      .forEach((target) => mapResizeObserver.observe(target));
  }
  window.addEventListener("resize", queueCanvasLayout, { passive: true });
  queueCanvasLayout();
  restoreViewport();
  commitZoomTier(true);

  // The profiling harness is deliberately sparse: only request the assets
  // needed by the selected level.  This prevents a perf=1 run from silently
  // downloading and parsing rivers, terrain and lakes that are hidden anyway.
  const coreFailures = [];
  const loadCoreMapAsset = async (filename) => {
    try {
      return await loadMapAsset(filename);
    } catch (error) {
      coreFailures.push(filename);
      console.error(`核心地图数据 ${filename} 加载失败`, error);
      return emptyFeatureCollection();
    }
  };
  Promise.all([
    loadCoreMapAsset("natural-earth-land-110m.geojson"),
    (!PERFORMANCE_MODE || PERF_LEVEL >= 4) ? loadOptionalMapAsset("natural-earth-rivers.geojson") : Promise.resolve(emptyFeatureCollection()),
    (!PERFORMANCE_MODE || PERF_LEVEL >= 8) ? loadOptionalMapAsset("natural-earth-lakes.geojson") : Promise.resolve(emptyFeatureCollection()),
    (!PERFORMANCE_MODE || PERF_LEVEL >= 8) ? loadOptionalMapAsset("natural-earth-terrain.geojson") : Promise.resolve(emptyFeatureCollection()),
    loadCoreMapAsset("strategy-regions.geojson"),
    (!PERFORMANCE_MODE || PERF_LEVEL >= 3) ? loadOptionalMapAsset("strategy-provinces.geojson") : Promise.resolve(null),
  ]).then((datasets) => {
    // Static land and strategic polygons are core; failure in a decorative
    // river/lake/terrain/Dao layer must not erase the usable map.
    // Sanitize once at load time.  The projection remains stable for the
    // lifetime of the map; malformed records never reach Canvas/SVG layers.
    datasets[0] = sanitizeGeographicCollection(datasets[0], "eurasia");
    datasets[1] = sanitizeGeographicCollection(datasets[1], "rivers");
    datasets[2] = sanitizeGeographicCollection(datasets[2], "lakes");
    datasets[3] = sanitizeGeographicCollection(datasets[3], "terrain");
    // Keep the dataset tuple stable while deferring 50m/10m coastlines until
    // their LOD is visible. Dao geometry is loaded only at the tier that can
    // display it (or in normal gameplay).
    datasets.push(null, null);
    buildPhysicalLayers(datasets);
    diagnostics.geometryBuilds += 1;
    window.TianxiaMap.ready = true;
    window.TianxiaMap.degradedAssets = [...coreFailures];
    window.dispatchEvent(new CustomEvent("tianxia-map-ready"));
    if (coreFailures.length || window.TianxiaMap.degradedRegions?.length) {
      window.dispatchEvent(new CustomEvent("tianxia-map-error", {
        detail: {
          failedAssets: [...coreFailures],
          degradedRegions: [...(window.TianxiaMap.degradedRegions || [])],
        },
      }));
    }
  }).catch((error) => {
    console.error("地理数据加载失败", error);
    window.dispatchEvent(new CustomEvent("tianxia-map-error", { detail: error }));
  });
})();
