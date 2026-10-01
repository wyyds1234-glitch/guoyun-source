import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {geoContains} from 'd3';
const source=readFileSync(new URL('../public/geo-map.js',import.meta.url),'utf8');
const part=(start,end)=>source.slice(source.indexOf(`  function ${start}(`),source.indexOf(`  function ${end}(`));
const ctx=vm.createContext({WORLD_BOUNDS:[[-20,10],[150,65]],diagnostics:{filteredGeometryFeatures:0},console:{debug:()=>{}}});
vm.runInContext(part('planarRingArea','anchorDistanceSquared')+part('isValidCoordinate','projectedBounds'),ctx);
for(const lod of ['110m','50m','10m'])test(`${lod}: real land contains Tang cities but never fills ocean`,()=>{
 const data=JSON.parse(readFileSync(new URL(`../public/data/natural-earth-land-${lod}.geojson`,import.meta.url)));
 const land=ctx.sanitizeGeographicCollection(data,lod);
 for(const point of [[116.4,39.9],[104.1,30.6],[108.9,34.3],[139.5,36]])assert.equal(geoContains(land,point),true,`land ${point}`);
 for(const point of [[145,25],[125,25],[60,15]])assert.equal(geoContains(land,point),false,`ocean ${point} must remain transparent`);
});
