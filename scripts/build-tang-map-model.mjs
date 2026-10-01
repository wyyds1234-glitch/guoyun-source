import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// This is the historical/game layer. It never creates geometry: every
// geometryId below points to a feature already present in strategy-regions.geojson.
// The assignment is a playable aggregation of Tang-era places, not a claim that
// a modern county polygon is a Tang administrative boundary.
const root = resolve(import.meta.dirname, "..");
const dataDir = join(root, "public", "data");
const regionsSource = readFileSync(join(root, "public", "regions.js"), "utf8");
const regionsGeoJson = JSON.parse(readFileSync(join(dataDir, "strategy-regions.geojson"), "utf8"));
const adjacency = JSON.parse(readFileSync(join(dataDir, "strategy-adjacency.json"), "utf8"));

const daoCatalog = [
  ["jingji", "京畿道", "京畿"],
  ["guannei", "关内道", "关内"],
  ["duji", "都畿道", "都畿"],
  ["henan", "河南道", "河南"],
  ["hedong", "河东道", "河东"],
  ["hebei", "河北道", "河北"],
  ["longyou", "陇右道", "陇右"],
  ["shannan_east", "山南东道", "山南东"],
  ["shannan_west", "山南西道", "山南西"],
  ["jiannan", "剑南道", "剑"],
  ["huainan", "淮南道", "淮南"],
  ["jiangnan_east", "江南东道", "江南东"],
  ["jiangnan_west", "江南西道", "江南西"],
  ["qianzhong", "黔中道", "黔"],
  ["lingnan", "岭南道", "岭南"],
].map(([id, name, shortName], order) => ({ id, name, shortName, order: order + 1, kind: "dao" }));
const daoById = new Map(daoCatalog.map((dao) => [dao.id, dao]));

// Region membership is assigned by its named historical/game location, never
// to satisfy a target count. Broad bounds below only catch empty/overflow Dao
// groups; they do not redistribute or force regions.
const assignments = {
  jingji: ["changan", "gaoling", "huaili", "tongguan", "hangu", "wuguan"],
  guannei: ["fuping", "linjing", "jiuyuan", "yunzhong", "gaoliu", "didao", "xiabian"],
  duji: ["luoyang", "huai", "hulao", "hongnong", "yangdi"],
  henan: ["chenliu", "puyang", "fenggao", "changyi", "dingtao", "qufu", "pingyu", "xiayi", "qiao", "chenxian", "huangxian", "linzi", "kaiyang"],
  hedong: ["anyi", "zhangzi", "jinyang", "lishi", "yinguan", "fushi", "juyang"],
  hebei: ["yecheng", "yingtao", "yuanshi", "lunu", "xindu", "lecheng", "ganling", "handan", "bohai", "zhuo", "ji_city", "changliao", "yuyang", "tuyin", "yangle", "liaodong", "gaogouli", "chaoxian"],
  longyou: ["yunwu", "wuwei", "zhangye", "jiuquan", "dunhuang", "longxian"],
  shannan_east: ["nanyang", "jiangling", "xiling", "changsha", "linyuan", "tancheng"],
  shannan_west: ["nanzheng", "jiangzhou", "quanling", "dongpingling"],
  jiannan: ["luoxian", "chengdu", "wuyang", "jiange", "yangping", "pingyuan", "ju"],
  huainan: ["pengcheng", "guangling", "xiapi", "liyang", "shu"],
  jiangnan_east: ["wanling", "shanyin", "wuxian"],
  jiangnan_west: ["nanchang", "chenzhou"],
  qianzhong: ["qielan", "qiongdu", "dianchi", "buwei"],
  lingnan: ["panyu", "cangwu", "bushan", "hepu", "longbian", "xupu", "xijuan"],
};
const daoForRegion = new Map(Object.entries(assignments).flatMap(([daoId, ids]) => ids.map((id) => [id, daoId])));
// Guard against missing/duplicated assignment data without enforcing an
// artificial per-circuit quota. These broad limits are sanity checks only.
const daoRegionRanges = Object.fromEntries(daoCatalog.map((dao) => [dao.id, { min: 1, max: 25 }]));
for (const dao of daoCatalog) {
  const count = assignments[dao.id]?.length || 0;
  const range = daoRegionRanges[dao.id];
  if (count < range.min || count > range.max) throw new Error(`${dao.id} 道区域数超出宽范围校验；请核对归属，不要为配额搬动区域`);
}
if (daoForRegion.size !== 100 || new Set(daoForRegion.keys()).size !== 100) throw new Error("唐代战略区分组必须覆盖100个且不得重复");

const rowPattern = /\["([^\"]+)", "([^\"]+)", "([^\"]+)", "([^\"]+)", ([0-9.-]+), ([0-9.-]+), "([^\"]+)", "([^\"]+)", ([0-9.]+), ([0-9.]+), ([0-9.]+)\]/g;
const rows = [...regionsSource.matchAll(rowPattern)].map((match) => ({
  id: match[1], fallbackName: match[2], prefectureName: match[3], lon: Number(match[5]), lat: Number(match[6]), type: match[7], terrain: match[8], population: Number(match[9]), agriculture: Number(match[10]), fortification: Number(match[11]),
}));
if (rows.length !== 100) throw new Error(`regions.js 应包含100个战略区，实际为 ${rows.length}`);
const rowById = new Map(rows.map((row) => [row.id, row]));
const featureById = new Map(regionsGeoJson.features.map((feature) => [feature.properties?.region_id || feature.properties?.id, feature]));

function walkCoordinates(value, visit) {
  if (typeof value?.[0] === "number") return visit(value);
  for (const child of value || []) walkCoordinates(child, visit);
}
function bboxCentroid(geometry) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  walkCoordinates(geometry.coordinates, ([lon, lat]) => {
    bounds[0] = Math.min(bounds[0], lon); bounds[1] = Math.min(bounds[1], lat);
    bounds[2] = Math.max(bounds[2], lon); bounds[3] = Math.max(bounds[3], lat);
  });
  if (!bounds.every(Number.isFinite)) return [0, 0];
  return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
}

const specialNames = {
  longxian: [{ fromYear: 618, toYear: 741, name: "秦州" }, { fromYear: 742, toYear: 757, name: "天水郡" }, { fromYear: 758, toYear: null, name: "秦州" }],
  luoyang: [{ fromYear: 618, toYear: null, name: "河南府" }],
  changan: [{ fromYear: 618, toYear: null, name: "京兆府" }],
  jinyang: [{ fromYear: 618, toYear: null, name: "太原府" }],
  ji_city: [{ fromYear: 618, toYear: null, name: "幽州" }],
  yecheng: [{ fromYear: 618, toYear: null, name: "相州" }],
  panyu: [{ fromYear: 618, toYear: null, name: "广州" }],
};
const regionNameHistory = (row) => specialNames[row.id] || [{ fromYear: 618, toYear: null, name: row.fallbackName }];
const currentName = (row) => regionNameHistory(row).find((entry) => entry.fromYear <= 741 && (entry.toYear == null || 741 <= entry.toYear))?.name || row.fallbackName;

const frontierByRegion = new Map([
  ["wuwei", "hexi"], ["zhangye", "hexi"], ["jiuquan", "hexi"], ["dunhuang", "hexi"],
  ["changliao", "liaodong"], ["liaodong", "liaodong"], ["gaogouli", "liaodong"], ["chaoxian", "liaodong"], ["yangle", "liaodong"],
  ["longbian", "annan"], ["xupu", "annan"], ["xijuan", "annan"],
]);
const militaryByFrontier = { hexi: "hexi_jiedushi", liaodong: "pinglu_jiedushi", annan: "annan_duhufu" };
const frontierCatalog = [
  { id: "hexi", name: "河西军镇", kind: "frontier_region", daoId: "longyou", militaryCommandId: "hexi_jiedushi", protectorateIds: ["anxi", "beiting"] },
  { id: "anxi", name: "安西都护府", kind: "protectorate_region", militaryCommandId: "anxi_duhufu", parentFrontierId: "hexi" },
  { id: "beiting", name: "北庭都护府", kind: "protectorate_region", militaryCommandId: "beiting_duhufu", parentFrontierId: "hexi" },
  { id: "annan", name: "安南都护府", kind: "protectorate_region", militaryCommandId: "annan_duhufu", regionIds: ["longbian", "xupu", "xijuan"] },
  { id: "liaodong", name: "辽东边镇", kind: "military_command", militaryCommandId: "pinglu_jiedushi", regionIds: ["liaodong", "gaogouli", "chaoxian", "yangle", "changliao"] },
].map((entry) => ({ ...entry, source: "唐代军镇/都护府历史层" }));

const citySeeds = [
  ["changan", "长安", "capital", 108.8600, 34.2700, "jingji"], ["luoyang", "洛阳", "capital", 112.4244, 34.6586, "duji"], ["jinyang", "太原", "capital", 112.5500, 37.8667, "hedong"], ["ji_city", "幽州", "capital", 116.3900, 39.9000, "hebei"], ["yecheng", "魏州", "capital", 114.4700, 36.3400, "hebei"], ["zhuo", "范阳", "city", 115.9918, 39.4887, "hebei"], ["qiao", "汴州", "city", 116.5500, 33.8800, "henan"], ["guangling", "扬州", "port", 119.4300, 32.3900, "huainan"], ["wuxian", "苏州", "port", 120.6200, 31.3100, "jiangnan_east"], ["shanyin", "杭州", "port", 120.1600, 30.2500, "jiangnan_east"], ["nanyang", "襄州", "city", 112.5343, 33.0057, "shannan_east"], ["jiangling", "荆州", "city", 112.1900, 30.3500, "shannan_east"], ["chengdu", "成都", "capital", 104.0700, 30.6700, "jiannan"], ["nanzheng", "汉中", "city", 106.9333, 33.0000, "shannan_west"], ["panyu", "广州", "port", 113.2600, 23.1300, "lingnan"],
].map(([id, historicalName, type, lon, lat, daoId]) => ({ id: `city_${id}`, regionId: id, historicalName, nameHistory: [{ fromYear: 618, toYear: null, name: historicalName }], type, longitude: lon, latitude: lat, daoId, source: "项目自有地点元数据；未从CHGIS/TGAZ复制或打包" }));
const passSeeds = [
  ["tongguan", "潼关", 110.25, 34.54], ["hangu", "函谷关", 110.93, 34.63], ["hulao", "虎牢关", 113.15, 34.83], ["wuguan", "武关", 110.59, 33.59], ["jiange", "剑门关", 105.48, 32.19], ["yangping", "阳平关", 106.42, 32.84], ["yinguan", "雁门关", 112.44, 39.33],
].map(([regionId, historicalName, longitude, latitude]) => ({ id: `pass_${regionId}`, regionId, historicalName, nameHistory: [{ fromYear: 618, toYear: null, name: historicalName }], type: "strategic_pass", longitude, latitude, defenseBonus: 0.25, source: "项目自有地点元数据；未从CHGIS/TGAZ复制或打包" }));
const cityIdsByRegion = new Map();
for (const city of citySeeds) cityIdsByRegion.set(city.regionId, [...(cityIdsByRegion.get(city.regionId) || []), city.id]);
const passIdsByRegion = new Map();
for (const pass of passSeeds) passIdsByRegion.set(pass.regionId, [...(passIdsByRegion.get(pass.regionId) || []), pass.id]);

const regions = rows.map((row) => {
  const feature = featureById.get(row.id);
  if (!feature) throw new Error(`战略区 geometry 缺少 ${row.id}`);
  const daoId = daoForRegion.get(row.id);
  const dao = daoById.get(daoId);
  const properties = feature.properties || {};
  const frontierRegionId = frontierByRegion.get(row.id) || null;
  const militaryCommandId = frontierRegionId ? militaryByFrontier[frontierRegionId] : null;
  const neighbors = adjacency.edges.flatMap((edge) => edge.a === row.id ? [edge.b] : edge.b === row.id ? [edge.a] : []);
  const centroid = bboxCentroid(feature.geometry);
  return {
    id: row.id, geometryId: `region-${row.id}`, historicalName: currentName(row), nameHistory: regionNameHistory(row), daoId, daoName: dao.name,
    prefectureId: `prefecture-${row.id}`, prefectureName: row.prefectureName, centroid, terrain: row.terrain, neighbors: [...new Set(neighbors)],
    ownerId: "tang", controllerId: "tang", sovereignId: "tang", militaryCommandId, frontierRegionId,
    population: row.population, agriculture: row.agriculture, commerce: Math.round((row.population + row.agriculture) / 2), food: row.agriculture,
    supplyCapacity: Math.max(20, Math.round(row.agriculture * 1.35)), fortification: row.fortification, garrison: Math.max(40, Math.round(row.fortification * 4)),
    unrest: 8, loyalty: 82, strategicValue: Math.round((row.population + row.fortification * 2) / 3), cityIds: cityIdsByRegion.get(row.id) || [], roadNodeIds: [...(cityIdsByRegion.get(row.id) || []), ...(passIdsByRegion.get(row.id) || [])],
    geometrySource: properties.geometrySource || "Natural Earth/geoBoundaries offline geometry", sourceFeatureId: properties.modernSeedUnitId || null,
    daoAssignmentConfidence: "provisional",
    source: ["Natural Earth", "geoBoundaries", "project-curated Tang metadata"],
  };
});

const model = {
  modelVersion: "tang-map-model-v2", mapVersion: "tang741-v2", historyDataVersion: "tang-history-v1", saveSchemaVersion: 5,
  coordinateReferenceSystem: "WGS84", activeYear: 741, scenario: "tang741", administrativeSystem: "开元十五道",
  sources: {
    geography: [{ name: "Natural Earth", url: "https://www.naturalearthdata.com/", license: "Public Domain" }, { name: "geoBoundaries", url: "https://www.geoboundaries.org/", license: "CC BY 4.0" }],
    historyDataCandidates: [{ name: "Hartwell China Historical GIS", doi: "10.7910/DVN/29302", url: "https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/29302", license: "CC0 1.0", role: "approximate historical area/co-location reference", status: "not incorporated; requires field-level validation" }],
    sourceNote: "几何来自 Natural Earth 与 geoBoundaries；唐代名称、道府、城市、军镇为独立游戏metadata。未将 CHGIS V6/TGAZ 数据复制进发布包；Hartwell CC0 数据尚未导入或用于验证。",
  },
  daoCatalog, daoRegionRanges, assignmentMethod: "project-curated place grouping; all circuit assignments provisional pending CC0 Hartwell crosswalk and historical-map review", regions, cityNodes: citySeeds, strategicPasses: passSeeds, frontierRegions: frontierCatalog,
};

// Normalize the feature metadata without changing a single coordinate.
const regionById = new Map(regions.map((region) => [region.id, region]));
regionsGeoJson.mapVersion = model.mapVersion;
regionsGeoJson.metadata = { ...(regionsGeoJson.metadata || {}), mapVersion: model.mapVersion, geometryRole: "modern-geography-backed interactive strategic polygons", historyLayer: "Tang metadata; not modern administrative display", regionCount: 100, daoSystem: "Kaiyuan fifteen circuits", sourceStatus: "modern-geometry-tang-metadata", sourceNote: model.sources.sourceNote, sources: model.sources };
for (const feature of regionsGeoJson.features) {
  const id = feature.properties?.region_id || feature.properties?.id;
  const region = regionById.get(id);
  const source = feature.properties || {};
  feature.properties = {
    region_id: id, id, geometry_id: region.geometryId, name: region.historicalName, historical_name: region.historicalName,
    admin: region.prefectureName, prefecture_id: region.prefectureId, province: region.daoId, dao_id: region.daoId,
    level: "strategic-region", type: source.type || "region", terrain: region.terrain, frontier_region_id: region.frontierRegionId,
    military_command_id: region.militaryCommandId, owner_id: region.ownerId, controller_id: region.controllerId, sovereign_id: region.sovereignId,
    geometrySource: source.geometrySource || "modern public GIS geometry", sourceStatus: "modern-geometry-tang-metadata", dao_assignment_confidence: region.daoAssignmentConfidence, modelVersion: model.modelVersion,
  };
}
writeFileSync(join(dataDir, "strategy-regions.geojson"), `${JSON.stringify(regionsGeoJson)}\n`);

const provinceFeatures = daoCatalog.map((dao) => {
  const coordinates = regionsGeoJson.features.filter((feature) => feature.properties.dao_id === dao.id).flatMap((feature) => {
    if (feature.geometry.type === "Polygon") return [feature.geometry.coordinates];
    return feature.geometry.coordinates;
  });
  return { type: "Feature", geometry: { type: "MultiPolygon", coordinates }, properties: { province_id: dao.id, dao_id: dao.id, province: dao.id, name: dao.name, level: "tang-dao", regionCount: assignments[dao.id].length, geometrySource: "union of modern public GIS strategic polygons", modelVersion: model.modelVersion } };
});
writeFileSync(join(dataDir, "strategy-provinces.geojson"), `${JSON.stringify({ type: "FeatureCollection", metadata: { mapVersion: model.mapVersion, daoSystem: "Kaiyuan fifteen circuits", sourceStatus: "modern-geometry-tang-metadata", regionCount: 100, sources: model.sources }, features: provinceFeatures })}\n`);
writeFileSync(join(dataDir, "tang-map-model.json"), `${JSON.stringify(model)}\n`);
writeFileSync(join(dataDir, "tang-map-model.js"), `window.TANG_MAP_MODEL = ${JSON.stringify(model)};\n`);
console.log(`写入 Tang map model：${regions.length} regions、${daoCatalog.length} dao、${citySeeds.length} cities、${passSeeds.length} passes`);
