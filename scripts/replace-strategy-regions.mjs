import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Replace the old scaffold with unions of real, openly licensed modern
// administrative polygons. The output is intentionally labelled as a Tang
// scenario proxy: it is not a claim that present-day county boundaries are
// Tang administrative boundaries. No Voronoi cells or hand-drawn geometry are
// created here; every output coordinate comes from an input polygon.
const root = resolve(import.meta.dirname, "..");
const dataDir = join(root, "public", "data");
const chinaPath = process.argv[2] || "/private/tmp/gb_chn_adm2.geojson";
const naturalEarthPath = process.argv[3] || "/private/tmp/ne_admin1.geojson";
const sourceRows = readFileSync(join(root, "public", "regions.js"), "utf8");

const rows = [...sourceRows.matchAll(/\["([^\"]+)", "([^\"]+)", "([^\"]+)", "([^\"]+)", ([0-9.-]+), ([0-9.-]+), "([^\"]+)", "([^\"]+)"/g)]
  .map((match) => ({
    id: match[1],
    name: match[2],
    admin: match[3],
    province: match[4],
    lon: Number(match[5]),
    lat: Number(match[6]),
    type: match[7],
    terrain: match[8],
  }));

if (rows.length !== 100) throw new Error(`regions.js 应包含100个战略节点，实际为 ${rows.length}`);

const daoForRegion = (id, legacy) => {
  if (legacy === "si") {
    if (["changan", "gaoling", "huaili"].includes(id)) return "jingji";
    if (["luoyang", "huai", "hulao"].includes(id)) return "duji";
    return "guannei";
  }
  if (["yu", "yan", "qing"].includes(legacy)) return "henan";
  if (["ji", "you"].includes(legacy)) return "hebei";
  if (legacy === "bing") return "hedong";
  if (legacy === "liang") return "longyou";
  if (legacy === "xu") return "huainan";
  if (legacy === "jiao") return "lingnan";
  if (legacy === "jing") return ["quanling", "chenzhou"].includes(id) ? "shannan_west" : "shannan_east";
  if (legacy === "yang") return ["shanyin", "wuxian"].includes(id) ? "jiangnan_east" : id === "nanchang" ? "jiangnan_west" : "huainan";
  if (legacy === "yi") {
    if (["nanzheng", "jiangzhou", "jiange", "yangping"].includes(id)) return "shannan_west";
    if (["qielan", "qiongdu", "dianchi", "buwei"].includes(id)) return "qianzhong";
    return "jiannan";
  }
  return "henan";
};
rows.forEach((row) => { row.province = daoForRegion(row.id, row.province); });

function readCollection(path) {
  const collection = JSON.parse(readFileSync(path, "utf8"));
  if (collection.type !== "FeatureCollection") throw new Error(`${path} 不是 FeatureCollection`);
  return collection.features.filter((feature) => ["Polygon", "MultiPolygon"].includes(feature.geometry?.type));
}

function ringContains([x, y], ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index] || [];
    const [xj, yj] = ring[previous] || [];
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function geometryContains(geometry, point) {
  if (geometry.type === "Polygon") {
    const [outer, ...holes] = geometry.coordinates || [];
    if (!outer || !ringContains(point, outer)) return false;
    return !holes.some((hole) => ringContains(point, hole));
  }
  return (geometry.coordinates || []).some((polygon) => geometryContains({ type: "Polygon", coordinates: polygon }, point));
}

function bounds(geometry) {
  const result = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (value) => {
    if (typeof value?.[0] === "number") {
      result[0] = Math.min(result[0], value[0]);
      result[1] = Math.min(result[1], value[1]);
      result[2] = Math.max(result[2], value[0]);
      result[3] = Math.max(result[3], value[1]);
      return;
    }
    (value || []).forEach(visit);
  };
  visit(geometry.coordinates);
  return result;
}

function ringsOf(geometry) {
  if (geometry.type === "Polygon") return geometry.coordinates || [];
  return (geometry.coordinates || []).flat();
}

function polygonsOf(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  return geometry.coordinates || [];
}

function simplifyRing(ring, tolerance = 0.03) {
  if (!Array.isArray(ring) || ring.length < 8) return ring;
  const points = ring[0]?.[0] === ring.at(-1)?.[0] && ring[0]?.[1] === ring.at(-1)?.[1] ? ring.slice(0, -1) : ring.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const distance = (point, start, end) => {
    const [px, py] = point;
    const [sx, sy] = start;
    const [ex, ey] = end;
    const dx = ex - sx;
    const dy = ey - sy;
    if (!dx && !dy) return Math.hypot(px - sx, py - sy);
    const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (sx + t * dx), py - (sy + t * dy));
  };
  const visit = (start, end) => {
    let maxDistance = tolerance;
    let split = -1;
    for (let index = start + 1; index < end; index += 1) {
      const current = distance(points[index], points[start], points[end]);
      if (current > maxDistance) { maxDistance = current; split = index; }
    }
    if (split >= 0) { keep[split] = 1; visit(start, split); visit(split, end); }
  };
  visit(0, points.length - 1);
  const simplified = points.filter((_, index) => keep[index]);
  // Preserve a valid polygon ring when a tiny island/estuary collapses to
  // fewer than three unique vertices at this tolerance.
  if (simplified.length < 3) return ring;
  simplified.push(simplified[0]);
  return simplified.length >= 4 ? simplified : ring;
}

function simplifyPolygons(polygons) {
  return polygons.map((polygon) => polygon.map((ring) => simplifyRing(ring)));
}

function pointKey([longitude, latitude]) {
  return `${Math.round(Number(longitude) * 1e6)},${Math.round(Number(latitude) * 1e6)}`;
}

function segmentKey(a, b) {
  return [pointKey(a), pointKey(b)].sort().join("|");
}

function centroid(feature) {
  const [minX, minY, maxX, maxY] = bounds(feature.geometry);
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

const china = readCollection(chinaPath).map((feature, index) => ({ ...feature, _index: index, _bounds: bounds(feature.geometry) }));
const naturalEarth = readCollection(naturalEarthPath).map((feature, index) => ({ ...feature, _index: index, _bounds: bounds(feature.geometry) }));

function findContaining(features, row, used) {
  const point = [row.lon, row.lat];
  return features.find((feature) => {
    const b = feature._bounds;
    return !used.has(feature) && point[0] >= b[0] && point[0] <= b[2] && point[1] >= b[1] && point[1] <= b[3]
      && geometryContains(feature.geometry, point);
  });
}

const usedChinaSeeds = new Set();
const seeds = rows.map((row, regionIndex) => {
  const chinaFeature = findContaining(china, row, usedChinaSeeds);
  if (chinaFeature) {
    usedChinaSeeds.add(chinaFeature);
    return { row, regionIndex, feature: chinaFeature, sourceGroup: "china" };
  }
  const naturalFeature = findContaining(naturalEarth, row, new Set());
  if (!naturalFeature) throw new Error(`没有找到包含 ${row.id} (${row.lon},${row.lat}) 的公开真实 polygon`);
  return { row, regionIndex, feature: naturalFeature, sourceGroup: "external" };
});

// Build county topology from exact shared boundary segments. A multi-source
// BFS assigns every mainland county to one of the 96 China seed regions, so
// the output regions cover the real source geography and remain adjacent.
const segmentOwners = new Map();
for (const feature of china) {
  for (const ring of ringsOf(feature.geometry)) {
    for (let index = 0; index < ring.length - 1; index += 1) {
      const a = ring[index];
      const b = ring[index + 1];
      if (!Array.isArray(a) || !Array.isArray(b) || pointKey(a) === pointKey(b)) continue;
      const key = segmentKey(a, b);
      const owners = segmentOwners.get(key) || [];
      if (!owners.includes(feature._index)) owners.push(feature._index);
      segmentOwners.set(key, owners);
    }
  }
}

const countyNeighbors = Array.from({ length: china.length }, () => new Set());
for (const owners of segmentOwners.values()) {
  for (let left = 0; left < owners.length; left += 1) {
    for (let right = left + 1; right < owners.length; right += 1) {
      countyNeighbors[owners[left]].add(owners[right]);
      countyNeighbors[owners[right]].add(owners[left]);
    }
  }
}

// A historical pass such as Hangu falls inside a modern Chinese county that
// is already used as another seed. Re-anchor that pass to an unused county
// sharing an exact boundary with the containing county, keeping it inside the
// real mainland topology instead of leaving an isolated Natural Earth island.
const usedSeedCountyIds = new Set(seeds.filter((item) => item.sourceGroup === "china").map((item) => item.feature._index));
for (const seed of seeds.filter((item) => item.sourceGroup === "external")) {
  const containing = findContaining(china, seed.row, new Set());
  if (!containing) continue;
  const candidates = [...countyNeighbors[containing._index]]
    .filter((index) => !usedSeedCountyIds.has(index))
    .sort((left, right) => {
      const point = [seed.row.lon, seed.row.lat];
      const leftCenter = centroid(china[left]);
      const rightCenter = centroid(china[right]);
      return ((leftCenter[0] - point[0]) ** 2 + (leftCenter[1] - point[1]) ** 2)
        - ((rightCenter[0] - point[0]) ** 2 + (rightCenter[1] - point[1]) ** 2);
    });
  if (!candidates.length) continue;
  seed.feature = china[candidates[0]];
  seed.sourceGroup = "china";
  usedSeedCountyIds.add(candidates[0]);
}

const seedByCounty = new Map();
const queue = [];
for (const seed of seeds.filter((item) => item.sourceGroup === "china")) {
  seedByCounty.set(seed.feature._index, seed.regionIndex);
  queue.push(seed.feature._index);
}
let cursor = 0;
while (cursor < queue.length) {
  const current = queue[cursor++];
  const owner = seedByCounty.get(current);
  for (const neighbor of countyNeighbors[current]) {
    if (seedByCounty.has(neighbor)) continue;
    seedByCounty.set(neighbor, owner);
    queue.push(neighbor);
  }
}

// Detached islands or malformed source components are still copied as real
// polygons. Assign them only after the shared-boundary graph is exhausted.
const chinaSeeds = seeds.filter((item) => item.sourceGroup === "china");
const seedCenters = chinaSeeds.map((seed) => ({ regionIndex: seed.regionIndex, point: centroid(seed.feature) }));
for (const feature of china) {
  if (seedByCounty.has(feature._index)) continue;
  const center = centroid(feature);
  let nearest = seedCenters[0];
  let nearestDistance = Infinity;
  for (const candidate of seedCenters) {
    const distance = (center[0] - candidate.point[0]) ** 2 + (center[1] - candidate.point[1]) ** 2;
    if (distance < nearestDistance) { nearest = candidate; nearestDistance = distance; }
  }
  seedByCounty.set(feature._index, nearest.regionIndex);
}

const groups = new Map(rows.map((row, index) => [index, []]));
for (const feature of china) groups.get(seedByCounty.get(feature._index)).push(feature.geometry);
for (const seed of seeds.filter((item) => item.sourceGroup === "external")) groups.get(seed.regionIndex).push(seed.feature.geometry);

const sourceForRegion = (seed) => {
  const properties = seed.feature.properties || {};
  return {
    geometrySource: seed.sourceGroup === "china" ? "geoBoundaries CHN ADM2 union" : "Natural Earth Admin 1",
    modernSeedUnitId: properties.shapeID || properties.ADM2_CODE || properties.adm1_code || null,
    modernSeedUnitName: properties.shapeName || properties.NAME || properties.name || null,
  };
};

const selected = seeds.map((seed) => ({
  type: "Feature",
  geometry: { type: "MultiPolygon", coordinates: groups.get(seed.regionIndex).flatMap(polygonsOf) },
  properties: {
    region_id: seed.row.id,
    id: seed.row.id,
    name: seed.row.name,
    admin: seed.row.admin,
    province: seed.row.province,
    level: "strategic-region",
    type: seed.row.type,
    terrain: seed.row.terrain,
    ...sourceForRegion(seed),
    modernFeatureCount: groups.get(seed.regionIndex).length,
    sourceStatus: "modern-admin-aggregation-proxy",
  },
}));

const provinceIds = [...new Set(rows.map((row) => row.province))];
const provinceFeatures = provinceIds.map((provinceId) => ({
  type: "Feature",
  geometry: {
    type: "MultiPolygon",
    coordinates: simplifyPolygons(selected.filter((feature) => feature.properties.province === provinceId).flatMap((feature) => polygonsOf(feature.geometry))),
  },
  properties: {
    province_id: provinceId,
    province: provinceId,
    level: "top-level-scenario-group",
    geometrySource: "union-of-modern-admin-aggregation-proxies",
    sourceStatus: "modern-admin-aggregation-proxy",
  },
}));

const metadata = {
  mapVersion: "tang741-v1",
  coordinateReferenceSystem: "WGS84",
  historicalFrame: "Tang 741 CE scenario; modern administrative aggregation proxy",
  regionIdField: "region_id",
  geometryRole: "interactive strategic-region hitboxes",
  sourceUrl: "https://www.geoboundaries.org/api/current/gbOpen/CHN/ADM2/",
  fallbackSourceUrl: "https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/",
  license: "Public Domain",
  sourceStatus: "modern-admin-aggregation-proxy",
  sourceNote: "Each strategic polygon is a union of openly licensed modern county/admin-1 polygons connected through exact shared boundaries. It is a playable geography proxy, not a claim about Tang administrative boundaries.",
};

writeFileSync(join(dataDir, "strategy-regions.geojson"), `${JSON.stringify({ type: "FeatureCollection", metadata, features: selected })}\n`);
writeFileSync(join(dataDir, "strategy-provinces.geojson"), `${JSON.stringify({ type: "FeatureCollection", metadata: { ...metadata, geometryRole: "top-level scenario-group overlay" }, features: provinceFeatures })}\n`);
console.log(`已替换 ${selected.length} 个战略区 polygon；${provinceFeatures.length} 个顶层分组；${queue.length} 个县级节点通过共享边界拓扑完成聚合。`);
