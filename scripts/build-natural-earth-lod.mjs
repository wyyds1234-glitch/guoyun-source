import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Natural Earth geometry is already clipped and committed in the repository.
// Build deterministic 110m/50m/10m views offline; the browser never fetches a
// remote map service and never simplifies geometry during zoom.
const root = resolve(import.meta.dirname, "..");
const dataDir = join(root, "public", "data");
const source = JSON.parse(readFileSync(join(dataDir, "natural-earth-land.geojson"), "utf8"));

function distance(point, start, end) {
  const [px, py] = point;
  const [sx, sy] = start;
  const [ex, ey] = end;
  const dx = ex - sx;
  const dy = ey - sy;
  if (!dx && !dy) return Math.hypot(px - sx, py - sy);
  const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (sx + t * dx), py - (sy + t * dy));
}

function simplifyRing(ring, tolerance) {
  if (!Array.isArray(ring) || ring.length < 8) return ring;
  const closed = ring[0]?.[0] === ring.at(-1)?.[0] && ring[0]?.[1] === ring.at(-1)?.[1];
  const points = closed ? ring.slice(0, -1) : ring.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const visit = (first, last) => {
    let max = tolerance;
    let split = -1;
    for (let index = first + 1; index < last; index += 1) {
      const current = distance(points[index], points[first], points[last]);
      if (current > max) { max = current; split = index; }
    }
    if (split >= 0) { keep[split] = 1; visit(first, split); visit(split, last); }
  };
  visit(0, points.length - 1);
  const simplified = points.filter((_, index) => keep[index]);
  if (simplified.length < 3) return ring;
  simplified.push(simplified[0]);
  return simplified;
}

function simplifyGeometry(geometry, tolerance) {
  if (!geometry) return geometry;
  const simplifyPolygon = (polygon) => polygon.map((ring) => simplifyRing(ring, tolerance));
  if (geometry.type === "Polygon") return { ...geometry, coordinates: simplifyPolygon(geometry.coordinates) };
  if (geometry.type === "MultiPolygon") return { ...geometry, coordinates: geometry.coordinates.map(simplifyPolygon) };
  return geometry;
}

function build(scale, tolerance) {
  return {
    ...source,
    metadata: { ...(source.metadata || {}), sourceScale: scale, sourceDataset: "Natural Earth public-domain land; offline deterministic simplification" },
    features: source.features.map((feature) => ({ ...feature, geometry: simplifyGeometry(feature.geometry, tolerance) })),
  };
}

writeFileSync(join(dataDir, "natural-earth-land-110m.geojson"), `${JSON.stringify(build("110m", 0.28))}\n`);
writeFileSync(join(dataDir, "natural-earth-land-50m.geojson"), `${JSON.stringify(build("50m", 0.08))}\n`);
writeFileSync(join(dataDir, "natural-earth-land-10m.geojson"), `${JSON.stringify(build("10m", 0))}\n`);
