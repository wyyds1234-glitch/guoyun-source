import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as d3 from "d3";

// This build step deliberately does not create geography. The checked-in
// GeoJSON is the only source of region geometry; this script validates it and
// derives a compact adjacency cache from shared polygon boundary segments.
// The browser never infers neighbours from centroids or distance thresholds.
const root = resolve(import.meta.dirname, "..");
const dataDir = join(root, "public", "data");
const regionsPath = join(dataDir, "strategy-regions.geojson");
const regions = JSON.parse(readFileSync(regionsPath, "utf8"));

if (regions?.type !== "FeatureCollection" || !Array.isArray(regions.features)) {
  throw new Error("strategy-regions.geojson 必须是 FeatureCollection");
}

const quantize = (value) => Math.round(Number(value) * 1e6) / 1e6;
const pointKey = ([longitude, latitude]) => `${quantize(longitude)},${quantize(latitude)}`;
const segmentKey = (a, b) => [pointKey(a), pointKey(b)].sort().join("|");
const featureId = (feature) => feature?.properties?.region_id ?? feature?.properties?.id;
const featureById = new Map();
for (const feature of regions.features) {
  const id = featureId(feature);
  if (!id || featureById.has(id)) throw new Error(`战略区缺少唯一 region_id：${id || "(empty)"}`);
  if (!["Polygon", "MultiPolygon"].includes(feature.geometry?.type)) {
    throw new Error(`战略区 ${id} 的 geometry 必须是 Polygon 或 MultiPolygon`);
  }
  featureById.set(id, feature);
}

function ringsOf(feature) {
  if (feature.geometry.type === "Polygon") return feature.geometry.coordinates;
  return feature.geometry.coordinates.flat();
}

// A valid shared boundary is represented by the same segment in both
// polygons. Quantisation only absorbs floating point noise; it does not use
// centroids, distance thresholds, or a synthetic nearest-neighbour graph.
const segments = new Map();
for (const feature of regions.features) {
  const id = featureId(feature);
  for (const ring of ringsOf(feature)) {
    for (let index = 0; index < ring.length - 1; index += 1) {
      const a = ring[index];
      const b = ring[index + 1];
      if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) continue;
      const key = segmentKey(a, b);
      if (pointKey(a) === pointKey(b)) continue;
      const entries = segments.get(key) || [];
      if (!entries.some((entry) => entry.regionId === id)) entries.push({ regionId: id, a, b });
      segments.set(key, entries);
    }
  }
}

const pairStats = new Map();
const pairKey = (a, b) => [a, b].sort().join("|");
for (const entries of segments.values()) {
  const uniqueEntries = entries.filter((entry, index) => entries.findIndex((other) => other.regionId === entry.regionId) === index);
  if (uniqueEntries.length < 2) continue;
  for (let left = 0; left < uniqueEntries.length; left += 1) {
    for (let right = left + 1; right < uniqueEntries.length; right += 1) {
      const a = uniqueEntries[left].regionId;
      const b = uniqueEntries[right].regionId;
      const key = pairKey(a, b);
      const previous = pairStats.get(key) || { a, b, segmentCount: 0, sharedBoundaryKm: 0 };
      previous.segmentCount += 1;
      previous.sharedBoundaryKm += d3.geoDistance(uniqueEntries[left].a, uniqueEntries[left].b) * 6371;
      pairStats.set(key, previous);
    }
  }
}

const centroid = (feature) => d3.geoCentroid(feature);
const distanceKm = (a, b) => d3.geoDistance(centroid(a), centroid(b)) * 6371;
const routeKind = (a, b, distance) => {
  const at = a.properties.type;
  const bt = b.properties.type;
  const terrain = `${a.properties.terrain || ""}${b.properties.terrain || ""}`;
  if (at === "gate" || bt === "gate") return "pass";
  if (at === "port" && bt === "port" && distance < 520) return "water";
  if (/山|高原|丘陵|关隘|山道/.test(terrain)) return "mountain";
  if (/黄河|长江|渡口|河网|水网/.test(terrain)) return "river";
  return "road";
};
const atPort = (feature) => feature?.properties?.type === "port";

const edges = [...pairStats.values()].map((stat) => {
  const a = featureById.get(stat.a);
  const b = featureById.get(stat.b);
  const distance = distanceKm(a, b);
  const kind = routeKind(a, b, distance);
  const terrain = [a.properties.terrain, b.properties.terrain].filter(Boolean).join(" · ");
  return {
    a: stat.a,
    b: stat.b,
    from: stat.a,
    to: stat.b,
    type: "shared-boundary",
    distanceKm: Math.round(distance),
    distance: Math.round(distance),
    sharedBoundaryKm: Math.round(stat.sharedBoundaryKm * 100) / 100,
    segmentCount: stat.segmentCount,
    terrain,
    river: kind === "river",
    river_crossing: kind === "river",
    road: kind === "road" || kind === "mountain",
    pass: kind === "pass",
    port: atPort(a) || atPort(b),
    sea_route: kind === "water",
    sea: false,
    movement_cost: { road: 1, water: 0.85, river: 1.25, mountain: 1.45, pass: 1.65 }[kind] || 1,
    kind,
  };
}).sort((left, right) => left.a.localeCompare(right.a) || left.b.localeCompare(right.b));

if (!edges.length) throw new Error("GeoJSON 中没有发现共享边界，拒绝生成邻接图");

const sourceHash = createHash("sha256").update(readFileSync(regionsPath)).digest("hex");
const adjacency = {
  version: 1,
  mapVersion: "tang741-v2",
  source: "strategy-regions.geojson",
  sourceSha256: sourceHash,
  relation: "shared-polygon-boundary",
  regionCount: featureById.size,
  edgeCount: edges.length,
  edges,
};
writeFileSync(join(dataDir, "strategy-adjacency.json"), `${JSON.stringify(adjacency)}\n`);
writeFileSync(join(dataDir, "strategy-adjacency.js"), `window.STRATEGY_MAP_ADJACENCY = ${JSON.stringify(adjacency)};\n`);
console.log(`写入 ${featureById.size} 个战略区的 ${edges.length} 条共享边界邻接边`);
