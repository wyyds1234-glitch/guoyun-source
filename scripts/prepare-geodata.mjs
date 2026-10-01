import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "public", "data");
fs.mkdirSync(outDir, { recursive: true });

const bounds = [64, 4, 156, 66];
const read = (name) => JSON.parse(fs.readFileSync(`/tmp/${name}`, "utf8"));

function geometryBounds(coordinates, output = [Infinity, Infinity, -Infinity, -Infinity]) {
  if (typeof coordinates?.[0] === "number") {
    output[0] = Math.min(output[0], coordinates[0]);
    output[1] = Math.min(output[1], coordinates[1]);
    output[2] = Math.max(output[2], coordinates[0]);
    output[3] = Math.max(output[3], coordinates[1]);
    return output;
  }
  for (const coordinate of coordinates || []) geometryBounds(coordinate, output);
  return output;
}

function intersects(feature) {
  const [west, south, east, north] = geometryBounds(feature.geometry.coordinates);
  return east >= bounds[0] && west <= bounds[2] && north >= bounds[1] && south <= bounds[3];
}

function write(name, collection) {
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(collection));
}

const land = read("tianxia_ne_land.geojson");
write("natural-earth-land.geojson", land);
write("natural-earth-land-10m.geojson", land);

const rivers = read("tianxia_ne_rivers_10m.geojson");
rivers.features = rivers.features.filter((feature) => intersects(feature) && Number(feature.properties.scalerank ?? 99) <= 8);
write("natural-earth-rivers.geojson", rivers);

const lakes = read("tianxia_ne_lakes.geojson");
lakes.features = lakes.features.filter((feature) => intersects(feature) && Number(feature.properties.scalerank ?? 99) <= 7);
write("natural-earth-lakes.geojson", lakes);

const terrainNames = /TIAN SHAN|HIMALAYAS|NORTH CHINA PLAIN|ALTAY MOUNTAINS|MANCHURIAN PLAIN|MONGOLIAN PLATEAU|Nan Ling|Wuyi|SICHUAN BASIN|Yin Mts|Taihang|Qinling|Loess Plateau|TIBETAN PLATEAU|GOBI/i;
const terrain = read("tianxia_ne_terrain.geojson");
terrain.features = terrain.features.filter((feature) => terrainNames.test(Object.values(feature.properties).join(" ")));
write("natural-earth-terrain.geojson", terrain);

const mountainLines = {
  type: "FeatureCollection",
  name: "named_mountain_axes",
  features: [
    { type: "Feature", properties: { name: "大巴山", source: "WGS84 geographic axis" }, geometry: { type: "LineString", coordinates: [[106.1, 32.4], [107.4, 32.0], [108.7, 31.8], [110.2, 31.5]] } },
    { type: "Feature", properties: { name: "燕山", source: "WGS84 geographic axis" }, geometry: { type: "LineString", coordinates: [[115.4, 40.6], [117.0, 40.5], [118.6, 40.3], [120.0, 40.1]] } },
    { type: "Feature", properties: { name: "长白山", source: "WGS84 geographic axis" }, geometry: { type: "LineString", coordinates: [[125.4, 42.1], [127.0, 42.5], [128.5, 43.2], [129.4, 44.1]] } },
  ],
};
write("mountain-axes.geojson", mountainLines);

console.log({
  land: land.features.length,
  rivers: rivers.features.length,
  lakes: lakes.features.length,
  terrain: terrain.features.length,
});
