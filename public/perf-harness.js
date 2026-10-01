(() => {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const level = Math.max(0, Math.min(8, Number(params.get("perf") || 0) || 0));
  if (!level) return;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const model = window.TANG_MAP_MODEL || { regions: [], cityNodes: [] };
  const regionById = new Map((model.regions || []).map((region) => [region.id, region]));
  const enabled = {
    political: level >= 2,
    borders: level >= 3,
    rivers: level >= 4,
    cities: level >= 5,
    labels: level >= 6,
    armies: level >= 7,
  };
  const layerMinLevel = { political: 2, borders: 3, rivers: 4, cities: 5, labels: 6, armies: 7 };
  const state = { level, enabled, selectedRegionId: null, ready: false, mapRenders: 0 };
  window.TianxiaPerformanceHarness = state;

  const $ = (selector, root = document) => root.querySelector(selector);
  const svgEl = (tag, attrs = {}) => {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  };
  const htmlEl = (tag, className, text = "") => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const setHidden = (node, hidden) => {
    if (!node) return;
    // SVGElement.hidden is not consistently reflected across browsers; use
    // the attribute so SVG layers really disappear instead of merely storing
    // an expando property.
    node.toggleAttribute("hidden", Boolean(hidden));
    node.style.display = hidden ? "none" : "";
  };

  function createHarnessShell() {
    const mapFrame = $(".map-frame");
    if (!mapFrame) return null;
    mapFrame.querySelectorAll(".map-context-action, .map-key, .map-attribution, .map-stamp, .map-tooltip").forEach((node) => node.remove());
    const root = htmlEl("main", "map-performance-harness");
    root.id = "mapPerformanceHarness";
    const hud = htmlEl("section", "perf-debug-hud");
    hud.innerHTML = `<div class="perf-debug-title"><b>地图性能实验台</b><span>perf=${level} · 只加载地图，不加载游戏系统</span></div>`;
    const toggles = htmlEl("div", "perf-layer-toggles");
    const labels = { political: "政治色", borders: "边境", rivers: "河流", cities: "城市", labels: "标签", armies: "军队" };
    Object.entries(labels).forEach(([key, label]) => {
      const button = htmlEl("button", "perf-layer-toggle", label);
      button.type = "button";
      button.dataset.perfLayer = key;
      button.disabled = level < layerMinLevel[key];
      if (button.disabled) button.title = `perf=${layerMinLevel[key]} 才加载此图层`;
      button.setAttribute("aria-pressed", String(enabled[key]));
      button.addEventListener("click", () => {
        enabled[key] = !enabled[key];
        button.setAttribute("aria-pressed", String(enabled[key]));
        applyLayers();
      });
      toggles.appendChild(button);
    });
    hud.appendChild(toggles);
    const metrics = htmlEl("div", "perf-debug-metrics");
    [
      ["fps", "FPS"], ["avg", "avg frame"], ["worst", "worst frame"], ["nodes", "SVG nodes"],
      ["labels", "visible labels"], ["armies", "visible armies"], ["zoom", "zoom"], ["renders", "map layer updates"],
    ].forEach(([key, label]) => {
      const item = htmlEl("span", "perf-metric");
      item.innerHTML = `<small>${label}</small><strong data-perf-metric="${key}">—</strong>`;
      metrics.appendChild(item);
    });
    hud.appendChild(metrics);
    root.append(hud, mapFrame);
    document.body.replaceChildren(root);
    document.documentElement.classList.add("perf-mode");
    return root;
  }

  function regionColor(region) {
    const colors = { tang: "#aa8542", rebel: "#9d493d", yan: "#56758a", zhao: "#6d6089", neutral: "#68705e" };
    return colors[region?.controllerId] || colors.neutral;
  }

  function applyPoliticalFill() {
    document.querySelectorAll("[data-region-cell]").forEach((path) => {
      const region = regionById.get(path.dataset.regionCell);
      path.style.fill = enabled.political ? regionColor(region) : "transparent";
      path.style.fillOpacity = enabled.political ? "0.42" : "0";
      path.style.stroke = enabled.political ? "rgba(222,198,137,.38)" : "rgba(187,171,127,.28)";
    });
  }

  function applyBorders() {
    document.querySelectorAll("#regionBorderLayer path").forEach((path) => {
      const a = regionById.get(path.dataset.borderA);
      const b = regionById.get(path.dataset.borderB);
      const daoBoundary = !b || a?.daoId !== b?.daoId;
      const politicalBoundary = Boolean(b && a?.controllerId !== b?.controllerId);
      setHidden(path, !(enabled.borders && daoBoundary));
      path.classList.toggle("perf-political-border", politicalBoundary);
      path.style.stroke = politicalBoundary ? "#c86750" : "rgba(223,198,137,.74)";
      path.style.strokeWidth = politicalBoundary ? "2.6" : "1.5";
    });
  }

  function applyViewportCulling() {
    const map = window.TianxiaMap;
    const zoom = map?.transform?.k || 1;
    const shouldCull = zoom >= 7;
    document.querySelectorAll("[data-perf-city], [data-perf-army]").forEach((node) => {
      if (!shouldCull || !map?.isPointVisible) {
        const layerEnabled = node.hasAttribute("data-perf-city") ? enabled.cities : enabled.armies;
        if (layerEnabled) node.removeAttribute("hidden");
        node.removeAttribute("data-viewport-culled");
        return;
      }
      const x = Number(node.dataset.mapAnchorX);
      const y = Number(node.dataset.mapAnchorY);
      const visible = Number.isFinite(x) && Number.isFinite(y) && map.isPointVisible([x, y], 120);
      node.toggleAttribute("hidden", !visible);
      node.toggleAttribute("data-viewport-culled", !visible);
    });
  }

  function applyLayers() {
    applyPoliticalFill();
    applyBorders();
    const riverLayer = $("#riverLayer");
    setHidden(riverLayer, !enabled.rivers);
    document.querySelectorAll("[data-perf-city]").forEach((node) => {
      setHidden(node, !enabled.cities);
      const text = node.querySelector("text");
      setHidden(text, !enabled.labels);
    });
    const provinceLabels = $("#provinceLabelLayer");
    setHidden(provinceLabels, !enabled.labels);
    const armyLayer = $("#armyLayer");
    setHidden(armyLayer, !enabled.armies);
    const frontLayer = $("#movementPathLayer");
    setHidden(frontLayer, !(level >= 8 && enabled.borders));
    if (enabled.labels) window.TianxiaMap?.refreshLabelCollisions?.();
    applyViewportCulling();
  }

  function addCityNodes() {
    const layer = $("#regionLayer");
    const map = window.TianxiaMap;
    if (!layer || !map?.position) return;
    (model.cityNodes || []).forEach((city) => {
      const [x, y] = map.position([city.longitude, city.latitude]);
      const group = svgEl("g", { class: "perf-city-marker", "data-perf-city": city.id, "data-region-id": city.regionId });
      group.append(
        svgEl("circle", { r: city.type === "capital" ? 5 : 3.5, class: city.type === "capital" ? "perf-capital-dot" : "perf-city-dot" }),
      );
      const label = svgEl("text", { x: 8, y: 4, class: "perf-city-label" });
      label.textContent = city.historicalName;
      group.appendChild(label);
      layer.appendChild(group);
      map.registerScreenSpace(group, x, y);
    });
  }

  function addArmyNodes() {
    const layer = $("#armyLayer");
    const map = window.TianxiaMap;
    if (!layer || !map?.position) return;
    [
      ["changan", "唐", "1,860"],
      ["luoyang", "唐", "1,240"],
      ["yecheng", "唐", "980"],
    ].forEach(([regionId, faction, strength]) => {
      const region = regionById.get(regionId);
      if (!region) return;
      const [x, y] = map.position(region.centroid);
      const group = svgEl("g", { class: "perf-army-marker", "data-perf-army": regionId });
      group.append(svgEl("path", { d: "M0 0L0 -20L14 -16L0 -12Z", class: "perf-army-flag" }));
      const text = svgEl("text", { x: 17, y: -6, class: "perf-army-label" });
      text.textContent = `[${faction}] ${strength}`;
      group.appendChild(text);
      layer.appendChild(group);
      map.registerScreenSpace(group, x, y);
    });
  }

  function addFrontPreview() {
    const layer = $("#movementPathLayer");
    const map = window.TianxiaMap;
    const from = regionById.get("yecheng");
    const to = regionById.get("jinyang");
    if (!layer || !map?.position || !from || !to) return;
    const start = map.position(from.centroid);
    const end = map.position(to.centroid);
    layer.appendChild(svgEl("path", { class: "perf-front-preview", d: `M${start[0]} ${start[1]}L${end[0]} ${end[1]}` }));
  }

  function bindRegionInteraction(root) {
    const layer = $("#territoryLayer");
    const tooltip = htmlEl("div", "perf-map-tooltip");
    tooltip.hidden = true;
    root.appendChild(tooltip);
    if (!layer) return;
    const targetFromEvent = (event) => event.target?.closest?.("[data-region-cell]");
    layer.addEventListener("pointermove", (event) => {
      const target = targetFromEvent(event);
      if (!target) return;
      const region = regionById.get(target.dataset.regionCell);
      if (!region) return;
      tooltip.textContent = `${region.historicalName} · ${region.daoName || region.daoId} · ${region.terrain} · 驻军 ${region.garrison}`;
      tooltip.style.transform = `translate3d(${event.clientX + 14}px,${event.clientY + 14}px,0)`;
      tooltip.hidden = false;
      target.classList.add("perf-hover-region");
    }, { passive: true });
    layer.addEventListener("pointerleave", () => {
      tooltip.hidden = true;
      layer.querySelectorAll(".perf-hover-region").forEach((node) => node.classList.remove("perf-hover-region"));
    });
    layer.addEventListener("click", (event) => {
      const target = targetFromEvent(event);
      if (!target) return;
      layer.querySelectorAll(".perf-selected-region").forEach((node) => node.classList.remove("perf-selected-region"));
      target.classList.add("perf-selected-region");
      state.selectedRegionId = target.dataset.regionCell;
    });
  }

  function updateMetrics(now, frameTimes) {
    const metric = (key) => document.querySelector(`[data-perf-metric="${key}"]`);
    const average = frameTimes.length ? frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length : 0;
    const worst = frameTimes.length ? Math.max(...frameTimes) : 0;
    const fps = average > 0 ? 1000 / average : 0;
    const svg = $("#worldMap");
    if (metric("fps")) metric("fps").textContent = `${fps.toFixed(1)}`;
    if (metric("avg")) metric("avg").textContent = `${average.toFixed(1)} ms`;
    if (metric("worst")) metric("worst").textContent = `${worst.toFixed(1)} ms`;
    if (metric("nodes")) metric("nodes").textContent = `${svg?.querySelectorAll("*").length || 0}`;
    // Do not force a synchronous layout just to count labels.  The harness is
    // measuring map rendering, so visibility is represented by the explicit
    // hidden attributes/classes applied at LOD boundaries rather than a
    // getBoundingClientRect() read every half second.
    if (metric("labels")) metric("labels").textContent = `${[...document.querySelectorAll("#mapUi text")].filter((node) => !node.hidden && !node.closest("[hidden]")).length}`;
    if (metric("armies")) metric("armies").textContent = `${[...document.querySelectorAll("[data-perf-army]")].filter((node) => !node.hasAttribute("hidden") && !node.closest("[hidden]")).length}`;
    if (metric("zoom")) metric("zoom").textContent = `${window.TianxiaMap?.transform?.k?.toFixed?.(2) || "1.00"}×`;
    if (metric("renders")) metric("renders").textContent = `${state.mapRenders}（无 React）`;
    void now;
  }

  function startFrameMeter() {
    let last = performance.now();
    let lastReport = last;
    const frameTimes = [];
    const tick = (now) => {
      const delta = now - last;
      last = now;
      if (delta > 0 && delta < 2000) frameTimes.push(delta);
      while (frameTimes.length > 120) frameTimes.shift();
      if (now - lastReport >= 500) {
        updateMetrics(now, frameTimes);
        lastReport = now;
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  }

  const root = createHarnessShell();
  if (!root) return;
  const onReady = () => {
    if (state.ready) return;
    state.ready = true;
    state.mapRenders += 1;
    if (level >= 5) addCityNodes();
    if (level >= 7) addArmyNodes();
    if (level >= 8) addFrontPreview();
    bindRegionInteraction(root);
    applyLayers();
    // The map promise can resolve between the geo-map script and this
    // harness script. Re-apply visibility on the next frame so the requested
    // perf level wins over any final map-layer initialization regardless of
    // script/cache timing.
    window.requestAnimationFrame(applyLayers);
    startFrameMeter();
  };
  if (window.TianxiaMap?.ready) onReady();
  else window.addEventListener("tianxia-map-ready", onReady, { once: true });
  window.addEventListener("tianxia-map-interaction-end", applyViewportCulling);
})();
