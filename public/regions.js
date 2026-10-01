(() => {
  "use strict";

  // All positions are WGS84 longitude/latitude. The administrative list follows
  // Stable strategic nodes retained across scenario eras. The active scenario
  // label is Tang; source-era names stay in the data while the historical
  // metadata layer is kept separate from modern geometry.
  // Interactive strategic polygons are loaded from the versioned GeoJSON assets;
  // this file keeps the gameplay metadata and route graph in a small local cache.
  const MAP_MODEL = window.TANG_MAP_MODEL;
  if (!MAP_MODEL || MAP_MODEL.modelVersion !== "tang-map-model-v2") {
    throw new Error("唐代地图模型缺失或版本不匹配");
  }
  const rows = [
    ["luoyang", "雒阳", "河南尹", "si", 112.4244, 34.6586, "capital", "河洛盆地", 96, 92, 78],
    ["huai", "怀县", "河内郡", "si", 113.3500, 35.0900, "city", "太行南麓", 72, 78, 55],
    ["anyi", "安邑", "河东郡", "si", 110.9500, 35.0500, "farm", "汾河平原", 68, 88, 49],
    ["hongnong", "弘农", "弘农郡", "si", 110.8786, 34.5222, "city", "崤函河谷", 48, 58, 69],
    ["changan", "长安", "京兆府", "si", 108.8600, 34.2700, "capital", "关中平原", 88, 96, 82],
    ["gaoling", "高陵", "左冯翊", "si", 109.0873, 34.5352, "farm", "渭北平原", 56, 86, 47],
    ["huaili", "槐里", "右扶风", "si", 108.4900, 34.3000, "city", "渭水河谷", 52, 76, 55],
    ["yangdi", "阳翟", "颍川郡", "yu", 113.4700, 34.1600, "city", "颍川平原", 86, 100, 51],
    ["pingyu", "平舆", "汝南郡", "yu", 114.6331, 32.9560, "farm", "淮北平原", 94, 112, 44],
    ["xiayi", "下邑", "梁国", "yu", 116.1300, 34.2400, "city", "睢水平原", 58, 83, 48],
    ["qiao", "谯县", "沛国", "yu", 116.5500, 33.8800, "capital", "涡水平原", 82, 99, 61],
    ["chenxian", "陈县", "陈国", "yu", 114.8800, 33.7300, "city", "陈蔡平原", 60, 84, 53],
    ["qufu", "鲁县", "鲁国", "yu", 116.9900, 35.5800, "city", "鲁中丘陵", 51, 66, 58],
    ["yecheng", "邺城", "魏郡", "ji", 114.4700, 36.3400, "capital", "漳水平原", 85, 102, 66],
    ["yingtao", "瘿陶", "巨鹿郡", "ji", 114.9200, 37.6200, "farm", "河北平原", 70, 101, 45],
    ["yuanshi", "元氏", "常山国", "ji", 114.5194, 37.7656, "city", "太行东麓", 69, 88, 55],
    ["lunu", "卢奴", "中山国", "ji", 114.9900, 38.5200, "city", "滹沱平原", 66, 86, 53],
    ["xindu", "信都", "安平国", "ji", 115.5800, 37.5500, "city", "冀中平原", 68, 93, 51],
    ["lecheng", "乐成", "河间国", "ji", 116.1200, 38.1900, "city", "河间平原", 64, 91, 49],
    ["ganling", "甘陵", "清河国", "ji", 115.7200, 36.8200, "farm", "清河平原", 73, 104, 43],
    ["handan", "邯郸", "赵国", "ji", 114.5253, 36.5938, "city", "太行东麓", 61, 78, 59],
    ["bohai", "南皮", "渤海郡", "ji", 116.6965, 38.0405, "city", "滨海平原", 65, 90, 48],
    ["chenliu", "陈留", "陈留郡", "yan", 114.5292, 34.6711, "farm", "中原平原", 76, 108, 45],
    ["puyang", "濮阳", "东郡", "yan", 115.0175, 35.7052, "city", "黄河渡口", 68, 88, 53],
    ["fenggao", "奉高", "泰山郡", "yan", 117.1200, 36.1900, "city", "泰山南麓", 54, 65, 72],
    ["changyi", "昌邑", "山阳郡", "yan", 116.0900, 35.3900, "capital", "济水平原", 64, 91, 58],
    ["dingtao", "定陶", "济阴郡", "yan", 115.5700, 35.0700, "farm", "济阴平原", 66, 98, 47],
    ["tancheng", "郯县", "东海国", "xu", 118.3500, 34.6200, "city", "沂沭平原", 66, 86, 57],
    ["kaiyang", "开阳", "琅邪国", "xu", 118.3400, 35.0500, "city", "沂蒙丘陵", 59, 72, 63],
    ["pengcheng", "彭城", "彭城国", "xu", 117.2830, 34.2050, "city", "淮泗平原", 75, 96, 62],
    ["guangling", "广陵", "广陵郡", "xu", 119.4300, 32.3900, "port", "江淮水网", 69, 90, 56],
    ["xiapi", "下邳", "下邳国", "xu", 117.9600, 34.3200, "capital", "泗水河网", 72, 94, 66],
    ["dongpingling", "东平陵", "济南国", "qing", 117.5300, 36.7200, "city", "济南平原", 62, 84, 54],
    ["pingyuan", "平原", "平原郡", "qing", 116.4333, 37.1667, "farm", "黄河下游", 82, 113, 43],
    ["ju", "剧县", "北海国", "qing", 118.7800, 36.8600, "farm", "胶莱平原", 79, 101, 47],
    ["huangxian", "黄县", "东莱郡", "qing", 120.5200, 37.6500, "port", "半岛海岸", 59, 73, 57],
    ["linzi", "临淄", "齐国", "qing", 118.3100, 36.8200, "capital", "齐鲁丘陵", 74, 88, 63],
    ["nanyang", "宛县", "南阳郡", "jing", 112.5343, 33.0057, "city", "南阳盆地", 91, 107, 59],
    ["jiangling", "江陵", "南郡", "jing", 112.1900, 30.3500, "capital", "江汉平原", 79, 108, 68],
    ["xiling", "西陵", "江夏郡", "jing", 114.7993, 30.8397, "port", "长江渡口", 60, 83, 59],
    ["quanling", "泉陵", "零陵郡", "jing", 111.6100, 26.4300, "farm", "潇湘丘陵", 63, 92, 55],
    ["chenzhou", "郴县", "桂阳郡", "jing", 113.0200, 25.7700, "city", "南岭山地", 50, 69, 66],
    ["linyuan", "临沅", "武陵郡", "jing", 111.6793, 29.0173, "city", "武陵山地", 55, 74, 69],
    ["changsha", "临湘", "长沙郡", "jing", 112.9800, 28.2000, "city", "洞庭平原", 74, 104, 54],
    ["liyang", "历阳", "九江郡", "yang", 118.3600, 31.7200, "capital", "长江渡口", 71, 91, 66],
    ["wanling", "宛陵", "丹阳郡", "yang", 118.7495, 30.9466, "city", "皖南丘陵", 64, 78, 63],
    ["shu", "舒县", "庐江郡", "yang", 116.9500, 31.4600, "city", "江淮丘陵", 61, 82, 59],
    ["shanyin", "山阴", "会稽郡", "yang", 120.5783, 30.0045, "port", "会稽丘陵", 70, 91, 58],
    ["wuxian", "吴县", "吴郡", "yang", 120.6200, 31.3100, "port", "太湖水网", 77, 99, 57],
    ["nanchang", "南昌", "豫章郡", "yang", 115.8900, 28.6800, "city", "赣江平原", 78, 106, 54],
    ["nanzheng", "南郑", "汉中郡", "yi", 106.9333, 33.0000, "city", "汉中盆地", 66, 96, 72],
    ["jiangzhou", "江州", "巴郡", "yi", 106.5650, 29.5559, "port", "长江峡谷", 70, 86, 69],
    ["luoxian", "雒县", "广汉郡", "yi", 104.2800, 30.9793, "city", "成都平原", 71, 99, 57],
    ["chengdu", "成都", "蜀郡", "yi", 104.0700, 30.6700, "capital", "成都平原", 92, 118, 71],
    ["wuyang", "武阳", "犍为郡", "yi", 103.8700, 30.2000, "farm", "岷江平原", 63, 94, 55],
    ["qielan", "故且兰", "牂柯郡", "yi", 107.5200, 26.7000, "city", "云贵高原", 42, 54, 72],
    ["qiongdu", "邛都", "越巂郡", "yi", 102.2700, 27.9000, "city", "横断山谷", 48, 61, 76],
    ["dianchi", "滇池", "益州郡", "yi", 102.7500, 24.7500, "city", "滇池盆地", 53, 70, 63],
    ["buwei", "不韦", "永昌郡", "yi", 99.1700, 25.1200, "city", "滇西山地", 39, 49, 73],
    ["didao", "狄道", "陇西郡", "liang", 103.8600, 35.3800, "city", "洮河谷地", 44, 61, 67],
    ["longxian", "陇县", "汉阳郡", "liang", 106.8600, 34.8900, "capital", "陇山关隘", 55, 72, 73],
    ["xiabian", "下辨", "武都郡", "liang", 105.7300, 33.7400, "city", "秦巴山地", 38, 53, 75],
    ["yunwu", "允吾", "金城郡", "liang", 102.8100, 36.3200, "city", "黄河谷地", 41, 58, 63],
    ["linjing", "临泾", "安定郡", "liang", 107.1900, 35.6800, "city", "陇东高原", 39, 54, 66],
    ["fuping", "富平", "北地郡", "liang", 106.2004, 37.9844, "city", "河套南缘", 34, 48, 64],
    ["wuwei", "姑臧", "武威郡", "liang", 102.6400, 37.9300, "city", "河西走廊", 45, 61, 67],
    ["zhangye", "觻得", "张掖郡", "liang", 100.4500, 38.9300, "city", "河西绿洲", 39, 57, 64],
    ["jiuquan", "禄福", "酒泉郡", "liang", 98.4900, 39.7300, "city", "河西绿洲", 35, 52, 62],
    ["dunhuang", "敦煌", "敦煌郡", "liang", 94.6600, 40.1400, "city", "西域门户", 31, 45, 70],
    ["zhangzi", "长子", "上党郡", "bing", 112.8793, 36.1189, "city", "太行山地", 52, 66, 73],
    ["jinyang", "晋阳", "太原郡", "bing", 112.5500, 37.8667, "capital", "汾水谷地", 68, 86, 71],
    ["fushi", "肤施", "上郡", "bing", 109.4882, 36.5912, "city", "黄土高原", 36, 50, 65],
    ["lishi", "离石", "西河郡", "bing", 111.1500, 37.5200, "city", "吕梁山地", 39, 54, 72],
    ["jiuyuan", "九原", "五原郡", "bing", 109.9586, 40.6003, "city", "河套平原", 37, 58, 68],
    ["yunzhong", "云中", "云中郡", "bing", 111.1900, 40.2700, "city", "阴山南麓", 34, 50, 70],
    ["yinguan", "阴馆", "雁门郡", "bing", 112.4400, 39.3300, "city", "塞北山地", 32, 43, 78],
    ["zhuo", "涿县", "涿郡", "you", 115.9918, 39.4887, "city", "燕山南麓", 63, 84, 59],
    ["ji_city", "蓟县", "广阳郡", "you", 116.3900, 39.9000, "capital", "燕山关口", 67, 86, 70],
    ["gaoliu", "高柳", "代郡", "you", 113.7500, 40.3700, "city", "塞外高原", 34, 46, 75],
    ["juyang", "沮阳", "上谷郡", "you", 115.5200, 40.4100, "city", "燕山山谷", 37, 51, 73],
    ["yuyang", "渔阳", "渔阳郡", "you", 116.8400, 40.3800, "city", "燕山东麓", 51, 69, 68],
    ["tuyin", "土垠", "右北平郡", "you", 118.1557, 39.8313, "city", "辽西走廊", 39, 55, 69],
    ["yangle", "阳乐", "辽西郡", "you", 121.2400, 41.5300, "city", "辽西丘陵", 35, 49, 71],
    ["liaodong", "襄平", "辽东郡", "you", 123.1700, 41.2700, "city", "辽河平原", 47, 64, 69],
    ["gaogouli", "辽东边地", "边疆地区", "you", 125.0400, 41.7200, "city", "长白山地", 36, 47, 76],
    ["chaoxian", "大同江流域", "边疆地区", "you", 125.7500, 39.0300, "city", "大同江平原", 51, 66, 66],
    ["changliao", "昌辽", "辽东属国", "you", 121.0500, 41.8000, "city", "辽西边地", 31, 42, 69],
    ["panyu", "番禺", "南海郡", "jiao", 113.2600, 23.1300, "port", "珠江三角洲", 68, 98, 51],
    ["cangwu", "广信", "苍梧郡", "jiao", 111.4981, 23.4393, "city", "西江河谷", 57, 82, 60],
    ["bushan", "布山", "郁林郡", "jiao", 109.6000, 23.1000, "farm", "郁江平原", 48, 78, 53],
    ["hepu", "合浦", "合浦郡", "jiao", 109.2000, 21.6667, "port", "北部湾海岸", 46, 72, 55],
    ["longbian", "龙编", "交趾郡", "jiao", 105.9100, 21.1800, "capital", "红河平原", 62, 92, 61],
    ["xupu", "胥浦", "九真郡", "jiao", 105.7800, 19.8100, "port", "马江平原", 43, 68, 57],
    ["xijuan", "西卷", "日南郡", "jiao", 107.1000, 16.8200, "city", "日南海岸", 37, 57, 59],
    ["hulao", "虎牢关", "河南尹", "si", 113.1500, 34.8300, "gate", "山口关隘", 18, 25, 96],
    ["hangu", "函谷关", "弘农郡", "si", 110.9300, 34.6300, "gate", "崤函关隘", 16, 22, 98],
    ["tongguan", "潼关", "京兆尹", "si", 110.2500, 34.5400, "gate", "黄河关隘", 17, 24, 97],
    ["jiange", "剑阁", "广汉郡", "yi", 105.4800, 32.1900, "gate", "剑门山道", 15, 20, 99],
    ["wuguan", "武关", "京兆尹", "si", 110.5900, 33.5900, "gate", "丹江关隘", 16, 23, 96],
    ["yangping", "阳平关", "汉中郡", "yi", 106.4200, 32.8400, "gate", "秦岭关隘", 16, 22, 98],
  ];

  const typeNames = { capital: "州治/重镇", city: "郡国治所", gate: "关隘", port: "港口/水运", farm: "农业区" };
  const routeNames = { road: "驿道", mountain: "山道", pass: "关道", river: "渡河", water: "水路" };
  // The Tang 741 scenario uses the Kaiyuan fifteen circuits (道).  The
  // legacy source rows retain their stable strategic-region ids, but their
  // gameplay grouping is normalized here so old saves cannot keep the Han
  // thirteen-state taxonomy alive.
  const DAO_IDS = MAP_MODEL.daoCatalog.map((dao) => dao.id);
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
  const modelRegions = new Map(MAP_MODEL.regions.map((region) => [region.id, region]));
  // The current 741 scenario has no source-verified Tang-era names for these
  // frontier cells. Keep them geographic and non-port rather than reusing
  // Han-era Goguryeo/Chaoxian labels as if they were contemporary entities.
  const scenarioDisplayCorrections = {
    gaogouli: { name: "辽东边地", admin: "边疆地区", type: "city" },
    chaoxian: { name: "大同江流域", admin: "边疆地区", type: "city" },
    xijuan: { type: "city" },
  };
  const nameAtYear = (regionOrId, year = MAP_MODEL.activeYear) => {
    const region = typeof regionOrId === "string" ? modelRegions.get(regionOrId) : regionOrId;
    const entries = region?.nameHistory || [];
    const numericYear = Number(year) || MAP_MODEL.activeYear;
    return entries.find((entry) => Number(entry.fromYear) <= numericYear
      && (entry.toYear == null || numericYear <= Number(entry.toYear)))?.name
      || region?.historicalName
      || region?.name
      || "未命名地区";
  };
  const regions = Object.fromEntries(rows.map(([id, fallbackName, fallbackAdmin, legacyProvince, lon, lat, type, terrain, population, grain, defense]) => {
    const modelRegion = modelRegions.get(id);
    const correction = scenarioDisplayCorrections[id] || {};
    const daoId = modelRegion?.daoId || daoForRegion(id, legacyProvince);
    const defenseValue = Number.isFinite(Number(modelRegion?.fortification))
      ? Number(modelRegion.fortification)
      : Number.isFinite(Number(defense)) ? Number(defense) : 50;
    const garrisonValue = Number.isFinite(Number(modelRegion?.garrison))
      ? Number(modelRegion.garrison)
      : Math.max(40, Math.round(defenseValue * 4));
    return [id, {
      id,
      name: correction.name || modelRegion?.historicalName || fallbackName,
      historicalName: correction.name || modelRegion?.historicalName || fallbackName,
      nameHistory: correction.name
        ? [{ fromYear: 618, toYear: null, name: correction.name }]
        : modelRegion?.nameHistory || [{ fromYear: 618, toYear: null, name: fallbackName }],
      nameAtYear: (year) => correction.name || nameAtYear(modelRegion, year),
      admin: correction.admin || modelRegion?.prefectureName || fallbackAdmin,
      prefectureId: modelRegion?.prefectureId || `prefecture-${id}`,
      province: daoId,
      daoId,
      daoName: modelRegion?.daoName || daoId,
      geometryId: modelRegion?.geometryId || `region-${id}`,
      legacyProvince,
      lon,
      lat,
      centroid: modelRegion?.centroid || [lon, lat],
      type: correction.type || type,
      terrain: modelRegion?.terrain || terrain,
      population: modelRegion?.population ?? population,
      grain: modelRegion?.agriculture ?? grain,
      agriculture: modelRegion?.agriculture ?? grain,
      commerce: modelRegion?.commerce ?? grain,
      food: modelRegion?.food ?? grain,
      supplyCapacity: modelRegion?.supplyCapacity ?? grain,
      // Keep both names during the gameplay migration.  Historical map data
      // calls this value `fortification`, while the battle/UI layer reads
      // `defense`; exposing one finite canonical value prevents NaN/null
      // garrisons and城防 values in loaded or fresh games.
      defense: defenseValue,
      fortification: defenseValue,
      garrison: garrisonValue,
      unrest: modelRegion?.unrest ?? 8,
      loyalty: modelRegion?.loyalty ?? 82,
      strategicValue: modelRegion?.strategicValue ?? defense,
      ownerId: modelRegion?.ownerId || "tang",
      controllerId: modelRegion?.controllerId || "tang",
      sovereignId: modelRegion?.sovereignId || "tang",
      militaryCommandId: modelRegion?.militaryCommandId || null,
      frontierRegionId: modelRegion?.frontierRegionId || null,
      cityIds: modelRegion?.cityIds || [],
      roadNodeIds: modelRegion?.roadNodeIds || [],
      modelNeighbors: modelRegion?.neighbors || [],
      neighbors: [],
    }];
  }));
  const adjacency = window.STRATEGY_MAP_ADJACENCY;
  if (!adjacency || adjacency.source !== "strategy-regions.geojson" || adjacency.relation !== "shared-polygon-boundary") {
    throw new Error("战略区邻接缓存缺失或不是由 GeoJSON 共享边界生成");
  }
  if (adjacency.regionCount !== rows.length || !Array.isArray(adjacency.edges)) {
    throw new Error("战略区邻接缓存与 gameplay region 列表数量不一致");
  }
  const routeKeys = new Set();
  const routes = [];
  for (const edge of adjacency.edges) {
    const a = regions[edge.a];
    const b = regions[edge.b];
    if (!a || !b || a.id === b.id) continue;
    if (!Number.isFinite(edge.distanceKm) || !Number.isFinite(edge.sharedBoundaryKm) || edge.sharedBoundaryKm <= 0) {
      throw new Error(`战略区邻接边 ${edge.a}|${edge.b} 缺少共享边界或距离元数据`);
    }
    const key = [a.id, b.id].sort().join("|");
    if (routeKeys.has(key)) continue;
    routeKeys.add(key);
    const distance = Math.round(edge.distanceKm);
    const kind = edge.kind || "road";
    routes.push([a.id, b.id, kind, distance, edge.sharedBoundaryKm || 0]);
    const edgeMeta = {
      type: edge.type,
      terrain: edge.terrain || "未详",
      river_crossing: Boolean(edge.river_crossing ?? edge.river),
      road: Boolean(edge.road),
      pass: Boolean(edge.pass),
      port: Boolean(edge.port),
      sea_route: Boolean(edge.sea_route ?? edge.sea),
      movement_cost: Number(edge.movement_cost) || 1,
    };
    a.neighbors.push({ id: b.id, kind, distance, sharedBoundaryKm: edge.sharedBoundaryKm || 0, edgeType: edge.type, ...edgeMeta });
    b.neighbors.push({ id: a.id, kind, distance, sharedBoundaryKm: edge.sharedBoundaryKm || 0, edgeType: edge.type, ...edgeMeta });
  }
  const provinceAdjacency = Object.fromEntries(DAO_IDS.map((id) => [id, []]));
  for (const [aId, bId] of routes) {
    const a = regions[aId].province;
    const b = regions[bId].province;
    if (a === b) continue;
    if (!provinceAdjacency[a].includes(b)) provinceAdjacency[a].push(b);
    if (!provinceAdjacency[b].includes(a)) provinceAdjacency[b].push(a);
  }
  window.STRATEGY_MAP_DATA = {
    regions,
    routes,
    provinceAdjacency,
    daoIds: DAO_IDS,
    daoCatalog: MAP_MODEL.daoCatalog,
    frontierRegions: MAP_MODEL.frontierRegions,
    cityNodes: MAP_MODEL.cityNodes,
    strategicPasses: MAP_MODEL.strategicPasses,
    typeNames,
    routeNames,
    sourceDate: MAP_MODEL.activeYear,
    mapVersion: MAP_MODEL.mapVersion,
    historyDataVersion: MAP_MODEL.historyDataVersion,
    scenarioEra: MAP_MODEL.scenario,
    regionCount: rows.length,
    daoRegionRanges: MAP_MODEL.daoRegionRanges,
    nameAtYear,
  };
})();
