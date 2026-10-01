import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Production gate for real geometry. The active Tang scenario may use an
// explicitly labelled modern administrative proxy, but Pages must never
// publish synthetic or undocumented geometry.
const root = resolve(import.meta.dirname, "..");
const dataDir = join(root, "public", "data");
const regionsPath = join(dataDir, "strategy-regions.geojson");
const provincesPath = join(dataDir, "strategy-provinces.geojson");
const adjacencyPath = join(dataDir, "strategy-adjacency.json");
const modelPath = join(dataDir, "tang-map-model.json");

const regions = JSON.parse(readFileSync(regionsPath, "utf8"));
const provinces = JSON.parse(readFileSync(provincesPath, "utf8"));
const adjacency = JSON.parse(readFileSync(adjacencyPath, "utf8"));
const model = JSON.parse(readFileSync(modelPath, "utf8"));

if (model?.modelVersion !== "tang-map-model-v2" || model?.mapVersion !== "tang741-v2" || model?.historyDataVersion !== "tang-history-v1") {
  throw new Error("唐代地图模型版本不匹配");
}
if (model?.coordinateReferenceSystem !== "WGS84" || !Array.isArray(model.regions) || model.regions.length !== 100 || !Array.isArray(model.daoCatalog) || model.daoCatalog.length !== 15) {
  throw new Error("唐代地图模型必须包含 WGS84 与100个战略区、15道目录");
}
const modelRegionIds = new Set(model.regions.map((region) => region.id));
if (modelRegionIds.size !== 100 || model.regions.some((region) => !region.geometryId || !region.daoId || !Array.isArray(region.nameHistory) || !Array.isArray(region.neighbors))) {
  throw new Error("唐代地图模型的 region 字段不完整或 ID 不唯一");
}
for (const dao of model.daoCatalog) {
  const range = model.daoRegionRanges?.[dao.id];
  const actual = model.regions.filter((region) => region.daoId === dao.id).length;
  if (!Number.isInteger(range?.min) || !Number.isInteger(range?.max) || range.min < 1 || range.max > 100 || range.min > range.max || actual < range.min || actual > range.max) {
    throw new Error(`唐代${dao.name}战略区数量超出宽范围校验；实际 ${actual}，允许 ${range?.min ?? "?"}–${range?.max ?? "?"}`);
  }
}
if (!Array.isArray(model.frontierRegions) || !model.frontierRegions.some((entry) => entry.kind === "frontier_region") || !model.frontierRegions.some((entry) => entry.kind === "protectorate_region") || !model.frontierRegions.some((entry) => entry.kind === "military_command")) {
  throw new Error("边疆/都护府/军事辖区模型不完整");
}

if (regions?.type !== "FeatureCollection" || !Array.isArray(regions.features) || regions.features.length < 80) {
  throw new Error("生产地图必须是至少包含80个战略区的 GeoJSON FeatureCollection");
}
if (provinces?.type !== "FeatureCollection" || provinces.features.length !== 15) {
  throw new Error("生产地图必须包含唐代开元十五道 GeoJSON 边界");
}

const geometryMetadataText = [regions.metadata?.geometryRole, regions.metadata?.sourceStatus,
  ...regions.features.map((feature) => [feature.properties?.geometrySource, feature.properties?.geometry_status, feature.properties?.sourceStatus].join(" ")),
].join(" ");
if (/voronoi|thiessen|tessellation|synthetic|gameplay geometry/i.test(geometryMetadataText)) {
  throw new Error("战略区几何仍标记为临时/合成数据；替换为有明确发布授权的历史 polygon 后才能部署");
}
if (!regions.metadata?.sourceUrl || !regions.metadata?.license || !regions.metadata?.historicalFrame) {
  throw new Error("战略区 GeoJSON 缺少 sourceUrl、license 或 historicalFrame 元数据");
}

const license = String(regions.metadata.license);
const publicLicense = /^(public domain|cc0(?:\s+1\.0)?|cc by(?:\s+4\.0)?|cc by-sa(?:\s+4\.0)?|odbl(?:\s+1\.0)?)$/i.test(license.trim());
if (!publicLicense) {
  throw new Error(`战略区 GeoJSON 的许可不是公开可再分发许可：${license}`);
}

const ids = new Set();
const bounds = { minLongitude: 68, maxLongitude: 142, minLatitude: 4, maxLatitude: 56 };
function checkCoordinates(value, id) {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number") {
    const [longitude, latitude] = value;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)
      || longitude < bounds.minLongitude || longitude > bounds.maxLongitude
      || latitude < bounds.minLatitude || latitude > bounds.maxLatitude) {
      throw new Error(`战略区 ${id} 含越出东亚战略视图的坐标 (${longitude}, ${latitude})`);
    }
    return;
  }
  value.forEach((child) => checkCoordinates(child, id));
}

for (const feature of regions.features) {
  const id = feature?.properties?.region_id;
  if (!id || ids.has(id)) throw new Error(`战略区缺少唯一 region_id：${id || "(empty)"}`);
  if (!["Polygon", "MultiPolygon"].includes(feature.geometry?.type)) throw new Error(`战略区 ${id} 不是 Polygon/MultiPolygon`);
  ids.add(id);
  if (!modelRegionIds.has(id) || feature.properties?.geometry_id !== `region-${id}`) throw new Error(`战略区 ${id} 未与唐代模型 geometryId 对齐`);
  checkCoordinates(feature.geometry.coordinates, id);
}

const provinceIds = new Set();
for (const feature of provinces.features) {
  const id = feature?.properties?.province_id;
  if (!id || provinceIds.has(id)) throw new Error(`顶层分组缺少唯一 province_id：${id || "(empty)"}`);
  if (feature.geometry?.type !== "MultiPolygon") throw new Error(`顶层分组 ${id} 不是 MultiPolygon`);
  provinceIds.add(id);
  checkCoordinates(feature.geometry.coordinates, `province:${id}`);
}
if (provinces.metadata?.sourceStatus !== regions.metadata?.sourceStatus) {
  throw new Error("战略区与顶层分组的几何来源状态不一致");
}

const sourceHash = createHash("sha256").update(readFileSync(regionsPath)).digest("hex");
if (adjacency.source !== "strategy-regions.geojson" || adjacency.sourceSha256 !== sourceHash || adjacency.regionCount !== ids.size) {
  throw new Error("邻接缓存不是当前战略区 GeoJSON 的版本");
}

console.log(`生产地图验证通过：${ids.size} 个可交互战略区、${adjacency.edgeCount} 条共享边界邻接边。`);
