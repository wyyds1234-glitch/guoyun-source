(() => {
  "use strict";

  const SAVE_KEY = "tianxia-geographic-map-save-v5";
  const MAP_V4_SAVE_KEY = "tianxia-real-map-save-v4";
  const OLD_SAVE_KEY = "tianxia-grand-strategy-save-v3";
  const LEGACY_SAVE_KEY = "yuyu-jiuzhou-save-v2";
  const ANCIENT_SAVE_KEY = "yuyu-jiuzhou-save-v1";
  const VERSION = window.TIANXIA_VERSION || { APP_VERSION: "0.4.7", SAVE_SCHEMA_VERSION: 5, MAP_VERSION: "tang741-v2", HISTORY_DATA_VERSION: "tang-history-v1" };
  const PERF_LEVEL = Math.max(0, Math.min(8, Number(new URLSearchParams(window.location.search).get("perf") || 0) || 0));
  const PERFORMANCE_MODE = PERF_LEVEL > 0;
  if (PERF_LEVEL > 0) {
    // Performance profiling is a separate map-only entry point.  Returning
    // before loadState() keeps the full game, timers, AI, cloud save, modals,
    // logs, and all management panels out of the performance page entirely.
    window.TianxiaGame = { performanceMode: true, perfLevel: PERF_LEVEL };
    return;
  }
  const SAVE_SCHEMA_VERSION = VERSION.SAVE_SCHEMA_VERSION;
  const MAP_VERSION = VERSION.MAP_VERSION;
  const HISTORY_DATA_VERSION = VERSION.HISTORY_DATA_VERSION || "tang-history-v1";
  const MAX_ACTIONS = 3;
  const TOTAL_PROVINCES = 15;
  const ARMY_ORDER_TYPES = Object.freeze(["ATTACK", "MOVE", "RETREAT"]);
  const COORDINATION_MODES = Object.freeze(["WAIT_FOR_ALL", "ATTACK_ON_ARRIVAL"]);
  // Population is an abstract campaign resource point, not a literal census.
  // The initial 200-person formation therefore costs 200 population points.
  const NEW_ARMY_COST = Object.freeze({ gold: 260, grain: 180, population: 200 });
  const NEW_ARMY_COMMANDERS = Object.freeze(["王思礼", "高仙芝", "李嗣业", "哥舒翰", "郭英乂", "田承嗣", "仆固怀恩", "张巡"]);
  const NEW_ARMY_BANNERS = Object.freeze(["羽林", "龙武", "安西", "朔方", "河西", "镇国", "天策", "宣威"]);
  const ERA = window.TIANXIA_ERA || {
    id: "tang",
    label: "唐代",
    year: 741,
    reign: "开元二十九年",
    administration: "开元十五道 · 州府县",
    capital: "长安",
  };

  const FACTIONS = {
    // In the historical 741 opening the central Tang court is rendered in a
    // restrained ochre/gold.朱红 remains reserved for rebellion and active
    // war, so the political map reads as 大唐 rather than a generic red
    // player overlay.
    player: { name: "唐", short: "唐", color: "#a8503f", relation: "我方" },
    rebel: { name: "叛军", short: "叛", color: "#8a5147", relation: "敌视" },
    liang: { name: "陇右军府", short: "陇", color: "#806f5d", relation: "敌视" },
    zhao: { name: "河东节镇", short: "河", color: "#62697a", relation: "冷淡" },
    yan: { name: "幽州节度", short: "幽", color: "#68775f", relation: "中立" },
    yuan: { name: "河北藩镇", short: "冀", color: "#806f5d", relation: "敌视" },
    qi: { name: "山东军府", short: "齐", color: "#63777a", relation: "中立" },
    wei: { name: "河南军镇", short: "豫", color: "#765c67", relation: "敌视" },
    shu: { name: "剑南军府", short: "剑", color: "#77805d", relation: "友善" },
    wu: { name: "江南水军", short: "江", color: "#68775f", relation: "中立" },
    chu: { name: "山南荆襄", short: "荆", color: "#77805d", relation: "中立" },
    yue: { name: "岭南都护", short: "岭", color: "#9a8060", relation: "疏远" },
  };

  // Controller colors are resolved at render time so a newly introduced
  // faction/rebel never leaks a shared default color across unrelated cells.
  const FALLBACK_FACTION_COLORS = ["#6f7f5b", "#7d654b", "#496f78", "#75628a", "#567a67", "#8a604f", "#6c6f47", "#536478"];
  function factionColor(id = "neutral") {
    if (FACTIONS[id]?.color) return FACTIONS[id].color;
    if (id === "neutral") return "#596052";
    let hash = 0;
    for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return FALLBACK_FACTION_COLORS[hash % FALLBACK_FACTION_COLORS.length];
  }

  const MAP_MODES = {
    faction: "开元十五道为行政层，节点颜色显示战略区域实际控制权",
    terrain: "山系、河流、平原、关隘与水路决定进军条件",
    supply: "绿色节点补给充足，远离己方城池后补给逐步恶化",
    population: "节点越明亮，游戏人口规模指数越高；不是历史人口统计",
    military: "突出军团、行军路线、战线与围城",
    economy: "颜色越亮，州郡税赋与富庶越高",
    morale: "绿色安定，暗红代表动荡与叛乱风险",
    grain: "颜色越亮，屯田与粮食产能越强",
    diplomacy: "突出我方、友善、中立与敌视势力",
  };

  const REGION_DATA = window.STRATEGY_MAP_DATA;
  const REGIONS = REGION_DATA.regions;
  const ROUTES = REGION_DATA.routes;
  const DAO_IDS = REGION_DATA.daoIds || ["jingji", "duji", "guannei", "henan", "hedong", "hebei", "shannan_east", "shannan_west", "longyou", "huainan", "jiangnan_east", "jiangnan_west", "qianzhong", "jiannan", "lingnan"];
  const LEGACY_PROVINCE_MAP = { si: "jingji", ji: "hebei", yan: "henan", yu: "henan", xu: "huainan", qing: "henan", jing: "shannan_east", yang: "huainan", yi: "jiannan", liang: "longyou", bing: "hedong", you: "hebei", jiao: "lingnan" };
  const normalizeProvinceId = (id) => DAO_IDS.includes(id) ? id : LEGACY_PROVINCE_MAP[id] || "jingji";
  const PROVINCE_CAPITAL_REGION = {
    jingji: "changan", duji: "luoyang", guannei: "hangu", henan: "qiao", hedong: "jinyang",
    hebei: "yecheng", shannan_east: "jiangling", shannan_west: "nanzheng", longyou: "longxian",
    huainan: "xiapi", jiangnan_east: "wuxian", jiangnan_west: "nanchang", qianzhong: "qielan",
    jiannan: "chengdu", lingnan: "longbian",
  };

  /* Legacy save-schema names only; not part of the active Tang 741 model.
  const LEGACY_PROVINCES = {
    liang: {
      name: "凉州",
      sigil: "凉",
      region: "河西走廊 · 州治陇县",
      lore: "东据陇坂，西通河西。道路漫长，骑军驰骋，补给尤为艰难。",
      prosperity: 34,
      defense: 54,
      troops: 720,
      owner: "liang",
      adjacent: REGION_DATA.provinceAdjacency.liang,
      terrain: "高原",
      terrainMod: 1.14,
      capital: "陇县",
      travel: 150,
    },
    bing: {
      name: "并州",
      sigil: "并",
      region: "晋阳雄镇 · 太行西麓",
      lore: "东依太行，北接塞外。胡骑出没，民习骑射，山道不利大军展开。",
      prosperity: 38,
      defense: 57,
      troops: 760,
      owner: "zhao",
      adjacent: REGION_DATA.provinceAdjacency.bing,
      terrain: "山地",
      terrainMod: 1.17,
      capital: "晋阳",
      travel: 135,
    },
    you: {
      name: "幽州",
      sigil: "幽",
      region: "燕山塞下 · 州治蓟县",
      lore: "燕山为障，辽西辽东延袤千里。骑军精锐，边塞城垒坚固。",
      prosperity: 43,
      defense: 58,
      troops: 780,
      owner: "yan",
      adjacent: REGION_DATA.provinceAdjacency.you,
      terrain: "边塞",
      terrainMod: 1.18,
      capital: "蓟县",
      travel: 140,
    },
    ji: {
      name: "冀州",
      sigil: "冀",
      region: "河北平原 · 州治高邑",
      lore: "户口殷实，平畴广袤，自古多慷慨悲歌之士。",
      prosperity: 55,
      defense: 45,
      troops: 830,
      owner: "yuan",
      adjacent: REGION_DATA.provinceAdjacency.ji,
      terrain: "平原",
      terrainMod: 1,
      capital: "高邑",
      travel: 90,
    },
    qing: {
      name: "青州",
      sigil: "青",
      region: "海岱之间 · 州治临淄",
      lore: "负海傍山，盐铁丰饶，商舶往来不绝。",
      prosperity: 60,
      defense: 38,
      troops: 720,
      owner: "qi",
      adjacent: REGION_DATA.provinceAdjacency.qing,
      terrain: "丘陵",
      terrainMod: 1.07,
      capital: "临淄",
      travel: 95,
    },
    yi: {
      name: "益州",
      sigil: "益",
      region: "剑阁天险 · 州治成都",
      lore: "剑阁、阴平诸道险狭，盆地沃野千里。外军入蜀，最难在转运粮秣。",
      prosperity: 58,
      defense: 63,
      troops: 900,
      owner: "shu",
      adjacent: REGION_DATA.provinceAdjacency.yi,
      terrain: "险峻",
      terrainMod: 1.25,
      capital: "成都",
      travel: 165,
    },
    si: {
      name: "关内道",
      sigil: "关",
      region: "长安京畿 · 渭水关中",
      lore: "长安居关中之中，诸道驿路辐辏。京畿可号令四海，亦须防备四方军府坐大。",
      prosperity: 52,
      defense: 55,
      troops: 460,
      owner: "player",
      adjacent: REGION_DATA.provinceAdjacency.si,
      terrain: "关隘",
      terrainMod: 1.15,
      capital: "长安",
      travel: 85,
    },
    yan: {
      name: "兖州",
      sigil: "兖",
      region: "济水两岸 · 州治昌邑",
      lore: "河济纵横，沟渠密布，是河北与中原争衡的渡口之地。",
      prosperity: 57,
      defense: 43,
      troops: 760,
      owner: "wei",
      adjacent: REGION_DATA.provinceAdjacency.yan,
      terrain: "河网",
      terrainMod: 1.06,
      capital: "昌邑",
      travel: 85,
    },
    xu: {
      name: "徐州",
      sigil: "徐",
      region: "淮泗锁钥 · 州治下邳",
      lore: "五省通衢，泗水纵横，是南北争衡的必争之地。",
      prosperity: 51,
      defense: 44,
      troops: 770,
      owner: "qi",
      adjacent: REGION_DATA.provinceAdjacency.xu,
      terrain: "河网",
      terrainMod: 1.08,
      capital: "下邳",
      travel: 95,
    },
    yu: {
      name: "豫州",
      sigil: "豫",
      region: "中原腹地 · 州治谯县",
      lore: "颍汝平原户口殷盛，驰道四通。利于大军会战，也难凭险久守。",
      prosperity: 61,
      defense: 41,
      troops: 810,
      owner: "wei",
      adjacent: REGION_DATA.provinceAdjacency.yu,
      terrain: "平原",
      terrainMod: 0.98,
      capital: "谯县",
      travel: 80,
    },
    jing: {
      name: "荆州",
      sigil: "荆",
      region: "荆襄江汉 · 州治汉寿",
      lore: "北有襄阳，南跨洞庭，江汉水道贯通全境。舟师与水运决定胜负。",
      prosperity: 50,
      defense: 52,
      troops: 840,
      owner: "chu",
      adjacent: REGION_DATA.provinceAdjacency.jing,
      terrain: "江湖",
      terrainMod: 1.12,
      capital: "汉寿",
      travel: 110,
    },
    yang: {
      name: "扬州",
      sigil: "扬",
      region: "江东水乡 · 州治历阳",
      lore: "江海交汇，鱼米富足，舟师可沿大江千里驰援。",
      prosperity: 66,
      defense: 42,
      troops: 860,
      owner: "wu",
      adjacent: REGION_DATA.provinceAdjacency.yang,
      terrain: "水乡",
      terrainMod: 1.13,
      capital: "历阳",
      travel: 115,
    },
    jiao: {
      name: "交州",
      sigil: "交",
      region: "岭南百越 · 州治龙编",
      lore: "五岭阻隔，江海潮湿。道路瘴疠，远征军若无充足粮药，往往未战先疲。",
      prosperity: 37,
      defense: 50,
      troops: 690,
      owner: "yue",
      adjacent: REGION_DATA.provinceAdjacency.jiao,
      terrain: "岭南",
      terrainMod: 1.19,
      capital: "龙编",
      travel: 170,
    },
  }; */

  const DAO_CONFIG = {
    jingji: { name: "京畿道", sigil: "京", region: "长安京畿 · 渭水关中", lore: "长安居关中之中，诸道驿路辐辏。京畿可号令四海，亦须防备四方军府坐大。", prosperity: 52, defense: 55, troops: 460, owner: "player", terrain: "关中", terrainMod: 1.15, capital: "长安", travel: 85 },
    duji: { name: "都畿道", sigil: "都", region: "雒阳旧都 · 河洛盆地", lore: "河洛居四海之中，漕运与驿道交会，诸军争衡于伊洛之间。", prosperity: 58, defense: 49, troops: 620, owner: "wei", terrain: "平原", terrainMod: 1.02, capital: "雒阳", travel: 80 },
    guannei: { name: "关内道", sigil: "关", region: "崤函关隘 · 关中东门", lore: "崤函与丹江控扼东西，关隘虽险，粮道却长。", prosperity: 45, defense: 61, troops: 570, owner: "liang", terrain: "关隘", terrainMod: 1.18, capital: "函谷关", travel: 105 },
    henan: { name: "河南道", sigil: "豫", region: "中原腹地 · 河济平原", lore: "户口殷盛、驰道四通，利于大会战，也难凭险久守。", prosperity: 61, defense: 43, troops: 980, owner: "wei", terrain: "平原", terrainMod: .98, capital: "谯县", travel: 80 },
    hedong: { name: "河东道", sigil: "河", region: "汾河谷地 · 太行西麓", lore: "东依太行，北接塞外。山道不利大军展开，骑军出没。", prosperity: 42, defense: 58, troops: 760, owner: "zhao", terrain: "山地", terrainMod: 1.17, capital: "晋阳", travel: 135 },
    hebei: { name: "河北道", sigil: "冀", region: "河北平原 · 燕山塞下", lore: "河朔平畴广袤，北通燕山，户口与战马俱丰。", prosperity: 55, defense: 49, troops: 1120, owner: "yuan", terrain: "平原", terrainMod: 1.02, capital: "邺城", travel: 95 },
    shannan_east: { name: "山南东道", sigil: "襄", region: "荆襄江汉 · 山南东路", lore: "汉水与长江贯通，襄阳、江陵扼守南北水陆。", prosperity: 54, defense: 53, troops: 880, owner: "chu", terrain: "江湖", terrainMod: 1.12, capital: "江陵", travel: 110 },
    shannan_west: { name: "山南西道", sigil: "汉", region: "汉中剑门 · 秦巴山道", lore: "秦巴险阻、栈道曲折，外军入蜀最难在转运粮秣。", prosperity: 47, defense: 64, troops: 680, owner: "shu", terrain: "山地", terrainMod: 1.24, capital: "南郑", travel: 155 },
    longyou: { name: "陇右道", sigil: "陇", region: "河西走廊 · 西域门户", lore: "道路漫长而骑军驰骋，守住绿洲与驿站才能保全粮道。", prosperity: 34, defense: 55, troops: 820, owner: "liang", terrain: "高原", terrainMod: 1.15, capital: "陇县", travel: 150 },
    huainan: { name: "淮南道", sigil: "淮", region: "淮泗锁钥 · 江淮水网", lore: "泗水、淮河纵横，舟师与渡口决定南北争衡。", prosperity: 57, defense: 46, troops: 900, owner: "wu", terrain: "河网", terrainMod: 1.1, capital: "下邳", travel: 105 },
    jiangnan_east: { name: "江南东道", sigil: "吴", region: "江东水乡 · 太湖会稽", lore: "江海交汇、鱼米富足，舟师可沿大江驰援。", prosperity: 66, defense: 43, troops: 760, owner: "wu", terrain: "水乡", terrainMod: 1.13, capital: "吴县", travel: 115 },
    jiangnan_west: { name: "江南西道", sigil: "赣", region: "豫章山水 · 赣江平原", lore: "群山环抱而水路深入内地，宜屯田养兵。", prosperity: 59, defense: 49, troops: 620, owner: "wu", terrain: "丘陵", terrainMod: 1.09, capital: "南昌", travel: 125 },
    qianzhong: { name: "黔中道", sigil: "黔", region: "云贵高原 · 溪洞山谷", lore: "山谷阻隔、道路险狭，守险则固，远征则艰。", prosperity: 42, defense: 60, troops: 520, owner: "shu", terrain: "山地", terrainMod: 1.2, capital: "故且兰", travel: 165 },
    jiannan: { name: "剑南道", sigil: "剑", region: "成都平原 · 剑阁天险", lore: "沃野千里而关山险狭，剑阁与成都互为表里。", prosperity: 62, defense: 65, troops: 920, owner: "shu", terrain: "险峻", terrainMod: 1.25, capital: "成都", travel: 165 },
    lingnan: { name: "岭南道", sigil: "岭", region: "岭南百越 · 珠江红河", lore: "五岭阻隔、江海潮湿，远征军若无粮药往往未战先疲。", prosperity: 39, defense: 52, troops: 740, owner: "yue", terrain: "岭南", terrainMod: 1.19, capital: "龙编", travel: 170 },
  };
  const PROVINCES = Object.fromEntries(DAO_IDS.map((id) => [id, { ...DAO_CONFIG[id], adjacent: REGION_DATA.provinceAdjacency[id] || [] }]));

  const SEASONS = [
    { name: "春", title: "春和景明", effect: "农田产粮 +10%", grain: 1.1, gold: 1 },
    { name: "夏", title: "长夏蕃秀", effect: "人口增长 +20%", grain: 1, gold: 1 },
    { name: "秋", title: "金风大熟", effect: "农田产粮 +25%", grain: 1.25, gold: 1 },
    { name: "冬", title: "玄冬闭藏", effect: "商路税收 -10%", grain: 0.85, gold: 0.9 },
  ];
  // Scenario calendar: 741-01-01 is the opening day; every month has 30
  // simulation days.  The Tang campaign treats the first two months as
  // winter (岁首), then advances through spring/summer/autumn; this avoids
  // the misleading "春" label on New Year's Day.
  const DAYS_PER_MONTH = 30;
  const seasonForMonth = (month) => {
    const value = clamp(Number(month) || 1, 1, 12);
    if (value <= 2 || value === 12) return 3;
    if (value <= 5) return 0;
    if (value <= 8) return 1;
    return 2;
  };

  const COURT_ACTIONS = [
    {
      id: "farm",
      icon: "禾",
      name: "劝课农桑",
      description: "开沟筑渠，扩充屯田，提高每月粮草收入。",
      effect: "+80 基础粮产",
      cost: (s) => ({ gold: 150 + s.farmLevel * 75 }),
      apply(s) {
        s.farmLevel += 1;
        const province = developmentProvince();
        if (province) {
          province.farms = (province.farms || 1) + 1;
          province.prosperity += 3;
        }
      },
    },
    {
      id: "market",
      icon: "市",
      name: "通衢互市",
      description: "整顿关津，招徕行商，提高每月国库收入。",
      effect: "+70 基础税收",
      cost: (s) => ({ gold: 170 + s.marketLevel * 85 }),
      apply(s) { s.marketLevel += 1; },
    },
    {
      id: "relief",
      icon: "恤",
      name: "开仓赈民",
      description: "以钱粮救济困苦，使黎庶归心，稳固天命。",
      effect: "民心 +10",
      cost: () => ({ gold: 120, grain: 180 }),
      apply(s) { s.morale = clamp(s.morale + 10, 0, 100); s.prestige += 3; },
    },
    {
      id: "tax",
      icon: "赋",
      name: "加征田赋",
      description: "急征当月赋税充实国库，但会招致民间怨言。",
      effect: "+340 国库 · 民心 -6",
      cost: () => ({}),
      apply(s) { s.gold += 340 + ownedProvinces(s).length * 40; s.morale = clamp(s.morale - 6, 0, 100); },
    },
    {
      id: "settle",
      icon: "垦",
      name: "招抚流民",
      description: "给田授种，安置流徙百姓，扩充国家户口。",
      effect: "人口规模 +60点",
      cost: () => ({ gold: 140, grain: 110 }),
      apply(s) { s.population += 60; s.morale = clamp(s.morale + 2, 0, 100); },
    },
    {
      id: "inspect",
      icon: "巡",
      name: "巡行郡县",
      description: "亲察吏治，惩贪劝善，重振朝廷声威。",
      effect: "民心 +5 · 威望 +5",
      cost: () => ({ gold: 80 }),
      apply(s) { s.morale = clamp(s.morale + 5, 0, 100); s.prestige += 5; },
    },
  ];

  const EVENTS = [
    {
      emblem: "丰",
      title: "近郊喜获丰收",
      description: "京畿数县稻穗盈畴，百姓献上新谷，请陛下裁夺余粮用途。",
      choices: [
        { label: "减租惠民", detail: "让百姓留足口粮", result: "粮草 +160 · 民心 +5", effects: { grain: 160, morale: 5 } },
        { label: "悉数入仓", detail: "征收丰年余粮", result: "粮草 +300 · 民心 -3", effects: { grain: 300, morale: -3 } },
      ],
    },
    {
      emblem: "水",
      title: "河堤告急",
      description: "连日暴雨，河水漫堤，沿岸百姓亟待救援。朝臣争论不休。",
      choices: [
        { label: "拨粮赈灾", detail: "官军开仓并修筑堤坝", result: "耗 120 贯、180 粮 · 民心 +8", cost: { gold: 120, grain: 180 }, effects: { morale: 8, prestige: 4 } },
        { label: "令地方自筹", detail: "保存朝廷钱粮", result: "人口规模 -26点 · 民心 -6", effects: { population: -26, morale: -6 } },
      ],
    },
    {
      emblem: "贤",
      title: "名士负策来投",
      description: "一位游学四方的名士叩阙献策，愿为朝廷筹画四方。",
      choices: [
        { label: "礼聘入朝", detail: "以厚礼延揽贤才", result: "耗 160 贯 · 威望 +12", cost: { gold: 160 }, effects: { prestige: 12 } },
        { label: "赐酒遣归", detail: "留待他日再用", result: "民心 +2", effects: { morale: 2 } },
      ],
    },
    {
      emblem: "商",
      title: "西域商队入京",
      description: "胡商携珍宝良马而来，希望用大量金银换取粮食。",
      choices: [
        { label: "准其互市", detail: "以粮换取商税", result: "耗 180 粮 · 国库 +300", cost: { grain: 180 }, effects: { gold: 300 } },
        { label: "课以重税", detail: "扣留部分货物", result: "国库 +160 · 威望 -2", effects: { gold: 160, prestige: -2 } },
      ],
    },
    {
      emblem: "民",
      title: "流民扶老来归",
      description: "邻境兵祸不断，数百户流民抵达关下，请求成为陛下子民。",
      choices: [
        { label: "授田安置", detail: "给粮给种，编户齐民", result: "耗 130 粮 · 人口规模 +52点", cost: { grain: 130 }, effects: { population: 52, morale: 3 } },
        { label: "择壮者从军", detail: "青壮入伍，其余赈返", result: "步卒 +120 · 民心 -2", effects: { infantry: 120, morale: -2 } },
      ],
    },
    {
      emblem: "盗",
      title: "山贼啸聚作乱",
      description: "饥民与亡命之徒聚集山林，已经袭扰数处驿道。",
      choices: [
        { label: "发兵进剿", detail: "以雷霆手段肃清道路", result: "耗 90 粮 · 威望 +7", cost: { grain: 90 }, effects: { prestige: 7 } },
        { label: "招安抚恤", detail: "赦罪并给田归农", result: "耗 100 贯 · 人口规模 +12点 · 民心 +6", cost: { gold: 100 }, effects: { morale: 6, population: 12 } },
      ],
    },
  ];

  let state = loadState();
  let lastRunningSpeed = state.speed > 0 ? state.speed : 1;
  let lastPersistedStateJSON = JSON.stringify(state);
  let cloudSaveReady = false;
  let cloudHydrationPending = true;
  let inspectedCloudReadable = false;
  let cloudControlsBusy = false;
  let cloudSaveTimer = 0;
  let cloudRetryAttempt = 0;
  let localSaveTimer = 0;
  let lastLocalSaveAt = 0;
  let selectedProvince = "jingji";
  let selectedRegionId = "changan";
  let battleTarget = null;
  let battleTargetRegionId = null;
  // One source of truth for all army selection surfaces. Keep this as a
  // serializable array so map hit-tests, the army list, details and command
  // plans cannot drift through a second selection variable.
  let selectedArmyIds = [];
  let selectedMapObjectType = "region";
  let pendingOrderTargetId = null;
  let pendingAttackPlan = null;
  let hoveredRegionId = null;
  let territoryEventsBound = false;
  let territoryPointer = null;
  let audioContext = null;
  let strategicTimer = null;
  let pendingEventTimer = 0;
  const regionPointCache = new Map();
  const provincePointCache = new Map();
  const strategicRegionNodes = new Map();
  let strategicRoutesBuilt = false;
  let lastMapMode = "";
  let lastArmyLayerKey = "";
  let lastWarLayerKey = "";
  let lastProvinceCardKey = "";
  let tooltipFrame = 0;
  let hoverFrame = 0;
  let pendingHoverPoint = null;
  let pendingTooltipPosition = null;
  const renderDiagnostics = {
    strategicLayerBuilds: 0,
    strategicNodePatches: 0,
    armyLayerBuilds: 0,
    warLayerBuilds: 0,
    realtimeRenders: 0,
    fullRenders: 0,
  };

  const $ = (id) => document.getElementById(id);
  const PANEL_STATE_KEY = "guoyun-ui-panel-state-v1";
  let panelLayoutState = { leftCollapsed: false, rightCollapsed: false, allCollapsed: false, beforeAll: null };
  let activeRightSidebarTab = "region";
  const MODAL_IDS = ["setupModal", "cloudModal", "battleModal", "eventModal", "resultModal", "helpModal"];
  const HEAVY_MODAL_IDS = MODAL_IDS.filter((id) => id !== "setupModal");
  const modalTemplates = new Map();
  let modalTemplatesReady = false;
  const numberFormat = new Intl.NumberFormat("zh-CN");
  const regionDisplayName = (region, year = ERA.year) => REGION_DATA.nameAtYear?.(region, year) || region?.historicalName || region?.name || "未命名地区";
  // Render-only compatibility for pre-754 campaign saves. Do not mutate the
  // serialized army object or any cloud/local save as part of this alias.
  const armyDisplayName = (army) => army?.name === "神策第一军" ? "彍骑第一军" : army?.name || "未命名军团";
  const historicalDisplayText = (text) => String(text || "").replaceAll("神策第一军", "彍骑第一军");
  const displayKingdomName = () => state.scenarioType === "historicalScenario" && state.kingdom === "大唐" ? "唐" : (state.kingdom || "唐");

  function cacheModalTemplates() {
    if (modalTemplatesReady) return;
    MODAL_IDS.forEach((id) => {
      const dialog = $(id);
      if (dialog) modalTemplates.set(id, dialog.cloneNode(true));
    });
    modalTemplatesReady = true;
  }

  function unmountClosedModal(dialog) {
    if (!dialog || dialog.open) return;
    if (dialog.id === "eventModal") {
      window.clearTimeout(pendingEventTimer);
      pendingEventTimer = 0;
      dialog.querySelector("#eventChoices")?.replaceChildren();
    }
    if (dialog.id === "battleModal") dialog.querySelector("#dispatchBreakdown")?.replaceChildren();
    if (dialog.id !== "setupModal" || state.started) dialog.remove();
  }

  function bindModalLifecycleFor(dialog) {
    if (!dialog || dialog.dataset.lifecycleBound === "1") return;
    dialog.dataset.lifecycleBound = "1";
    dialog.addEventListener("close", () => {
      dialog.classList.remove("is-active");
      unmountClosedModal(dialog);
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      dialog.classList.remove("is-active");
      dialog.close();
      unmountClosedModal(dialog);
    });
  }

  function restartFromResult() {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(MAP_V4_SAVE_KEY);
    localStorage.removeItem(OLD_SAVE_KEY);
    localStorage.removeItem(LEGACY_SAVE_KEY);
    state = initialState();
    selectedProvince = "jingji";
    selectedRegionId = "changan";
    selectedArmyIds = [];
    selectedMapObjectType = "region";
    clearPendingRegionOrder(false);
    lastPersistedStateJSON = JSON.stringify(state);
    window.TianxiaCloudSave?.markDirty();
    $("resultModal")?.close();
    unmountClosedModal($("resultModal"));
    render();
    scheduleCloudSave(true);
    restartStrategicClock();
    syncStartGate();
  }

  function bindMountedModal(dialog) {
    if (!dialog || dialog.dataset.controlsBound === "1") return;
    dialog.dataset.controlsBound = "1";
    dialog.querySelectorAll('.modal-close, button[value="cancel"]').forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        dialog.close();
        unmountClosedModal(dialog);
      }, { once: true });
    });
    dialog.querySelector('form[method="dialog"]')?.addEventListener("submit", () => window.setTimeout(() => unmountClosedModal(dialog), 24), { once: true });
    if (dialog.id === "setupModal") {
      dialog.querySelector("#setupForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        startNewGame();
      });
    } else if (dialog.id === "cloudModal") {
      dialog.querySelector("#copyCloudCode")?.addEventListener("click", copyCloudCode);
      dialog.querySelector("#syncCloudButton")?.addEventListener("click", syncCloudNow);
      dialog.querySelector("#importCloudButton")?.addEventListener("click", importCloudSave);
      dialog.querySelector("#deleteCloudButton")?.addEventListener("click", deleteCloudSave);
    } else if (dialog.id === "battleModal") {
      dialog.querySelector("#dispatchRange")?.addEventListener("input", updateBattlePreview);
      dialog.querySelectorAll('[name="tactic"]').forEach((input) => input.addEventListener("change", updateBattlePreview));
      dialog.querySelector("#battleForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        dialog.close();
        unmountClosedModal(dialog);
        resolveBattle();
      });
    } else if (dialog.id === "resultModal") {
      dialog.querySelector("#resultRestartButton")?.addEventListener("click", restartFromResult);
    }
  }

  function ensureModal(id) {
    const existing = $(id);
    if (existing) return existing;
    cacheModalTemplates();
    const template = modalTemplates.get(id);
    if (!template) return null;
    const dialog = template.cloneNode(true);
    delete dialog.dataset.lifecycleBound;
    delete dialog.dataset.controlsBound;
    document.body.appendChild(dialog);
    bindModalLifecycleFor(dialog);
    bindMountedModal(dialog);
    return dialog;
  }

  function pruneClosedModals() {
    cacheModalTemplates();
    MODAL_IDS.forEach((id) => {
      const dialog = $(id);
      if (!dialog || dialog.open) return;
      if (id === "setupModal" && !state.started) {
        bindModalLifecycleFor(dialog);
        bindMountedModal(dialog);
        return;
      }
      unmountClosedModal(dialog);
    });
  }

  function cloneProvinces() {
    return Object.fromEntries(Object.entries(PROVINCES).map(([id, province]) => [id, {
      ...province,
      fieldTroops: province.owner === "player" ? 0 : Math.round(province.troops * 0.56),
      garrison: province.owner === "player" ? province.troops : Math.round(province.troops * 0.44),
      farms: province.owner === "player" ? 1 : Math.max(1, Math.round(province.prosperity / 28)),
      barracks: province.owner === "player" ? 1 : 1,
      siege: null,
      unrest: 0,
    }]));
  }

  function cloneRegions(provinces) {
    return Object.fromEntries(Object.entries(REGIONS).map(([id, region]) => {
      const province = provinces[region.province];
      const defense = Number.isFinite(Number(region.defense))
        ? Number(region.defense)
        : Number.isFinite(Number(region.fortification)) ? Number(region.fortification) : 50;
      const baseGarrison = Number.isFinite(Number(region.garrison))
        ? Number(region.garrison)
        : Math.max(40, Math.round(defense * (region.type === "gate" ? 5 : 4)));
      return [id, {
        ...region,
        neighbors: region.neighbors.map((neighbor) => ({ ...neighbor })),
        owner: province.owner,
        ownerId: province.owner,
        controllerId: province.owner,
        defense,
        fortification: defense,
        // The versioned Tang map already provides each region's real starting
        // garrison. Do not derive it from an undefined legacy defense field.
        garrison: Math.max(0, Math.round(baseGarrison)),
        fort: region.type === "gate" ? 3 : region.type === "capital" ? 2 : 1,
        unrest: 0,
        contested: false,
      }];
    }));
  }

  function initialState() {
    const provinces = cloneProvinces();
    return {
      version: SAVE_SCHEMA_VERSION,
      mapVersion: MAP_VERSION,
      historyDataVersion: HISTORY_DATA_VERSION,
      started: false,
      ruler: "玄宗",
      kingdom: "大唐",
      scenarioType: "historicalScenario",
      characterMode: "historical",
      characterName: "玄宗",
      politicalPath: "loyal",
      doctrine: "benevolent",
      year: 1,
      season: seasonForMonth(1),
      turns: 0,
      actionPoints: MAX_ACTIONS,
      gold: 850,
      grain: 900,
      population: 4200,
      morale: 68,
      prestige: 12,
      farmLevel: 1,
      marketLevel: 1,
      wallLevel: 1,
      drill: 1,
      infantry: 600,
      archers: 150,
      cavalry: 50,
      sound: true,
      eraId: ERA.id,
      calendar: { year: ERA.year, month: 1, day: 1 },
      speed: 0,
      mapMode: "faction",
      nextArmyNumber: 3,
      policies: { restore: true, benevolence: false, hegemony: false },
      armies: {
        tiger: { id: "tiger", name: "羽林第一军", commander: "军府都尉", province: "jingji", region: "changan", destination: null, destinationRegion: null, progress: 0, infantry: 390, archers: 90, cavalry: 30, morale: 76, supply: 86, status: "驻守长安", order: null, route: [], eta: null, movementProgress: 0, battleState: "idle" },
        feather: { id: "feather", name: "羽林第二军", commander: "李光弼", province: "jingji", region: "changan", destination: null, destinationRegion: null, progress: 0, infantry: 210, archers: 60, cavalry: 20, morale: 71, supply: 82, status: "京畿整训", order: null, route: [], eta: null, movementProgress: 0, battleState: "idle" },
      },
      attackPlans: {},
      playerSieges: {},
      enemyCampaigns: {},
      provinces,
      regions: cloneRegions(provinces),
      logs: [
        { type: "normal", date: `${ERA.reign} · 岁首`, text: "开元二十九年，玄宗在位近三十年。诸道军府权势渐长，朝廷须整饬边政、经营粮道并维持中央号令。" },
      ],
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY) || localStorage.getItem(MAP_V4_SAVE_KEY) || localStorage.getItem(OLD_SAVE_KEY) || localStorage.getItem(LEGACY_SAVE_KEY);
      if (!raw) {
        const oldRaw = localStorage.getItem(ANCIENT_SAVE_KEY);
        if (!oldRaw) return initialState();
        const old = JSON.parse(oldRaw);
        const migrated = initialState();
        ["started", "ruler", "kingdom", "scenarioType", "characterMode", "characterName", "politicalPath", "doctrine", "year", "season", "turns", "actionPoints", "gold", "grain", "population", "morale", "prestige", "farmLevel", "marketLevel", "wallLevel", "drill", "infantry", "archers", "cavalry", "sound"].forEach((key) => {
          if (old[key] !== undefined) migrated[key] = old[key];
        });
        // Legacy saves carried the old four-quarter index (where January was
        // incorrectly rendered as spring).  Re-derive it from the Tang
        // campaign month after migration so 741-01-01 is 岁首/冬季.
        migrated.season = seasonForMonth(migrated.calendar.month);
        migrated.logs = normalizeLogEntries([
          { type: "war", date: eraTextFor(migrated), text: "诸道政区重整为唐代道府州。旧朝国力与君主名号已承继，疆域自长安重新开拓。" },
          ...(old.logs || []).slice(0, 8),
        ], migrated.calendar);
        return migrated;
      }
      const parsed = JSON.parse(raw);
      return normalizeLoadedState(parsed) || initialState();
    } catch {
      return initialState();
    }
  }

  function normalizeLoadedState(parsed) {
    try {
      if (![2, 3, 4, 5].includes(parsed?.version) || !parsed.provinces) return null;
      const defaults = cloneProvinces();
      const savedProvinces = Object.fromEntries(Object.entries(parsed.provinces || {}).map(([id, province]) => [normalizeProvinceId(id), province]));
      const provinces = Object.fromEntries(Object.keys(defaults).map((id) => {
        const saved = savedProvinces[id] || {};
        return [id, {
          ...defaults[id],
          ...saved,
          // Historical labels and static geography belong to the current
          // Tang 741 scenario, never to a stale Han/legacy save cache.
          name: defaults[id].name,
          sigil: defaults[id].sigil,
          region: defaults[id].region,
          lore: defaults[id].lore,
          terrain: defaults[id].terrain,
          terrainMod: defaults[id].terrainMod,
          capital: defaults[id].capital,
          adjacent: defaults[id].adjacent,
        }];
      }));
      const base = initialState();
      const armies = parsed.armies || migrateArmies(parsed, base.armies);
      Object.values(armies).forEach((army) => {
        army.province = normalizeProvinceId(army.province);
        if (parsed.eraId !== ERA.id && army.region === "luoyang") {
          army.region = "changan";
          army.status = "驻守长安";
        }
        if (!REGIONS[army.region]) army.region = PROVINCE_CAPITAL_REGION[army.province] || "changan";
        if (army.destinationRegion && !REGIONS[army.destinationRegion]) army.destinationRegion = null;
        if (!parsed.regions) {
          army.destination = null;
          army.destinationRegion = null;
          army.progress = 0;
          army.status = `驻守${REGIONS[army.region].name}`;
        }
        normalizeArmyOrder(army);
      });
      const highestArmyNumber = Object.keys(armies).reduce((highest, id) => {
        const match = String(id).match(/^army-(\d+)$/);
        return match ? Math.max(highest, Number(match[1])) : highest;
      }, 2);
      const nextArmyNumber = Math.max(3, Number(parsed.nextArmyNumber) || 0, highestArmyNumber + 1);
      const regionDefaults = cloneRegions(provinces);
      const finiteOr = (value, fallback, minimum = 0) => {
        if (value == null || value === "") return fallback;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? Math.max(minimum, numeric) : fallback;
      };
      const regions = Object.fromEntries(Object.keys(regionDefaults).map((id) => {
        const fallback = regionDefaults[id];
        const saved = parsed.regions?.[id] || {};
        const legacyCombatFieldsMissing = saved.defense == null && saved.fortification == null;
        const defense = finiteOr(legacyCombatFieldsMissing ? null : (saved.defense ?? saved.fortification), fallback.defense);
        const savedGarrison = legacyCombatFieldsMissing ? null : saved.garrison;
        return [id, {
          ...fallback,
          ...saved,
          province: fallback.province,
          defense,
          fortification: defense,
          garrison: Math.round(finiteOr(savedGarrison, fallback.garrison)),
          fort: Math.round(finiteOr(saved.fort, fallback.fort)),
          population: Math.round(finiteOr(saved.population, fallback.population)),
          grain: Math.round(finiteOr(saved.grain, fallback.grain)),
          // Adjacency belongs to the versioned map topology, not to player state.
          // Always replace saved neighbor lists so older caches cannot reference
          // strategic regions that no longer exist in the current map dataset.
          neighbors: regionDefaults[id].neighbors.map((neighbor) => ({ ...neighbor })),
        }];
      }));
      Object.values(regions).forEach((region) => normalizeRegionControl(region));
      const attackPlans = normalizeAttackPlans(parsed.attackPlans, armies);
      const calendar = parsed.eraId === ERA.id ? { ...base.calendar, ...(parsed.calendar || {}) } : { ...base.calendar };
      calendar.year = Math.max(741, Math.floor(Number(calendar.year) || ERA.year));
      calendar.month = clamp(Math.floor(Number(calendar.month) || 1), 1, 12);
      calendar.day = clamp(Math.floor(Number(calendar.day) || 1), 1, DAYS_PER_MONTH);
      const rawScenarioType = parsed.scenarioType === "alternateHistory" ? "alternateHistory" : "historicalScenario";
      // A few pre-split saves recorded the scenario as historical while
      // already carrying an invented dynasty or a non-loyal political path.
      // Normalize those saves at the boundary so the HUD cannot show an
      // alternate dynasty together with the historical Tang ruler address.
      const scenarioType = rawScenarioType === "historicalScenario"
        && (parsed.kingdom && parsed.kingdom !== "大唐" || parsed.politicalPath && parsed.politicalPath !== "loyal")
        ? "alternateHistory"
        : rawScenarioType;
      const legacyScenarioName = rawScenarioType === "historicalScenario" && !parsed.scenarioType && parsed.kingdom === "大晟";
      return {
        ...base,
        ...parsed,
        version: SAVE_SCHEMA_VERSION,
        mapVersion: MAP_VERSION,
        historyDataVersion: HISTORY_DATA_VERSION,
        eraId: ERA.id,
        kingdom: legacyScenarioName ? "大唐" : (parsed.kingdom || base.kingdom),
        ruler: legacyScenarioName ? "玄宗" : (parsed.ruler || base.ruler),
        characterMode: parsed.characterMode === "custom" ? "custom" : "historical",
        characterName: parsed.characterName || parsed.ruler || base.characterName,
        politicalPath: ["loyal", "rebel", "independent", "observer"].includes(parsed.politicalPath) ? parsed.politicalPath : base.politicalPath,
        // Saves created before the Tang scenario are migrated to the new
        // campaign opening rather than displaying anachronistic 189 CE dates.
        calendar,
        season: seasonForMonth(calendar.month),
        year: Math.max(1, calendar.year - 740),
        policies: { ...base.policies, ...(parsed.policies || {}) },
        armies,
        nextArmyNumber,
        attackPlans,
        provinces,
        regions,
        playerSieges: parsed.playerSieges || {},
        enemyCampaigns: parsed.enemyCampaigns || {},
        logs: normalizeLogEntries(parsed.logs, calendar),
        scenarioType,
      };
    } catch {
      return null;
    }
  }

  function normalizeLogEntries(logs, calendar) {
    const legacyText = /御宇九州|山河执衡|十三州|汉室|司隶|公元189年|承平元年|新主即位|王业自长安始/;
    const entries = (Array.isArray(logs) ? logs : [])
      .filter((entry) => entry && typeof entry.text === "string"
        && !legacyText.test(entry.text)
        && !/(?:NaN|undefined|null)/.test(entry.text))
      .map((entry) => ({
        ...entry,
        text: entry.text
          .replaceAll("天下", "四海")
          .replaceAll("御宇九州", "国运")
          .replaceAll("山河执衡", "国运")
          .replaceAll("司隶", "都畿道"),
        date: typeof entry.date === "string" && !/189|承平/.test(entry.date) ? entry.date : eraTextFor({ calendar }),
      }))
      .slice(0, 40);
    return entries.length ? entries : [{
      type: "war",
      date: eraTextFor({ calendar }),
      text: "开元二十九年，玄宗在位近三十年。诸道军府权势渐长，朝廷须整饬边政、经营粮道并维持中央号令。",
    }];
  }

  function migrateArmies(old, defaults) {
    const migrated = structuredClone(defaults);
    const total = Math.max(1, (old.infantry || 0) + (old.archers || 0) + (old.cavalry || 0));
    Object.values(migrated).forEach((army, index) => {
      const share = index === 0 ? 0.64 : 0.36;
      army.infantry = Math.round((old.infantry || 0) * share);
      army.archers = Math.round((old.archers || 0) * share);
      army.cavalry = Math.round((old.cavalry || 0) * share);
      army.morale = old.morale || 68;
      army.supply = Math.min(100, 72 + Math.round((old.grain || 0) / Math.max(total, 1) * 10));
    });
    return migrated;
  }

  function persistStateNow() {
    localSaveTimer = 0;
    if (window.TianxiaMap?.isInteracting) {
      localSaveTimer = window.setTimeout(persistStateNow, 1000);
      return;
    }
    const serialized = JSON.stringify(state);
    try { localStorage.setItem(SAVE_KEY, serialized); } catch { /* Storage may be disabled. */ }
    lastLocalSaveAt = Date.now();
    if (serialized === lastPersistedStateJSON) return;
    lastPersistedStateJSON = serialized;
    window.TianxiaCloudSave?.markDirty();
    scheduleCloudSave();
  }

  function saveState({ realtime = false } = {}) {
    if (!realtime) {
      window.clearTimeout(localSaveTimer);
      persistStateNow();
      return;
    }
    // A cloud read may finish before the throttled local write. Record the
    // in-memory day/march change now so that read cannot replace it.
    window.TianxiaCloudSave?.markDirty();
    if (localSaveTimer) return;
    const remaining = Math.max(0, 1000 - (Date.now() - lastLocalSaveAt));
    localSaveTimer = window.setTimeout(persistStateNow, remaining);
  }

  function scheduleCloudSave(immediate = false) {
    if (!cloudSaveReady || !window.TianxiaCloudSave || window.TianxiaCloudSave.isAutoSyncDisabled()) return;
    if (cloudSaveTimer && !immediate) return;
    window.clearTimeout(cloudSaveTimer);
    const delay = immediate ? 0 : cloudRetryAttempt ? Math.min(30000, 1000 * (2 ** Math.min(cloudRetryAttempt - 1, 5))) : 5000;
    cloudSaveTimer = window.setTimeout(async () => {
      cloudSaveTimer = 0;
      if (cloudHydrationPending || window.TianxiaCloudSave.isAutoSyncDisabled()) return;
      try {
        await window.TianxiaCloudSave.save(state);
        cloudRetryAttempt = 0;
      } catch (error) {
        if (error?.code === "save_conflict" || error?.code === "auto_sync_disabled" || error?.code === "save_storage_full") return;
        cloudRetryAttempt = Math.min(cloudRetryAttempt + 1, 6);
        scheduleCloudSave(false);
      }
    }, delay);
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function fmt(value) {
    const numeric = Number(value);
    return numberFormat.format(Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0);
  }
  // Only literal template markup is trusted. Saves and imported names are
  // plain text, including when they contain characters that look like HTML.
  function safeHtml(strings, ...values) {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return strings.reduce((html, literal, index) => html + literal + (index < values.length
      ? String(values[index] ?? "").replace(/[&<>"']/g, (character) => entities[character])
      : ""), "");
  }
  function eraText() {
    const year = state.calendar?.year || ERA.year;
    const month = state.calendar?.month || 1;
    const day = state.calendar?.day || 1;
    const yearLabel = year === ERA.year ? ERA.reign : `公元${year}年`;
    return `${ERA.label}${yearLabel} · 公元${year}年${month}月${day}日`;
  }
  function eraTextFor(s) {
    const year = s.calendar?.year || ERA.year;
    const yearLabel = year === ERA.year ? ERA.reign : `公元${year}年`;
    const month = s.calendar?.month || 1;
    const day = s.calendar?.day || 1;
    return ERA.label + yearLabel + " · 公元" + year + "年" + month + "月" + day + "日";
  }
  function chineseNumber(value) {
    const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
    if (value === 1) return "元";
    if (value <= 10) return digits[value];
    if (value < 20) return `十${value % 10 ? digits[value % 10] : ""}`;
    return String(value);
  }

  function ownedProvinces(s = state) {
    return Object.keys(s.provinces).filter((id) => s.provinces[id].owner === "player");
  }

  function developmentProvince() {
    if (state.provinces[selectedProvince]?.owner === "player") return state.provinces[selectedProvince];
    return state.provinces[ownedProvinces()[0]];
  }

  function getFrontier() {
    const owned = new Set(ownedProvinces());
    return Object.keys(state.provinces).filter((id) => {
      if (owned.has(id)) return false;
      return state.provinces[id].adjacent.some((neighbor) => owned.has(neighbor));
    });
  }

  function getIncome() {
    const owned = ownedProvinces();
    const prosperity = owned.reduce((sum, id) => sum + state.provinces[id].prosperity, 0);
    const farms = owned.reduce((sum, id) => sum + (state.provinces[id].farms || 1), 0);
    const season = SEASONS[state.season];
    const moraleFactor = 0.75 + state.morale / 200;
    const gold = Math.round((55 * owned.length + state.marketLevel * 70 + prosperity * 1.5) * season.gold * moraleFactor);
    const grainGross = Math.round((80 * owned.length + farms * 80 + prosperity * 1.25) * season.grain * moraleFactor);
    const upkeep = getUpkeep();
    const population = Math.max(1, Math.round((prosperity * 0.004 + state.morale * 0.05) * (state.season === 1 ? 1.2 : 1)));
    return { gold, grain: grainGross - upkeep, grossGrain: grainGross, upkeep, population };
  }

  // One source of truth for the top bar and the monthly settlement report.
  function calculateMonthlyBalance() {
    const income = getIncome();
    return { ...income, netGrain: income.grain, netGold: income.gold, netPopulation: income.population };
  }

  function getUpkeep() {
    return Math.round(state.infantry * 0.055 + state.archers * 0.075 + state.cavalry * 0.2);
  }

  function nationalArmyTotals() {
    return activeArmies().reduce((totals, army) => ({
      infantry: totals.infantry + Math.max(0, army.infantry),
      archers: totals.archers + Math.max(0, army.archers),
      cavalry: totals.cavalry + Math.max(0, army.cavalry),
    }), { infantry: 0, archers: 0, cavalry: 0 });
  }

  function getArmyPower() {
    const totals = nationalArmyTotals();
    const unitPower = totals.infantry + totals.archers * 1.55 + totals.cavalry * 3.25;
    return Math.round(unitPower * state.drill * (0.78 + state.morale / 280));
  }

  function dispatchArmyPower() {
    return selectedArmies().reduce((sum, army) => sum + armyPower(army), 0);
  }

  function commandArmyPower(armies = selectedArmies()) {
    return armies.reduce((sum, army) => sum + armyPower(army), 0);
  }

  function isPlayerEmperor() {
    return state.scenarioType === "historicalScenario" && state.politicalPath === "loyal"
      && state.characterMode !== "custom" && (state.characterName || state.ruler) === "玄宗";
  }

  function playerRoleLabel() {
    if (isPlayerEmperor()) return "唐室天子";
    if (state.politicalPath === "loyal") {
      return state.characterMode !== "custom" && ["郭子仪", "李光弼"].includes(state.characterName || state.ruler)
        ? "唐室将领" : "地方主事";
    }
    return ({ rebel: "起兵主上", independent: "自立之主", observer: "地方使君" }[state.politicalPath] || "当家主事");
  }

  function playerAddress() {
    if (isPlayerEmperor()) return "陛下";
    return ({ loyal: "主公", rebel: "主上", independent: "大王", observer: "使君" }[state.politicalPath] || "主公");
  }

  function playerForceLabel() {
    if (state.politicalPath === "loyal" && state.scenarioType === "historicalScenario") return "王师";
    if (state.politicalPath === "rebel") return "义军";
    if (state.politicalPath === "independent") return "本军";
    return "部众";
  }

  function armySize(army) {
    return Math.max(0, Math.round(army.infantry + army.archers + army.cavalry));
  }

  function armyBadge(army) {
    const name = String(army?.name || "");
    return name.match(/第([一二三四五六七八九十]+)军/)?.[1]
      || name.match(/([一二三四五六七八九十]+)军/)?.[1]
      || name.slice(0, 1)
      || "军";
  }

  function armyPower(army) {
    const units = army.infantry + army.archers * 1.55 + army.cavalry * 3.25;
    return Math.round(units * (army.morale / 100) * (0.55 + army.supply / 200) * state.drill);
  }

  function activeArmies() {
    return Object.values(state.armies || {}).filter((army) => armySize(army) > 0);
  }

  function normalizeArmyOrder(army) {
    if (!army || typeof army !== "object") return army;
    if ("haltedLeg" in army) army.haltedLeg = normalizeTravelLeg(army.haltedLeg);
    const raw = army.order && typeof army.order === "object" ? army.order : null;
    const returnLeg = normalizeTravelLeg(raw?.returnLeg);
    const targetRegionId = raw?.targetRegionId || null;
    const rawRouteIndex = Number(raw?.routeIndex);
    const routeIndex = Number.isFinite(rawRouteIndex) ? clamp(Math.floor(rawRouteIndex), 0, 999) : null;
    const route = normalizeSavedRoute(raw?.route, targetRegionId, army.region, routeIndex);
    if (targetRegionId && (route.length >= 2 || (route.length === 1 && returnLeg))) {
      const normalizedRouteIndex = routeIndex == null
        ? Math.max(0, route.indexOf(army.region))
        : routeIndex;
      army.order = {
        id: raw?.id || `legacy-${army.id}-${targetRegionId}`,
        type: ARMY_ORDER_TYPES.includes(raw?.type) ? raw.type : "ATTACK",
        targetRegionId,
        route,
        routeIndex: clamp(normalizedRouteIndex, 0, Math.max(0, route.length - 1)),
        movementProgress: clamp(Number(raw?.movementProgress ?? army.movementProgress ?? army.progress) || 0, 0, 100),
        etaDays: Math.max(0, Math.floor(Number(raw?.etaDays ?? army.eta) || 0)),
        attackPlanId: raw?.attackPlanId || null,
        coordinationMode: COORDINATION_MODES.includes(raw?.coordinationMode)
          ? raw.coordinationMode
          : "ATTACK_ON_ARRIVAL",
        createdAt: raw?.createdAt || Date.now(),
        returnLeg,
      };
      army.route = route;
      army.eta = army.order.etaDays;
      army.movementProgress = army.order.movementProgress;
      army.progress = army.order.movementProgress;
      army.destinationRegion = targetRegionId;
      army.destination = army.destination || null;
      army.battleState = army.battleState || "marching";
    } else {
      army.order = null;
      army.route = [];
      army.eta = null;
      army.movementProgress = 0;
      army.progress = 0;
      army.destinationRegion = null;
      army.destination = null;
      army.battleState = army.battleState || "idle";
    }
    return army;
  }

  // Saved routes are untrusted state. Keep only real map nodes and real
  // adjacency edges so a stale/corrupt save can never make an army teleport
  // across the map after refresh. A route may contain a one-node target only
  // while a normalized returnLeg is bringing the army back to its route.
  function normalizeSavedRoute(rawRoute, targetRegionId, currentRegionId = null, routeIndex = 0) {
    if (!Array.isArray(rawRoute) || !targetRegionId) return [];
    const raw = rawRoute.filter((id) => typeof id === "string" && REGIONS[id]);
    const targetIndex = raw.lastIndexOf(targetRegionId);
    if (targetIndex < 0) return [];
    const candidate = raw.slice(0, targetIndex + 1);
    if (candidate.length < 2) return candidate;
    const hintedIndex = routeIndex != null && Number.isFinite(Number(routeIndex))
      ? Number(routeIndex)
      : Math.max(0, candidate.indexOf(currentRegionId));
    const currentIndex = clamp(hintedIndex, 0, candidate.length - 1);
    if (currentRegionId && candidate[currentIndex] !== currentRegionId) return [];
    for (let index = 1; index < candidate.length; index += 1) {
      const previous = REGIONS[candidate[index - 1]];
      const connected = (previous.neighbors || []).some((edge) => (typeof edge === "string" ? edge : edge.id) === candidate[index]);
      if (!connected) return [];
    }
    return candidate;
  }

  function normalizeAttackPlans(rawPlans, armies) {
    if (!rawPlans || typeof rawPlans !== "object") return {};
    const normalized = {};
    Object.entries(rawPlans).forEach(([planId, raw]) => {
      if (!raw || typeof raw !== "object" || !REGIONS[raw.targetRegionId]) return;
      const ids = [...new Set(Array.isArray(raw.armyIds) ? raw.armyIds.filter((id) => armies[id]) : [])];
      const members = ids.filter((id) => armies[id]?.order?.attackPlanId === planId);
      if (!members.length) return;
      const routesByArmyId = {};
      members.forEach((id) => {
        const route = normalizeSavedRoute(
          raw.routesByArmyId?.[id] || armies[id].order.route,
          raw.targetRegionId,
          armies[id].region,
          armies[id].order.routeIndex,
        );
        if (route.length >= 2 || (route.length === 1 && armies[id].order.returnLeg)) routesByArmyId[id] = route;
      });
      const validMembers = members.filter((id) => routesByArmyId[id]);
      if (!validMembers.length) return;
      // A single surviving member does not need a coordination plan. Clear
      // the dangling reference and let its individual order proceed normally.
      if (validMembers.length === 1) {
        armies[validMembers[0]].order.attackPlanId = null;
        return;
      }
      const coordinationMode = COORDINATION_MODES.includes(raw.coordinationMode)
        ? raw.coordinationMode
        : "ATTACK_ON_ARRIVAL";
      normalized[planId] = {
        id: planId,
        armyIds: validMembers,
        targetRegionId: raw.targetRegionId,
        routesByArmyId,
        coordinationMode,
        status: raw.status === "resolving" ? "marching" : raw.status || "marching",
        arrivedArmyIds: [...new Set((Array.isArray(raw.arrivedArmyIds) ? raw.arrivedArmyIds : []).filter((id) => validMembers.includes(id)))],
        createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
      };
    });
    return normalized;
  }

  // A location on an edge is geography + game-time progress, never a saved
  // screen coordinate. It remains valid after zoom, projection or save reload.
  function normalizeTravelLeg(leg) {
    if (!leg || !REGIONS[leg.fromRegionId] || !REGIONS[leg.toRegionId]
      || leg.fromRegionId === leg.toRegionId) return null;
    // Save hydration runs before `state` exists. Validate against static
    // adjacency, not runtime routeBetween/state.regions.
    if (!(REGIONS[leg.fromRegionId].neighbors || []).some((edge) => (typeof edge === "string" ? edge : edge.id) === leg.toRegionId)) return null;
    return { fromRegionId: leg.fromRegionId, toRegionId: leg.toRegionId,
      progress: clamp(Number(leg.progress) || 0, 0, 100) };
  }

  function armyTravelLeg(army) {
    if (army.order?.returnLeg) return army.order.returnLeg;
    const order = army.order;
    if (order?.route?.length && order.routeIndex < order.route.length - 1) {
      return { fromRegionId: order.route[order.routeIndex], toRegionId: order.route[order.routeIndex + 1],
        progress: clamp(Number(order.movementProgress) || 0, 0, 100) };
    }
    return army.haltedLeg || null;
  }

  function armyMapPosition(army) {
    const leg = armyTravelLeg(army);
    if (!leg) return regionPosition(army.region || PROVINCE_CAPITAL_REGION[army.province]);
    const from = regionPosition(leg.fromRegionId), to = regionPosition(leg.toRegionId);
    const progress = leg.progress / 100;
    return [from[0] + (to[0] - from[0]) * progress, from[1] + (to[1] - from[1]) * progress];
  }

  function armyPositionKey(army) {
    const leg = armyTravelLeg(army);
    return leg ? `${leg.fromRegionId}>${leg.toRegionId}:${leg.progress}` : army.region;
  }

  function syncSelectedArmySelection() {
    const valid = selectedArmyIds.filter((id) => state.armies?.[id] && armySize(state.armies[id]) > 0);
    selectedArmyIds = [...new Set(valid)];
  }

  const hasSelectedArmy = (armyId) => selectedArmyIds.includes(armyId);

  function selectedArmies() {
    syncSelectedArmySelection();
    return selectedArmyIds.map((id) => state.armies[id]).filter(Boolean);
  }

  // Keep all command/detail paths on the real multi-selection source of truth.
  function primarySelectedArmy() {
    return selectedArmies()[0] || null;
  }

  function commandArmies() {
    return selectedArmies().filter((army) => army.battleState !== "destroyed");
  }

  function findRoute(startId, targetId, { retreat = false, avoidRegions = [] } = {}) {
    if (!startId || !targetId || startId === targetId || !state.regions[startId] || !state.regions[targetId]) return startId === targetId ? [startId] : null;
    const queue = [[startId, [startId]]];
    const visited = new Set([startId]);
    const avoid = new Set(avoidRegions);
    while (queue.length) {
      const [current, route] = queue.shift();
      const neighbors = regionNeighbors(current)
        .sort((a, b) => (a.kind === "road" ? 0 : 1) - (b.kind === "road" ? 0 : 1));
      for (const neighbor of neighbors) {
        const next = state.regions[neighbor.id];
        if (!next || visited.has(next.id)) continue;
        const isTarget = next.id === targetId;
        if (!isTarget && avoid.has(next.id)) continue;
        const friendly = regionController(next) === "player";
        if (retreat && !friendly && !isTarget) continue;
        if (!retreat && !friendly && !isTarget) continue;
        const nextRoute = [...route, next.id];
        if (isTarget) return nextRoute;
        visited.add(next.id);
        queue.push([next.id, nextRoute]);
      }
    }
    return null;
  }

  function routeDistance(route = []) {
    return Math.max(1, route.slice(0, -1).reduce((sum, id, index) => {
      const edge = routeBetween(id, route[index + 1]);
      return sum + ({ road: 1, water: .9, river: 1.2, mountain: 1.45, pass: 1.6 }[edge?.kind] || 1);
    }, 0));
  }

  function routesForArmies(armies, targetId, { type = "ATTACK" } = {}) {
    const routesByArmyId = {};
    const usedInterior = new Set();
    armies.forEach((army) => {
      let route = findRoute(army.region, targetId, { retreat: type === "RETREAT", avoidRegions: [...usedInterior] });
      // If a second route cannot avoid the first corridor, retain the valid
      // shortest route rather than making a command impossible.  When the
      // topology has genuine alternatives this produces distinct attacking
      // edges and lets the battle resolver award envelopment correctly.
      if (!route) route = findRoute(army.region, targetId, { retreat: type === "RETREAT" });
      if (route?.length > 1 || (route?.length === 1 && armyTravelLeg(army)?.progress > 0)) {
        route.slice(1, -1).forEach((id) => usedInterior.add(id));
        routesByArmyId[army.id] = route;
      }
    });
    return routesByArmyId;
  }

  function makeArmyOrder(army, targetRegionId, { type = "ATTACK", route = null, attackPlanId = null, coordinationMode = "ATTACK_ON_ARRIVAL" } = {}) {
    const resolvedRoute = route || findRoute(army.region, targetRegionId, { retreat: type === "RETREAT" });
    const leg = armyTravelLeg(army);
    if (!resolvedRoute?.length || (resolvedRoute.length < 2 && !leg?.progress)) return null;
    const continuing = leg?.fromRegionId === army.region && leg?.toRegionId === resolvedRoute[1];
    // An order in another direction must retrace the current edge before
    // taking the new route. Do not teleport back to the last visited city.
    const returnLeg = leg?.progress > 0 && !continuing
      ? leg.toRegionId === army.region ? { ...leg }
        : { fromRegionId: leg.toRegionId, toRegionId: leg.fromRegionId, progress: 100 - leg.progress }
      : null;
    const progress = continuing ? leg.progress : 0;
    const etaDays = estimateArmyArrival(army, { route: resolvedRoute, routeIndex: 0, movementProgress: progress, returnLeg });
    return {
      id: `order-${army.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      targetRegionId,
      route: resolvedRoute,
      routeIndex: 0,
      movementProgress: progress,
      returnLeg,
      etaDays,
      attackPlanId,
      coordinationMode,
      createdAt: Date.now(),
    };
  }

  // Forecast the same daily edge progression as the simulation, without
  // mutating the army. ETA must not drift as a separate countdown.
  function estimateArmyArrival(army, order) {
    let supply = army.supply;
    let days = 0;
    const routeIndex = Number.isFinite(Number(order?.routeIndex))
      ? Math.max(0, Math.floor(Number(order.routeIndex)))
      : 0;
    const movementProgress = Number.isFinite(Number(order?.movementProgress))
      ? clamp(Number(order.movementProgress), 0, 100)
      : 0;
    const legs = [];
    if (order.returnLeg) legs.push(order.returnLeg);
    const route = Array.isArray(order?.route) ? order.route : [];
    for (let i = routeIndex; i < route.length - 1; i++) {
      legs.push({ fromRegionId: route[i], toRegionId: route[i + 1], progress: i === routeIndex ? movementProgress : 0 });
    }
    for (const leg of legs) {
      const region = state.regions[leg.toRegionId];
      if (!region) return days;
      const edge = routeBetween(leg.fromRegionId, leg.toRegionId);
      const modifier = regionTerrainModifier(region, edge?.kind || "road");
      const cavalry = army.cavalry / Math.max(1, armySize(army)) * (/平原|河谷/.test(region.terrain) ? 9 : 2);
      let progress = leg.progress || 0;
      while (progress < 100) {
        progress += Math.max(2.5, (9 + supply / 22 + cavalry) / modifier);
        supply = Math.max(0, supply - (edge?.kind === "water" ? .8 : modifier * .95));
        days++;
      }
    }
    return days;
  }

  function syncNationalArmyTotals() {
    const totals = nationalArmyTotals();
    state.infantry = totals.infantry;
    state.archers = totals.archers;
    state.cavalry = totals.cavalry;
  }

  function distributeArmyLoss(army, totalLoss) {
    if (!army || totalLoss <= 0) return 0;
    const size = armySize(army);
    if (!size) return 0;
    const actual = Math.min(size, Math.round(totalLoss));
    const infantryLoss = Math.min(army.infantry, Math.round(actual * army.infantry / size));
    const archerLoss = Math.min(army.archers, Math.round(actual * army.archers / size));
    const cavalryLoss = Math.min(army.cavalry, Math.max(0, Math.round(actual * army.cavalry / size)));
    army.infantry -= infantryLoss;
    army.archers -= archerLoss;
    army.cavalry -= cavalryLoss;
    let remainder = Math.max(0, actual - infantryLoss - archerLoss - cavalryLoss);
    ["infantry", "archers", "cavalry"].forEach((type) => {
      if (!remainder) return;
      const extra = Math.min(army[type], remainder);
      army[type] -= extra;
      remainder -= extra;
    });
    syncNationalArmyTotals();
    return actual - remainder;
  }

  function ownerName(owner) {
    if (owner === "player") return `${displayKingdomName()} · ${state.ruler}`;
    return FACTIONS[owner]?.name || "无名诸侯";
  }

  function normalizeRegionControl(region) {
    if (!region) return region;
    const ownerId = region.ownerId || region.owner || "neutral";
    const controllerId = region.controllerId || ownerId;
    // Keep the legacy owner field for the existing simulation while exposing
    // explicit owner/controller IDs to the map and save schema.
    region.owner = ownerId;
    region.ownerId = ownerId;
    region.controllerId = controllerId;
    return region;
  }

  function setRegionControl(region, controllerId, ownerId = controllerId) {
    if (!region) return;
    region.owner = ownerId;
    region.ownerId = ownerId;
    region.controllerId = controllerId;
  }

  function rankText() {
    if (isPlayerEmperor()) return "天子临御";
    const count = ownedProvinces().length;
    if (count === 9) return "四海共主";
    if (count >= 10) return "诸道霸主";
    if (count >= 5) return "中原盟主";
    if (count >= 3) return "雄踞一方";
    return count > 0 ? "据有一方" : "暂居一隅";
  }

  function mandateText() {
    const score = state.morale * 0.55 + Math.min(state.prestige, 100) * 0.2 + ownedProvinces().length * 4;
    if (score >= 78) return "天命昭昭";
    if (score >= 60) return "人心归附";
    if (score >= 42) return "方兴未艾";
    if (score >= 25) return "根基动摇";
    return "危如累卵";
  }

  function hasResources(cost = {}) {
    return (!cost.gold || state.gold >= cost.gold)
      && (!cost.grain || state.grain >= cost.grain)
      && (!cost.population || state.population >= cost.population);
  }

  function spend(cost = {}) {
    state.gold -= cost.gold || 0;
    state.grain -= cost.grain || 0;
    state.population -= cost.population || 0;
  }

  function costText(cost = {}) {
    const parts = [];
    if (cost.gold) parts.push(`${fmt(cost.gold)} 贯`);
    if (cost.grain) parts.push(`${fmt(cost.grain)} 粮`);
    if (cost.population) parts.push(`${fmt(cost.population)} 人口点`);
    return parts.length ? parts.join(" · ") : "无资源消耗";
  }

  function addLog(text, type = "normal") {
    state.logs.unshift({ type, date: eraText(), text });
    state.logs = state.logs.slice(0, 50);
  }

  function toast(message, type = "normal") {
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.textContent = message;
    $("toastStack").appendChild(node);
    window.setTimeout(() => node.remove(), 3100);
  }

  function updateCloudStatus(detail = window.TianxiaCloudSave?.getStatus?.() || { state: "offline", message: "仅使用本地缓存" }) {
    const rawState = detail.state || (navigator.onLine === false ? "offline" : "connecting");
    const stateName = new Set(["ready", "syncing", "connecting", "offline", "conflict", "failed", "idle"]).has(rawState)
      ? rawState
      : "failed";
    const autoSyncDisabled = window.TianxiaCloudSave?.isAutoSyncDisabled?.() === true;
    const incompatibleCloudSave = window.TianxiaCloudSave?.getAutoSyncReason?.() === "incompatible";
    const hasSynced = stateName === "ready" && !autoSyncDisabled;
    const button = $("cloudButton");
    const panel = $("cloudState");
    if (button) button.dataset.cloudState = stateName;
    if (panel) panel.dataset.cloudState = stateName;
    // Never leave production in an ambiguous "connecting" state.  The save
    // client resolves the initial request to ready/offline/conflict; unknown
    // states are treated as a failed sync and remain safely local-only.
    $("cloudButtonText").textContent = autoSyncDisabled ? "仅本地缓存" : hasSynced ? "云端已同步" : stateName === "connecting" ? "连接中 · 云端" : stateName === "syncing" ? "同步中 · 云端" : stateName === "offline" ? "离线 · 本地缓存" : stateName === "conflict" ? "版本冲突" : stateName === "idle" ? "云端待命" : "同步失败";
    if (panel) panel.querySelector("b").textContent = incompatibleCloudSave && inspectedCloudReadable ? "云端存档已更新" : incompatibleCloudSave ? "云端存档版本不兼容" : autoSyncDisabled ? "云端自动同步已暂停" : hasSynced ? "云端已同步" : stateName === "connecting" ? "连接中 · 云端" : stateName === "syncing" ? "同步中 · 云端" : stateName === "offline" ? "离线，仅使用本地缓存" : stateName === "conflict" ? "同步失败 · 云端版本冲突" : stateName === "idle" ? "云端待命" : "同步失败";
    if (panel) panel.querySelector("small").textContent = incompatibleCloudSave && inspectedCloudReadable ? "云端现有进度可以读取。自动同步仍暂停；立即同步会要求确认覆盖。" : incompatibleCloudSave ? "本机缓存和云端存档均已保留。点击立即同步并确认后，可用本机进度替换云端。" : autoSyncDisabled ? detail.message || "手动同步可重新启用云端存档" : detail.updatedAt
      ? `最近同步：${new Date(detail.updatedAt).toLocaleString("zh-CN")}`
      : detail.message || (stateName === "offline" ? "恢复联网后将自动重试；本地进度不会丢失" : stateName === "conflict" ? "另一台设备已更新这份王业，请读取后再保存" : stateName === "connecting" ? "正在连接 Cloudflare 云端" : stateName === "syncing" ? "正在同步 Cloudflare 云端" : "本地缓存可在断网时继续使用");
    const note = $("autosaveNote");
    // Keep the idle label clear while the first cloud request is pending.
    if (note) note.dataset.cloudState = stateName;
    if (note) note.querySelector("b").textContent = autoSyncDisabled ? "自动同步已暂停 · 本地缓存可用" : hasSynced ? "云端已同步" : stateName === "connecting" ? "连接中 · 本地缓存可用" : stateName === "syncing" ? "同步中 · 本地缓存可用" : stateName === "offline" ? "离线 · 仅本地缓存" : stateName === "conflict" ? "同步失败 · 云端版本冲突" : stateName === "idle" ? "云端待命 · 本地缓存可用" : "同步失败 · 本地缓存可用";
  }

  function setCloudControlsBusy(busy) {
    cloudControlsBusy = busy;
    ["copyCloudCode", "importCloudButton", "syncCloudButton", "deleteCloudButton"].forEach((id) => { const control = $(id); if (control) control.disabled = busy; });
  }

  function openCloudModal() {
    const client = window.TianxiaCloudSave;
    if (!client) return toast("云端存档模块未能加载", "bad");
    const dialog = ensureModal("cloudModal");
    if (!dialog) return;
    dialog.querySelector("#cloudCode").value = client.ensureAccessCode();
    updateCloudStatus();
    setCloudControlsBusy(cloudHydrationPending || cloudControlsBusy);
    dialog.showModal();
  }

  async function copyCloudCode() {
    const input = $("cloudCode");
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand("copy");
    }
    toast("云端存档码已复制，请妥善保管", "good");
  }

  async function applyRemoteSave(remote) {
    const restored = normalizeLoadedState(remote?.state);
    if (!restored) throw new Error("云端存档版本不兼容");
    state = restored;
    lastPersistedStateJSON = JSON.stringify(restored);
    try { localStorage.setItem(SAVE_KEY, lastPersistedStateJSON); } catch { /* Local cache is optional. */ }
    selectedProvince = normalizeProvinceId(state.armies?.tiger?.province || ownedProvinces(state)[0] || "jingji");
    selectedRegionId = state.armies?.tiger?.region || PROVINCE_CAPITAL_REGION[selectedProvince] || "changan";
    selectedArmyIds = [];
    selectedMapObjectType = "region";
    clearPendingRegionOrder(false);
    render();
    restartStrategicClock();
    if (state.started && $("setupModal")?.open) $("setupModal").close();
  }

  async function initializeCloudSave() {
    const client = window.TianxiaCloudSave;
    if (!client) {
      updateCloudStatus({ state: "offline", message: "云端模块不可用，仅使用本地缓存" });
      return;
    }
    updateCloudStatus({ state: "syncing", message: "正在读取云端存档" });
    const previousSnapshot = client.snapshotAccessCode();
    const remote = await client.load();
    cloudSaveReady = true;
    if (remote.cancelled) return;
    if (remote.found && !remote.localDirty && !remote.autoSyncDisabled) {
      try {
        await applyRemoteSave(remote);
        toast("已从云端恢复王业", "good");
      } catch {
        client.restoreAccessCode(previousSnapshot);
        client.suppressAutoSync("incompatible");
        toast("云端存档不兼容，继续使用本地缓存", "bad");
      }
    } else if (!remote.offline && !remote.conflict && !remote.autoSyncDisabled && !client.isAutoSyncDisabled()) {
      scheduleCloudSave(true);
    }
    if ($("cloudCode")) $("cloudCode").value = client.ensureAccessCode();
    updateCloudStatus();
  }

  async function syncCloudNow() {
    if (cloudHydrationPending) return toast("云端存档正在读取，请稍后再同步", "bad");
    const client = window.TianxiaCloudSave;
    setCloudControlsBusy(true);
    try {
      if (client.getAutoSyncReason?.() === "incompatible") {
        const inspection = await client.inspectRemoteSave();
        if (inspection.cancelled) return;
        inspectedCloudReadable = inspection.found && Boolean(normalizeLoadedState(inspection.state));
        updateCloudStatus();
        const lastSaved = inspection.updatedAt ? `（${new Date(inspection.updatedAt).toLocaleString("zh-CN")} 更新）` : "";
        const prompt = inspectedCloudReadable
          ? `云端存档${lastSaved}现在可以读取，可能包含另一台设备的新进度。确定仍用本机缓存覆盖云端吗？此操作会覆盖云端进度。`
          : inspection.found
          ? `云端存档${lastSaved}与当前版本不兼容。确定用本机缓存替换这份云端存档吗？此操作会覆盖云端进度。`
          : "云端存档当前为空。确定将本机缓存写入云端吗？";
        if (!window.confirm(prompt)) return;
        await client.overwriteRemote(state, inspection);
        inspectedCloudReadable = false;
      } else {
        await client.save(state, { manual: true });
      }
      toast("云端同步完成", "good");
    } catch (error) {
      toast(error?.code === "save_conflict" ? "云端存档已变化，请重新检查后再同步" : "云端同步失败，本地缓存没有丢失", "bad");
    } finally {
      setCloudControlsBusy(false);
    }
  }

  async function importCloudSave() {
    if (cloudHydrationPending) return toast("云端存档正在读取，请稍后再连接", "bad");
    const client = window.TianxiaCloudSave;
    const code = client.normalizeAccessCode($("importCloudCode").value);
    if (!code) return toast("请输入完整有效的云端存档码", "bad");
    const previousCode = client.ensureAccessCode();
    let previousSnapshot;
    cloudHydrationPending = true;
    restartStrategicClock();
    updateHeader();
    window.clearTimeout(cloudSaveTimer);
    cloudSaveTimer = 0;
    setCloudControlsBusy(true);
    try {
      await client.waitForPendingSaves();
      previousSnapshot = client.setAccessCode(code);
      inspectedCloudReadable = false;
      $("cloudCode").value = code;
      const remote = await client.load();
      if (remote.offline || remote.cancelled) throw new Error("cloud unavailable");
      if (remote.localDirty || remote.conflict) throw new Error("unsynced local save");
      if (remote.found) {
        await applyRemoteSave(remote);
        toast("另一台设备的王业已恢复", "good");
      } else {
        await client.save(state, { manual: true });
        toast("此存档码原本为空，当前王业已写入", "good");
      }
    } catch {
      if (previousSnapshot && client.getAccessCode() === code) client.restoreAccessCode(previousSnapshot);
      $("cloudCode").value = client.getAccessCode() || previousCode;
      toast("连接云端存档失败", "bad");
    } finally {
      cloudHydrationPending = false;
      restartStrategicClock();
      updateHeader();
      if (client.isDirty?.() && !client.isAutoSyncDisabled?.()) scheduleCloudSave(false);
      setCloudControlsBusy(false);
    }
  }

  async function deleteCloudSave() {
    if (cloudHydrationPending) return toast("云端存档正在读取，请稍后再删除", "bad");
    if (!window.confirm("确定永久删除这份云端存档吗？本机缓存仍会保留。")) return;
    setCloudControlsBusy(true);
    try {
      await window.TianxiaCloudSave.remove();
      window.clearTimeout(cloudSaveTimer);
      cloudSaveTimer = 0;
      cloudRetryAttempt = 0;
      toast("云端存档已删除，本机缓存仍在", "good");
    } catch {
      toast("删除云端存档失败", "bad");
    } finally {
      setCloudControlsBusy(false);
    }
  }

  function sound(kind = "tap") {
    if (!state.sound) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      oscillator.type = kind === "war" ? "sawtooth" : "sine";
      oscillator.frequency.setValueAtTime(kind === "good" ? 520 : kind === "war" ? 105 : 260, now);
      oscillator.frequency.exponentialRampToValueAtTime(kind === "war" ? 55 : 180, now + 0.1);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(kind === "war" ? 0.07 : 0.035, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === "war" ? 0.24 : 0.12));
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.25);
    } catch { /* Audio is a nonessential enhancement. */ }
  }

  function updateResources() {
    syncNationalArmyTotals();
    const income = calculateMonthlyBalance();
    $("goldValue").textContent = fmt(state.gold);
    $("grainValue").textContent = fmt(state.grain);
    $("populationValue").textContent = fmt(state.population);
    $("moraleValue").textContent = `${fmt(state.morale)}%`;
    $("prestigeValue").textContent = fmt(state.prestige);
    $("goldIncome").textContent = `+${fmt(income.gold)}/月`;
    $("grainIncome").textContent = `净 ${income.grain >= 0 ? "+" : ""}${Math.round(income.grain)}/月`;
    $("grainIncome").classList.toggle("negative", income.grain < 0);
    $("populationIncome").textContent = `+${fmt(income.population)}点/月`;
    $("moraleTrend").textContent = state.morale >= 75 ? "归心" : state.morale >= 50 ? "安定" : state.morale >= 30 ? "不安" : "怨沸";
    $("moraleTrend").classList.toggle("negative", state.morale < 35);
    $("rankLabel").textContent = rankText();
    $("totalArmyValue").textContent = fmt(activeArmies().reduce((sum, army) => sum + armySize(army), 0));
    $("armyStatus").textContent = `${activeArmies().length} 个军团`;
  }

  function updateHeader() {
    $("yearLabel").textContent = eraText();
    $("mapTitle").textContent = "天下舆图";
    $("mapYearLabel").textContent = `${displayKingdomName()} · 十五道 · 公元${state.calendar?.year || ERA.year}年`;
    $("actionPointsLabel").textContent = `令 ${state.actionPoints}/${MAX_ACTIONS}`;
    $("actionPips").replaceChildren();
    for (let i = 0; i < MAX_ACTIONS; i += 1) {
      const pip = document.createElement("i");
      pip.classList.toggle("used", i >= state.actionPoints);
      $("actionPips").appendChild(pip);
    }
    $("actionPips").setAttribute("aria-label", `本月剩余 ${state.actionPoints} 点政令`);
    $("soundButton").textContent = state.sound ? "◖" : "×";
    $("soundButton").title = state.sound ? "关闭音效" : "开启音效";
    document.querySelectorAll("[data-speed]").forEach((button) => {
      const active = Number(button.dataset.speed) === state.speed;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    $("pauseButton").textContent = state.speed === 0 ? "▶" : "Ⅱ";
    $("pauseButton").setAttribute("aria-label", state.speed === 0 ? "继续" : "暂停");
    $("pauseButton").title = state.speed === 0 ? "继续推进" : "暂停时间";
    $("clockStatus").textContent = cloudHydrationPending && state.speed > 0 ? "读取云端 · 暂停中" : state.speed === 0 ? "已暂停" : `${state.speed}× 推演中`;
    $("clockStatus").classList.toggle("running", state.speed > 0 && !cloudHydrationPending);
  }

  function updateRuler() {
    $("rulerName").textContent = state.ruler;
    $("rulerInitial").textContent = state.ruler.slice(0, 1) || "君";
    const roleLabel = playerRoleLabel();
    const roleNode = $("rulerRole");
    if (roleNode) roleNode.textContent = roleLabel;
    const acknowledge = $("helpAcknowledge");
    if (acknowledge) acknowledge.textContent = "已知晓";
    const dynastyLabel = state.scenarioType === "historicalScenario" ? "历史剧本" : "架空王朝";
    $("kingdomName").textContent = `${dynastyLabel} · ${displayKingdomName()} · ${PROVINCES[ownedProvinces()[0]]?.name || "流亡"}`;
    $("mandateText").textContent = mandateText();
    const mandate = clamp(state.morale * 0.65 + Math.min(state.prestige, 100) * 0.2 + ownedProvinces().length * 2, 4, 100);
    $("mandateFill").style.width = `${mandate}%`;
  }

  function updateGoal() {
    const count = ownedProvinces().length;
    const percent = Math.round((count / TOTAL_PROVINCES) * 100);
    $("ownedCount").textContent = String(count);
    $("unityPercent").textContent = `${percent}%`;
    $("unityFill").style.width = `${percent}%`;
    $("goalHint").textContent = count >= 10
      ? "诸道将定，谨防藩镇临死反扑。"
      : count >= 5
        ? "中原震动，攻城同时须留兵守土。"
        : "先击退城外守军，再围州治；一州非一战可下。";
  }

  function updateSeason() {
    const season = SEASONS[state.season];
    $("seasonIcon").textContent = season.name;
    $("seasonName").textContent = season.title;
    $("seasonEffect").textContent = season.effect;
  }

  function renderMap() {
    const mapMode = state.mapMode || "faction";
    if (mapMode !== lastMapMode) {
      if (lastMapMode) document.body.classList.remove(`map-mode-${lastMapMode}`);
      document.body.classList.add(`map-mode-${mapMode}`);
      lastMapMode = mapMode;
    }
    bindTerritoryEvents();
    const frontier = new Set(getFrontier());
    const selectedRegionProvince = state.regions[selectedRegionId]?.province;
    const commandArmyList = commandArmies();
    const commandReady = commandArmyList.length > 0;
    $("territoryLayer")?.classList.toggle("has-region-selection", Boolean(selectedRegionId));
    $("territoryLayer")?.classList.toggle("army-command-mode", commandReady);
    document.querySelectorAll(".territory").forEach((node) => {
      const id = node.dataset.id;
      const province = state.provinces[id];
      if (!province) return;
      const strength = state.mapMode === "economy"
        ? clamp(province.prosperity, 20, 90)
        : state.mapMode === "morale"
          ? clamp(province.owner === "player" ? state.morale - (province.unrest || 0) : 35 + province.defense / 3, 10, 95)
          : clamp((province.farms || 1) * 22 + province.prosperity / 2, 15, 95);
      const renderKey = [province.owner, id === selectedProvince, frontier.has(id), Boolean(province.siege || state.enemyCampaigns[id]), id === selectedRegionProvince, province.farms, province.barracks, strength, mapMode, state.kingdom].join("|");
      if (node.dataset.renderKey === renderKey) return;
      node.dataset.renderKey = renderKey;
      node.classList.toggle("player", province.owner === "player");
      node.classList.toggle("selected", id === selectedProvince);
      node.classList.toggle("attackable", frontier.has(id));
      node.classList.toggle("besieged", Boolean(province.siege || state.enemyCampaigns[id]));
      node.classList.toggle("selected-region-province", id === selectedRegionProvince);
      node.style.setProperty("--farm-scale", `${clamp(0.8 + (province.farms || 1) * 0.08, 0.88, 1.35)}`);
      node.style.setProperty("--camp-scale", `${clamp(0.86 + (province.barracks || 1) * 0.07, 0.92, 1.28)}`);
      node.style.setProperty("--mode-strength", `${strength}%`);
      node.style.setProperty("--faction-color", factionColor(province.owner));
      const owner = node.querySelector(".map-owner");
      const ownerLabel = province.owner === "player" ? state.kingdom : FACTIONS[province.owner]?.name || "群雄";
      if (owner) owner.textContent = ownerLabel;
      node.setAttribute("aria-label", `${province.name}，${ownerName(province.owner)}`);
    });
    document.querySelectorAll("[data-region-cell]").forEach((cell) => {
      const id = cell.dataset.regionCell;
      const region = state.regions[id];
      const regionOwner = regionController(region) || state.provinces[region?.province]?.owner || "neutral";
      const route = commandReady && commandArmyList.some((army) => findRoute(army.region, id)) ? true : null;
      const selected = id === selectedRegionId;
      const isOrigin = commandReady && commandArmyList.some((army) => id === army.region);
      const canMove = Boolean(route && regionController(region) === "player");
      const canAttack = Boolean(route && regionController(region) !== "player");
      const hasPoliticalFrontier = Boolean(regionNeighbors(region).some(({ id: neighborId }) => regionController(state.regions[neighborId]) !== regionOwner));
      cell.classList.toggle("selected-region-cell", selected);
      cell.classList.toggle("army-origin-cell", isOrigin);
      cell.classList.toggle("move-target-cell", canMove);
      cell.classList.toggle("attack-target-cell", canAttack);
      cell.classList.toggle("unreachable-cell", commandReady && !selected && !isOrigin && !route);
      cell.classList.toggle("order-target-cell", id === pendingOrderTargetId);
      cell.classList.toggle("political-frontier-cell", hasPoliticalFrontier);
      cell.dataset.regionOwner = regionOwner;
      cell.dataset.regionController = regionController(region) || regionOwner;
      cell.dataset.regionOwnerId = region?.ownerId || regionOwner;
      cell.style.setProperty("--faction-color", factionColor(regionOwner));
      if (region) cell.setAttribute("aria-label", `${regionDisplayName(region, state.calendar.year)}，${PROVINCES[region.province].name}${region.admin}，${regionOwnerName(region)}，${region.terrain}，驻军${region.garrison}`);
    });
    document.querySelectorAll("[data-occupation-region]").forEach((hatch) => {
      const region = state.regions[hatch.dataset.occupationRegion];
      const ownerId = region?.ownerId || region?.owner;
      const controllerId = regionController(region);
      hatch.classList.toggle("visible", Boolean(ownerId && controllerId && ownerId !== controllerId));
    });
    document.querySelectorAll("#regionBorderLayer [data-border-a]").forEach((border) => {
      const left = state.regions[border.dataset.borderA];
      const right = state.regions[border.dataset.borderB];
      const outer = !right;
      const leftController = regionController(left);
      const rightController = regionController(right);
      const political = !outer && leftController !== rightController;
      const frontline = political && (
        left?.contested
        || right?.contested
        || state.enemyCampaigns[left?.province]
        || state.enemyCampaigns[right?.province]
        || state.provinces[left?.province]?.siege
        || state.provinces[right?.province]?.siege
      );
      border.classList.toggle("outer-region-border", outer);
      border.classList.toggle("political-border", political);
      border.classList.toggle("frontline-border", Boolean(frontline));
      border.style.setProperty("--border-faction-color", factionColor(leftController));
    });
    if (PERFORMANCE_MODE) return;
    document.querySelectorAll(".province-label").forEach((node) => {
      const id = node.dataset.id;
      const province = state.provinces[id];
      if (!province) return;
      const labelKey = `${province.owner}|${province.name}|${state.kingdom}`;
      if (node.dataset.renderKey !== labelKey) {
        node.dataset.renderKey = labelKey;
        node.querySelector(".province-name").textContent = province.name;
        node.querySelector(".province-owner").textContent = province.owner === "player" ? state.kingdom : FACTIONS[province.owner]?.short || "群雄";
      }
    });
    renderStrategicRegions();
    renderArmyLayer();
    renderWarLayer();
    renderMapMode();
    renderProvinceCard();
  }

  function svgNode(name, attributes = {}) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  function regionOwnerName(region) {
    return ownerName(regionController(region));
  }

  function regionController(region) {
    return region?.controllerId || region?.ownerId || region?.owner || "neutral";
  }

  function routeBetween(a, b) {
    return regionNeighbors(a).find((neighbor) => neighbor.id === b) || null;
  }

  function battleApproach(army, targetId) {
    // Arrival has already moved army.region to the target. Use the actual
    // last route edge, retaining it for subsequent combat rounds and saves.
    const route = army.order?.route || [];
    const index = route.lastIndexOf(targetId);
    const from = index > 0 ? route[index - 1] : army.battleApproachRegionId;
    return from && from !== targetId ? routeBetween(from, targetId) : null;
  }

  function regionNeighbors(regionOrId) {
    const id = typeof regionOrId === "string" ? regionOrId : regionOrId?.id;
    const region = typeof regionOrId === "object" ? regionOrId : state.regions[id];
    const fallback = REGIONS[id]?.neighbors || [];
    const neighbors = Array.isArray(region?.neighbors) && region.neighbors.length ? region.neighbors : fallback;
    const resolved = neighbors.map((neighbor) => typeof neighbor === "string" ? { id: neighbor, kind: "road" } : neighbor)
      .filter((neighbor) => neighbor?.id && state.regions[neighbor.id]);
    // Recover reverse edges for older local saves with incomplete one-way
    // adjacency.  The canonical state graph remains the source of truth.
    if (resolved.length || !id) return resolved;
    const reverse = Object.values(state.regions)
      .filter((candidate) => candidate.id !== id && candidate.neighbors?.some((neighbor) => neighbor.id === id))
      .map((candidate) => ({ id: candidate.id, kind: "road" }));
    if (reverse.length) return reverse;
    return (window.STRATEGY_MAP_DATA?.routes || [])
      .filter(([a, b]) => a === id || b === id)
      .map(([a, b, kind]) => ({ id: a === id ? b : a, kind: kind || "road" }))
      .filter((neighbor) => state.regions[neighbor.id]);
  }

  function regionPosition(id) {
    if (regionPointCache.has(id)) return regionPointCache.get(id);
    const region = REGIONS[id] || REGIONS.changan;
    const point = window.TianxiaMap?.position(region) || [600, 380];
    regionPointCache.set(id, point);
    return point;
  }

  function provincePosition(id) {
    if (provincePointCache.has(id)) return provincePointCache.get(id);
    const point = window.TianxiaMap?.provincePosition(id) || [600, 380];
    provincePointCache.set(id, point);
    return point;
  }

  function fixedSymbolTransform(x, y, offsetX = 0, offsetY = 0) {
    const transform = window.TianxiaMap?.transform;
    return window.TianxiaMap?.screenSpaceTransform(x, y, transform, offsetX, offsetY)
      || `translate(${x + offsetX} ${y + offsetY})`;
  }

  function screenSpaceNode(name, attributes, x, y, offsetX = 0, offsetY = 0) {
    const node = svgNode(name, { ...attributes, transform: fixedSymbolTransform(x, y, offsetX, offsetY) });
    window.TianxiaMap?.registerScreenSpace(node, x, y, offsetX, offsetY);
    return node;
  }

  function regionTerrainModifier(region, routeKind = "road") {
    const routePenalty = { road: 1, water: .88, river: 1.24, mountain: 1.38, pass: 1.52 }[routeKind] || 1;
    const terrainPenalty = /山|高原|关隘|峡谷/.test(region.terrain) ? 1.2 : /河网|丘陵/.test(region.terrain) ? 1.08 : .96;
    return routePenalty * terrainPenalty;
  }

  function renderStrategicRegions() {
    const routeLayer = $("routeLayer");
    const regionLayer = $("regionLayer");
    const map = window.TianxiaMap;
    const transform = map?.transform;
    const zoomLevel = transform?.k || 1;
    const highZoom = zoomLevel >= 10;
    const cullKey = highZoom && transform ? `${Math.round(transform.x / 64)}:${Math.round(transform.y / 64)}` : "";
    if (!strategicRoutesBuilt) {
      ROUTES.forEach(([a, b, kind]) => {
        const start = regionPosition(a);
        const end = regionPosition(b);
        routeLayer.appendChild(svgNode("path", {
          class: `strategic-route ${kind}`,
          d: `M${start[0]} ${start[1]}L${end[0]} ${end[1]}`,
          "data-route-from": a,
          "data-route-to": b,
        }));
      });
      Object.values(state.regions).forEach((region) => {
        const [x, y] = regionPosition(region.id);
        const id = region.id;
        const city = window.TANG_MAP_MODEL?.cityNodes?.find((city) => city.regionId === id);
        const importance = id === "changan" || id === "luoyang" ? "capital" : city ? "major" : "local";
        const group = screenSpaceNode("g", {
          class: `strategic-region map-label-candidate ${region.type}`,
          "data-city-importance": importance,
          tabindex: "0", role: "button", "data-region-id": id, "data-map-object": region.type,
        }, x, y);
        const icon = region.type === "gate" ? "关" : region.type === "port" ? "港" : region.type === "farm" ? "田" : region.type === "capital" ? "都" : "城";
        const shape = region.type === "gate"
          ? svgNode("path", { class: "region-shape", d: "M-8 6V-5L0-10L8-5V6M-11 6H11" })
          : svgNode("circle", { class: "region-shape", cx: 0, cy: 0, r: region.type === "capital" ? 8 : 6 });
        const glyph = svgNode("text", { class: "region-glyph", x: 0, y: 3 });
        glyph.textContent = icon;
        // Resolve the icon and its text together. Hiding text alone left
        // overlapping city/pass/port hit targets around the two capitals.
        const label = svgNode("text", { class: "region-label", x: region.type === "port" ? 9 : 10, y: 4 });
        label.textContent = regionDisplayName(region, state.calendar.year);
        group.append(svgNode("circle", { class: "region-influence", cx: 0, cy: 0, r: region.type === "capital" ? 22 : 17 }), shape, glyph, label);
        const select = (event) => { event?.stopPropagation(); selectStrategicRegion(id, region.type); };
        group.addEventListener("click", select);
        group.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") select(event); });
        group.addEventListener("dblclick", (event) => {
          event.stopPropagation();
          selectStrategicRegion(id, region.type);
          window.TianxiaMap?.doubleClickRegion?.(id);
        });
        group.addEventListener("pointermove", (event) => showRegionTooltip(event, id));
        group.addEventListener("pointerleave", hideMapTooltip);
        regionLayer.appendChild(group);
        strategicRegionNodes.set(id, group);
      });
      strategicRoutesBuilt = true;
      renderDiagnostics.strategicLayerBuilds += 1;
    }
    const armies = commandArmies();
    Object.values(state.regions).forEach((region) => {
      const group = strategicRegionNodes.get(region.id);
      if (!group) return;
      const selected = selectedRegionId === region.id;
      const point = regionPosition(region.id);
      const visible = !highZoom || !map?.isPointVisible || map.isPointVisible(point, 120);
      const reachable = armies.some((army) => findRoute(army.region, region.id));
      const controller = regionController(region);
      const moveTarget = reachable && controller === "player";
      const attackTarget = reachable && controller !== "player";
      const armyOrigin = armies.some((army) => army.region === region.id);
      const orderTarget = pendingOrderTargetId === region.id;
      const supplied = controller === "player" ? 88 : regionNeighbors(region).some(({ id }) => regionController(state.regions[id]) === "player") ? 48 : 24;
      const renderKey = [state.calendar.year, selected, visible, cullKey, Boolean(reachable), Boolean(moveTarget), Boolean(attackTarget), Boolean(armyOrigin), orderTarget, Boolean(region.contested), controller, region.population, region.grain, region.garrison, region.defense, region.fort, supplied].join("|");
      if (group.dataset.renderKey === renderKey) return;
      group.dataset.renderKey = renderKey;
      group.toggleAttribute("hidden", !visible);
      group.setAttribute("class", `strategic-region screen-space-node map-object-marker map-label-candidate ${region.type} ${selected ? "selected" : ""} ${moveTarget ? "move-target" : ""} ${attackTarget ? "attack-target" : ""} ${armyOrigin ? "army-origin" : ""} ${orderTarget ? "order-target" : ""} ${region.contested ? "contested" : ""}`);
      const displayName = regionDisplayName(region, state.calendar.year);
      const label = group.querySelector(".region-label");
      if (label && label.textContent !== displayName) label.textContent = displayName;
      group.setAttribute("aria-label", `${displayName}，${PROVINCES[region.province].name}，${REGION_DATA.typeNames[region.type]}，${regionTerrainSummary(region)}`);
      group.style.setProperty("--region-color", factionColor(controller));
      group.style.setProperty("--region-population", `${clamp(region.population, 20, 100)}%`);
      group.style.setProperty("--region-grain", `${clamp(region.grain, 20, 110)}%`);
      group.style.setProperty("--supply", `${supplied}%`);
      renderDiagnostics.strategicNodePatches += 1;
    });
    routeLayer.querySelectorAll("[data-route-from][data-route-to]").forEach((route) => {
      if (!highZoom) {
        route.removeAttribute("hidden");
        return;
      }
      const from = regionPosition(route.dataset.routeFrom);
      const to = regionPosition(route.dataset.routeTo);
      const routeVisible = (!map?.isPointVisible || map.isPointVisible(from, 160))
        || (!map?.isPointVisible || map.isPointVisible(to, 160));
      route.toggleAttribute("hidden", !routeVisible);
    });
    window.TianxiaMap?.refreshLabelCollisions();
  }

  function regionTerrainSummary(region) {
    const type = REGION_DATA.typeNames[region.type];
    return `${type} · ${region.terrain} · 人口规模${region.population}点 · 粮产${region.grain} · 防御${region.defense}`;
  }

  function selectStrategicRegion(id, objectType = "region") {
    const region = state.regions[id];
    if (!region) return;
    setRightPanelCollapsed(false, { persist: false });
    setRightSidebarTab("region");
    selectedRegionId = id;
    selectedProvince = region.province;
    selectedMapObjectType = objectType;
    const commandArmy = commandArmies()[0] || null;
    const route = commandArmy ? findRoute(commandArmy.region, id) : null;
    if (commandArmy && route && id !== commandArmy.region) {
      // A map click is always a preview.  Even an adjacent enemy region must
      // first show the contextual target card; only its explicit “进军”
      // action creates the order (and later combat).
      prepareRegionOrder(id);
    } else if (commandArmy) prepareRegionOrder(id);
    else clearPendingRegionOrder(false);
    renderMap();
    sound("tap");
  }

  function clearPendingRegionOrder(shouldRender = true) {
    pendingOrderTargetId = null;
    pendingAttackPlan = null;
    $("battlePlanTarget")?.classList.add("hidden");
    $("retreatRegionOrder")?.classList.add("hidden");
    $("battlePlanCoordination")?.classList.add("hidden");
    renderBattlePlanPanel();
    if (shouldRender) renderMap();
  }

  function prepareRegionOrder(targetId) {
    const target = state.regions[targetId];
    const armies = commandArmies();
    if (!armies.length || !target) {
      clearPendingRegionOrder(false);
      return false;
    }
    // A target click is the moment the作战计划 becomes useful; expand it
    // contextually without changing the user's saved default preference.
    setRightPanelCollapsed(false, { persist: false });
    setRightSidebarTab("operation");
    const routesByArmyId = routesForArmies(armies, targetId, { type: regionController(target) === "player" ? "MOVE" : "ATTACK" });
    const eligible = armies.filter((army) => routesByArmyId[army.id]);
    if (!eligible.length) {
      clearPendingRegionOrder(false);
      return false;
    }
    pendingOrderTargetId = targetId;
    pendingAttackPlan = {
      armyIds: eligible.map((army) => army.id),
      targetRegionId: targetId,
      routesByArmyId,
      orderType: regionController(target) === "player" ? "MOVE" : "ATTACK",
      coordinationMode: eligible.length > 1 ? "WAIT_FOR_ALL" : "ATTACK_ON_ARRIVAL",
    };
    $("contextTargetName").textContent = `${regionDisplayName(target, state.calendar.year)} · ${regionOwnerName(target)}`;
    const commandPower = commandArmyPower(eligible);
    const targetDefense = enemyDefense(state.provinces[target.province], target);
    const eta = Math.max(...eligible.map((army) => makeArmyOrder(army, targetId, { route: routesByArmyId[army.id] })?.etaDays || 0));
    const attackingEdges = new Set(eligible.map((army) => routesByArmyId[army.id]?.[Math.max(0, routesByArmyId[army.id].length - 2)]).filter(Boolean));
    const averageSupply = Math.round(eligible.reduce((sum, army) => sum + army.supply, 0) / Math.max(1, eligible.length));
    const directionHint = attackingEdges.size > 1 ? `${attackingEdges.size}面夹击潜势` : "单面推进";
    $("contextTargetStats").textContent = `${eligible.length}军 · 我军战力 ${fmt(commandPower)} · 守军 ${fmt(target.garrison)} · 城防 ${fmt(target.defense + target.fort * 8)} · ${target.terrain} · 补给均值 ${averageSupply}% · ${directionHint} · ETA约${eta}日 · 建议${commandPower >= targetDefense ? "正面进军" : "先断粮"}`;
    $("confirmRegionOrder").textContent = eligible.length > 1
      ? regionController(target) === "player" ? "协同移防" : "协同进军"
      : regionController(target) === "player" ? "移防" : "进军";
    $("retreatRegionOrder")?.classList.toggle("hidden", regionController(target) !== "player");
    $("battlePlanCoordination")?.classList.toggle("hidden", eligible.length < 2 || regionController(target) === "player");
    $("coordWaitAll")?.classList.toggle("active", pendingAttackPlan.coordinationMode === "WAIT_FOR_ALL");
    $("coordAttackArrival")?.classList.toggle("active", pendingAttackPlan.coordinationMode === "ATTACK_ON_ARRIVAL");
    $("battlePlanTarget")?.classList.remove("hidden");
    renderBattlePlanPanel();
    return true;
  }

  function renderArmyLayer() {
    const armies = activeArmies();
    const map = window.TianxiaMap;
    const zoomLevel = map?.transform?.k || 1;
    const zoomTier = map?.zoomTier || (zoomLevel < 2 ? "world" : zoomLevel < 3.5 ? "nation" : zoomLevel < 6 ? "region" : zoomLevel < 10 ? "district" : zoomLevel < 16 ? "tactical" : zoomLevel < 28 ? "urban" : "ultra");
    const cullKey = zoomLevel >= 10 && map?.transform ? `${Math.round(map.transform.x / 64)}:${Math.round(map.transform.y / 64)}` : "";
    const playerKey = armies.map((army) => [army.id, armyPositionKey(army), army.province, army.infantry, army.archers, army.cavalry, army.destinationRegion, hasSelectedArmy(army.id)].join(":"));
    const enemyKey = state.mapMode === "military"
      ? Object.entries(state.provinces).map(([id, province]) => `${id}:${province.owner}:${province.fieldTroops}`).join("|")
      : "";
    const renderKey = `${state.mapMode}|${zoomTier}|${cullKey}|${playerKey.join("|")}|${enemyKey}`;
    if (renderKey === lastArmyLayerKey) return;
    lastArmyLayerKey = renderKey;
    const layer = $("armyLayer");
    layer.replaceChildren();
    // Keep army markers in the same screen-space path as before:
    // screenSpaceNode("g", { class: `army-marker ...` }).  The renderer below
    // only changes how many source armies share one marker at distant LOD.
    const renderMarker = ({ army, armyRegion, factionId, strength, count = 1, aggregate = false, offsetX = 0, offsetY = -34 }) => {
      const [baseX, baseY] = army ? armyMapPosition(army) : regionPosition(armyRegion);
      if (zoomLevel >= 10 && map?.isPointVisible && !map.isPointVisible([baseX, baseY], 120)) return;
      const marker = screenSpaceNode("g", {
        class: `army-marker map-object-army map-label-obstacle ${army && hasSelectedArmy(army.id) ? "selected" : ""}${aggregate ? " army-cluster" : ""}`,
        "data-army-id": army?.id || "",
        "data-army-count": count,
        "data-map-object": "army",
        tabindex: "0",
        role: "button",
        "aria-label": aggregate ? `${factionId} ${count}军，兵力${strength}` : `${armyDisplayName(army)}，主将${army.commander}，兵力${strength}`,
      }, baseX, baseY, offsetX, offsetY);
      marker.style.setProperty("--army-color", factionColor(factionId));
      marker.appendChild(svgNode("path", { class: "flag-pole", d: "M-11-14V11" }));
      marker.appendChild(svgNode("path", { class: "flag-body", d: "M-10-12H11V2L0 8L-10 2Z" }));
      const name = svgNode("text", { x: "0", y: "-1" });
      name.textContent = aggregate ? `${factionId === "player" ? (state.kingdom || "唐").slice(0, 2) : (FACTIONS[factionId]?.short || factionId)} · ${count}军` : `${(state.kingdom || "我").slice(0, 1)}${armyDisplayName(army).includes("第一") ? "一" : armyDisplayName(army).includes("第二") ? "二" : "军"}`;
      const size = svgNode("text", { class: "army-size", x: "1", y: "21" });
      size.textContent = `● ${fmt(strength)}`;
      marker.append(name, size);
      const commandArmyId = army?.id || null;
      if (commandArmyId) marker.addEventListener("click", (event) => { event.stopPropagation(); selectArmy(commandArmyId, Boolean(event.shiftKey)); });
      if (commandArmyId) marker.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") selectArmy(commandArmyId, Boolean(event.shiftKey)); });
      layer.appendChild(marker);
    };

    // At the world tier a flag per army makes the map unreadable and causes
    // needless DOM work.  Aggregate by controller into one screen-space
    // marker; at nation tier aggregate armies occupying the same region.  The
    // actual army objects remain untouched and expand again at region/tactical
    // zoom, so commands continue to use selectedArmyIds.
    if (zoomTier === "world") {
      const byFaction = new Map();
      armies.forEach((army) => {
        const armyRegion = army.region || PROVINCE_CAPITAL_REGION[army.province];
        const factionId = regionController(state.regions[armyRegion]) || "player";
        const entry = byFaction.get(factionId) || { factionId, armies: [], strength: 0, x: 0, y: 0 };
        const [x, y] = regionPosition(armyRegion);
        entry.armies.push(army); entry.strength += armySize(army); entry.x += x; entry.y += y;
        byFaction.set(factionId, entry);
      });
      byFaction.forEach((entry) => {
      const army = entry.armies.find((item) => hasSelectedArmy(item.id)) || entry.armies[0];
        const anchorRegion = army.region || PROVINCE_CAPITAL_REGION[army.province];
        renderMarker({ army, armyRegion: anchorRegion, factionId: entry.factionId, strength: entry.strength, count: entry.armies.length, aggregate: true });
      });
    } else if (zoomTier === "nation") {
      const byRegion = new Map();
      armies.forEach((army) => {
        const armyRegion = army.region || PROVINCE_CAPITAL_REGION[army.province];
        const factionId = regionController(state.regions[armyRegion]) || "player";
        const key = `${factionId}:${armyPositionKey(army)}`;
        const entry = byRegion.get(key) || { factionId, armyRegion, armies: [], strength: 0 };
        entry.armies.push(army); entry.strength += armySize(army); byRegion.set(key, entry);
      });
      byRegion.forEach((entry) => {
      const army = entry.armies.find((item) => hasSelectedArmy(item.id)) || entry.armies[0];
        renderMarker({ army, armyRegion: entry.armyRegion, factionId: entry.factionId, strength: entry.strength, count: entry.armies.length, aggregate: entry.armies.length > 1 });
      });
    } else {
      const grouped = new Map();
      armies.forEach((army) => {
        const armyRegion = army.region || PROVINCE_CAPITAL_REGION[army.province];
        // Nearby armies departing the same region still need separate
        // screen-space slots. Exact floating-point progress is not a useful
        // collision group: two flags 1% apart would otherwise overlap.
        const key = armyRegion;
        const group = grouped.get(key) || [];
        group.push(army); grouped.set(key, group);
      });
      grouped.forEach((group) => group.forEach((army, index) => {
        const armyRegion = army.region || PROVINCE_CAPITAL_REGION[army.province];
        const columns = Math.min(4, group.length);
        const offsetX = (index % columns - (columns - 1) / 2) * 44;
        const offsetY = -34 - Math.floor(index / columns) * 48;
        const factionId = regionController(state.regions[armyRegion]) || "player";
        renderMarker({ army, armyRegion, factionId, strength: armySize(army), offsetX, offsetY });
      }));
    }
    if (state.mapMode === "military" && zoomTier !== "world") {
      Object.entries(state.provinces).forEach(([id, province]) => {
        if (province.owner === "player" || province.fieldTroops < 100) return;
        const [x, y] = provincePosition(id);
        if (zoomLevel >= 10 && map?.isPointVisible && !map.isPointVisible([x, y], 120)) return;
        const marker = screenSpaceNode("g", { class: "army-marker enemy map-label-obstacle", "aria-label": `${ownerName(province.owner)}城外守军，兵力${province.fieldTroops}` }, x, y, 27, 23);
        marker.style.setProperty("--army-color", factionColor(province.owner));
        marker.appendChild(svgNode("path", { class: "flag-pole", d: "M-11-14V11" }));
        marker.appendChild(svgNode("path", { class: "flag-body", d: "M-10-12H11V2L0 8L-10 2Z" }));
        const name = svgNode("text", { x: "0", y: "-1" });
        name.textContent = FACTIONS[province.owner]?.short || "敌";
        const size = svgNode("text", { class: "army-size", x: "1", y: "21" });
        size.textContent = `● ${fmt(province.fieldTroops)}`;
        marker.append(name, size);
        layer.appendChild(marker);
      });
    }
    window.TianxiaMap?.refreshLabelCollisions();
    renderDiagnostics.armyLayerBuilds += 1;
  }

  const ROUTE_VISUALS = Object.freeze({
    ATTACK: { className: "movement-attack", marker: "url(#movement-arrow-attack)", label: "进攻" },
    MOVE: { className: "movement-move", marker: "url(#movement-arrow-move)", label: "移防" },
    RETREAT: { className: "movement-retreat", marker: "url(#movement-arrow-retreat)", label: "撤退" },
  });

  function routePath(points) {
    return points.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join(" ");
  }

  function routeAnchor(points) {
    if (!points.length) return [600, 380];
    if (points.length === 1) return points[0];
    const middle = Math.floor((points.length - 1) / 2);
    const [ax, ay] = points[middle];
    const [bx, by] = points[middle + 1] || points[middle];
    return [(ax + bx) / 2, (ay + by) / 2];
  }

  function remainingRoutePoints(army, route, preview = false) {
    const position = armyMapPosition(army);
    if (preview) {
      const leg = armyTravelLeg(army);
      const continuing = leg?.fromRegionId === route[0] && leg?.toRegionId === route[1];
      return [position, ...route.slice(continuing || !leg?.progress ? 1 : 0).map(regionPosition)];
    }
    if (army.order?.returnLeg) return [position, ...route.map(regionPosition)];
    return [position, ...route.slice((army.order?.routeIndex || 0) + 1).map(regionPosition)];
  }

  function routeVisible(points, map, padding = 160) {
    if (!map?.isPointVisible || map.transform?.k < 7) return true;
    // Include crossing segments, not just endpoints (both endpoints can be
    // offscreen while a long march crosses the current viewport).
    const transform = map.transform;
    const box = $("worldMap").viewBox.baseVal;
    const left = (-transform.x - padding) / transform.k;
    const top = (-transform.y - padding) / transform.k;
    const right = (box.width - transform.x + padding) / transform.k;
    const bottom = (box.height - transform.y + padding) / transform.k;
    return points.some(([x, y], index) => {
      const [px, py] = points[Math.max(0, index - 1)];
      return Math.max(x, px) >= left && Math.min(x, px) <= right
        && Math.max(y, py) >= top && Math.min(y, py) <= bottom;
    });
  }

  function routeEtaLabel(army, visual, routeCount, preview) {
    if (preview) return `${routeCount > 1 ? `${routeCount}军 · ` : ""}${visual.label}预览`;
    if (routeCount > 1) return `${routeCount}军 · ${visual.label}`;
    const eta = army.order ? estimateArmyArrival(army, army.order) : 0;
    return `${armyDisplayName(army)} · ${eta}日`;
  }

  function armyEtaDays(army) {
    return army?.order ? estimateArmyArrival(army, army.order) : 0;
  }

  function drawRouteVisual(army, { route, preview = false, routeCount = 1, variantIndex = 0 } = {}) {
    const pathLayer = $("movementPathLayer");
    const markerLayer = $("movementMarkerLayer");
    if (!pathLayer || !markerLayer || !route?.length) return false;
    const points = remainingRoutePoints(army, route, preview);
    if (points.length < 2) return false;
    const [x1, y1] = points[0];
    const [x2, y2] = points[points.length - 1];
    const map = window.TianxiaMap;
    if (!routeVisible(points, map)) return false;
    const orderType = preview ? (pendingAttackPlan?.orderType || "ATTACK") : (army.order?.type || "MOVE");
    const visual = ROUTE_VISUALS[orderType] || ROUTE_VISUALS.MOVE;
    const selected = !preview && hasSelectedArmy(army.id);
    const classes = ["movement-line", visual.className, `movement-variant-${variantIndex % 3}`];
    if (preview) classes.push("movement-preview");
    if (selected) classes.push("movement-selected");
    const path = svgNode("path", {
      class: classes.join(" "),
      d: routePath(points),
      "data-army-id": army.id,
      "data-order-type": orderType,
      "data-route-count": routeCount,
      "data-route": route.join(">"),
      "marker-mid": visual.marker,
      "marker-end": visual.marker,
    });
    pathLayer.append(path);

    const shouldLabel = preview || selected || routeCount > 1;
    if (shouldLabel) {
      const [labelX, labelY] = routeAnchor(points);
      const label = screenSpaceNode("g", {
        class: `movement-route-label map-label-candidate ${visual.className}${selected ? " selected" : ""}`,
        "data-army-id": army.id,
        "data-order-type": orderType,
      }, labelX, labelY, 0, -10);
      const text = svgNode("text", { x: 0, y: 0 });
      text.textContent = routeEtaLabel(army, visual, routeCount, preview);
      label.appendChild(text);
      markerLayer.append(label);
    }

    if (!preview) {
      const [px, py] = armyMapPosition(army);
      const dot = screenSpaceNode("g", { class: `movement-marker ${visual.className}`, "data-army-id": army.id }, px, py);
      dot.appendChild(svgNode("circle", { class: "movement-progress", cx: 0, cy: 0, r: "7" }));
      markerLayer.append(dot);

      if (orderType === "ATTACK" && (selected || routeCount > 1)) {
        const target = screenSpaceNode("g", { class: `movement-target-badge ${visual.className}`, "data-army-id": army.id }, x2, y2, 9, -9);
        target.appendChild(svgNode("circle", { class: "movement-target-dot", cx: 0, cy: 0, r: "5" }));
        const status = svgNode("text", { x: 8, y: 4 });
        status.textContent = army.battleState === "arrived" ? "接敌" : "进攻";
        target.appendChild(status);
        markerLayer.append(target);
      }
    }
    return true;
  }

  function drawMovement(army, options = {}) {
    const order = army.order;
    const route = options.route || (order?.route?.length ? order.route : [army.region, army.destinationRegion].filter(Boolean));
    return drawRouteVisual(army, { ...options, route });
  }

  function renderWarLayer() {
    const armies = activeArmies();
    const map = window.TianxiaMap;
    const mapTransform = map?.transform;
    const cullKey = mapTransform?.k >= 7 ? `${Math.round(mapTransform.x / 64)}:${Math.round(mapTransform.y / 64)}` : "";
    const renderKey = [
      cullKey,
      map?.zoomTier, selectedArmyIds.join(","),
      armies.map((army) => [army.id, armyPositionKey(army), army.province, army.destinationRegion, army.order?.routeIndex, army.infantry, army.archers, army.cavalry].join(":")),
      Object.entries(state.provinces).map(([id, province]) => `${id}:${province.owner}:${province.fieldTroops}:${Math.round(province.siege?.progress || 0)}`),
      Object.entries(state.enemyCampaigns).map(([id, campaign]) => `${id}:${Math.round(campaign.progress)}:${campaign.power}`),
      pendingAttackPlan ? `${pendingAttackPlan.targetRegionId}:${pendingAttackPlan.orderType}:${pendingAttackPlan.coordinationMode}:${Object.keys(pendingAttackPlan.routesByArmyId || {}).join(",")}` : "",
    ].flat().join("|");
    if (renderKey === lastWarLayerKey) return;
    lastWarLayerKey = renderKey;
    const movementPaths = $("movementPathLayer");
    const movementMarkers = $("movementMarkerLayer");
    movementPaths.replaceChildren();
    movementMarkers.replaceChildren();
    const routeGroups = new Map();
    // While a new plan is being previewed, its participating armies are
    // rendered by the preview layer below.  Do not draw their old orders a
    // second time on top of the preview (especially when the player is
    // revising an order to the same target).
    const previewArmyIds = new Set(Object.keys(pendingAttackPlan?.routesByArmyId || {}));
    armies.filter((army) => army.destinationRegion && army.order?.route?.length && !previewArmyIds.has(army.id)).forEach((army) => {
      const type = army.order?.type || "MOVE";
      const key = `${type}|${army.order.route.join(">")}|${armyPositionKey(army)}`;
      const group = routeGroups.get(key) || [];
      group.push(army);
      routeGroups.set(key, group);
    });
    let routeVariant = 0;
    routeGroups.forEach((group) => {
      const primary = group.find((army) => hasSelectedArmy(army.id)) || group[0];
      drawMovement(primary, { route: primary.order.route, routeCount: group.length, variantIndex: routeVariant });
      routeVariant += 1;
    });
    if (pendingAttackPlan?.routesByArmyId) {
      const previewGroups = new Map();
      Object.entries(pendingAttackPlan.routesByArmyId).forEach(([armyId, route]) => {
        if (!route?.length) return;
        const key = route.join(">");
        const group = previewGroups.get(key) || [];
        group.push({ armyId, route });
        previewGroups.set(key, group);
      });
      previewGroups.forEach((group, key) => {
      const primary = group.find(({ armyId }) => hasSelectedArmy(armyId)) || group[0];
        const army = state.armies[primary.armyId];
        if (army) drawMovement(army, { route: primary.route, preview: true, routeCount: group.length, variantIndex: routeVariant++ });
      });
    }
    const layer = $("frontLineLayer");
    layer.replaceChildren();
    const mapScale = mapTransform?.k || 1;
    const showSiegeProgress = mapScale >= 10;
    Object.entries(state.provinces).forEach(([id, province]) => {
      const enemyCampaign = state.enemyCampaigns[id];
      const frontlineArmy = armies.find((army) => army.province === id && province.owner !== "player" && province.fieldTroops > 0);
      if (!province.siege && !enemyCampaign && !frontlineArmy) return;
      if (!showSiegeProgress && !frontlineArmy && state.regions[selectedRegionId]?.province !== id) return;
      const [x, y] = provincePosition(id);
      if (mapScale >= 10 && map?.isPointVisible && !map.isPointVisible([x, y], 160)) return;
      const battle = screenSpaceNode("g", { class: "battle-marker" }, x, y);
      const ring = svgNode("circle", { class: "front-line", cx: 0, cy: 0, r: mapScale < 4 ? "8" : "28" });
      battle.append(ring);
      // At distant LOD keep only a small battle mark. Hiding text alone left
      // an unexplained black rectangle floating over the country label.
      if (showSiegeProgress) {
        const label = svgNode("g", { class: "battle-label map-label-candidate" });
        const badge = svgNode("rect", { class: "battle-badge", x: -30, y: 34, width: "60", height: "22", rx: "3" });
        const text = svgNode("text", { class: "battle-text", x: 0, y: 49 });
        text.textContent = frontlineArmy ? "交战" : `攻城 ${Math.round((enemyCampaign || province.siege).progress || 0)}%`;
        label.append(badge, text); battle.append(label);
      }
      layer.append(battle);
    });
    window.TianxiaMap?.refreshLabelCollisions();
    renderDiagnostics.warLayerBuilds += 1;
  }

  function renderMapMode() {
    if ($("mapModeDescription").dataset.mode === state.mapMode) return;
    $("mapModeDescription").dataset.mode = state.mapMode;
    document.querySelectorAll("[data-map-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mapMode === state.mapMode));
    $("mapModeDescription").textContent = MAP_MODES[state.mapMode] || MAP_MODES.faction;
  }

  function renderProvinceCard() {
    const selectedArmyObject = selectedMapObjectType === "army" ? primarySelectedArmy() : null;
    const region = selectedArmyObject
      ? state.regions[selectedArmyObject.region]
      : state.regions[selectedRegionId] || state.regions[PROVINCE_CAPITAL_REGION[selectedProvince]];
    const detailProvinceId = region.province;
    const province = state.provinces[detailProvinceId];
    const controller = regionController(region);
    const isPlayer = controller === "player";
    const attackable = getFrontier().includes(detailProvinceId);
    const enemyCampaign = state.enemyCampaigns[detailProvinceId];
    const localArmies = activeArmies().filter((army) => army.region === region.id);
    const selectedObjectLabel = selectedMapObjectType === "army"
      ? "军团"
      : selectedMapObjectType === "region"
        ? "战略地区"
        : REGION_DATA.typeNames[selectedMapObjectType] || REGION_DATA.typeNames[region.type];
    const renderKey = [state.calendar.year, detailProvinceId, selectedRegionId, selectedArmyIds.join(","), selectedMapObjectType, pendingOrderTargetId, controller, region.contested, region.population, region.grain, region.garrison, region.defense, region.fort, province.siege?.progress, enemyCampaign?.progress, enemyCampaign?.power, attackable, localArmies.map((army) => army.id).join(","), activeArmies().some((army) => !army.destinationRegion)].join("|");
    if (renderKey === lastProvinceCardKey) return;
    lastProvinceCardKey = renderKey;
    $("provinceSigil").textContent = region.type === "gate" ? "关" : region.type === "port" ? "港" : region.type === "farm" ? "田" : province.sigil;
    $("selectionKind").textContent = `当前选中 · ${selectedObjectLabel}`;
    const daoName = PROVINCES[detailProvinceId]?.name || province.name;
    $("selectionBreadcrumb").textContent = selectedArmyObject
     ? `${playerForceLabel()} > ${armyDisplayName(selectedArmyObject)} > ${regionDisplayName(state.regions[selectedArmyObject.region], state.calendar.year) || province.name}`
      : `道 · ${daoName} > 州府 · ${region.admin} > 地区 · ${regionDisplayName(region, state.calendar.year)}`;
    $("provinceName").textContent = selectedArmyObject ? armyDisplayName(selectedArmyObject) : regionDisplayName(region, state.calendar.year);
    const primaryArmy = primarySelectedArmy();
    $("provinceStatus").textContent = region.contested ? "前线交战" : enemyCampaign ? "敌军围城" : province.siege ? `${playerForceLabel()}围城` : isPlayer ? "我方控制" : primaryArmy && routeBetween(primaryArmy.region, region.id) ? "可下军令" : "敌方控制";
    $("provinceStatus").style.color = enemyCampaign ? "#dc6c58" : isPlayer ? "#92b29e" : attackable ? "#d7b675" : "#927f6d";
    $("provinceLore").textContent = `${regionDisplayName(region, state.calendar.year)}位于${region.terrain}，${REGION_DATA.typeNames[region.type]}直接影响${region.type === "gate" ? "通道控制与防御" : region.type === "port" ? "水路运输与补给" : "当地征税、征粮与行军"}。`;
    $("provinceProsperity").textContent = fmt(region.population);
    $("provinceDefense").textContent = fmt(region.defense + region.fort * 8);
    $("provinceTroops").textContent = fmt(region.garrison);
    $("provinceTerrain").textContent = region.terrain;
    $("provinceOwner").textContent = regionOwnerName(region);
    $("provinceCity").textContent = `${REGION_DATA.typeNames[region.type]} · 防御 ${fmt(region.defense)}`;
    $("provinceFarm").textContent = `粮产 ${fmt(region.grain)} · 人口规模 ${fmt(region.population)}点`;
    $("provinceCamp").textContent = `${isPlayer ? "驻军" : "守军"} ${fmt(region.garrison)} · 堡垒 ${region.fort}级`;
    $("provinceEconomy").textContent = `繁荣 ${fmt(Math.round((region.population + region.grain + province.prosperity) / 3))}`;
    $("provinceController").textContent = isPlayer ? `${displayKingdomName()} · ${state.ruler}` : regionOwnerName(region);
    $("provinceArmies").textContent = localArmies.length ? localArmies.map((army) => `${armyDisplayName(army)} ${fmt(armySize(army))}`).join("、") : "无驻扎军团";
    $("provinceWar").textContent = region.contested ? "地区交战中" : enemyCampaign ? `敌军围攻 ${Math.round(enemyCampaign.progress || 0)}%` : province.siege ? `${playerForceLabel()}围攻 ${Math.round(province.siege.progress || 0)}%` : "无战事";
    $("provinceAssets").classList.toggle("enemy", !isPlayer);
    const commandRoute = selectedArmies().some((army) => findRoute(army.region, region.id));
    $("attackButton").classList.toggle("hidden", selectedArmyIds.length ? !commandRoute : isPlayer && !enemyCampaign);
    $("attackButton").disabled = selectedArmyIds.length ? !commandRoute : !activeArmies().some((army) => !army.order);
    $("attackButton").textContent = selectedArmyIds.length > 1 ? `协同${isPlayer ? "移防" : "进军"} ${regionDisplayName(region, state.calendar.year)}` : selectedArmyIds.length === 1 ? `${isPlayer ? "准备移防" : "准备进军"} ${regionDisplayName(region, state.calendar.year)}` : enemyCampaign ? "选择军团驰援" : "选择军团进攻";
    const campaign = enemyCampaign || province.siege;
    $("campaignStrip").classList.toggle("hidden", !campaign);
    if (campaign) {
      $("campaignStage").textContent = enemyCampaign ? `敌军围攻 · 第 ${campaign.rounds} 轮` : province.fieldTroops > 0 ? "野战争夺" : "围攻州治";
      $("campaignFill").style.width = `${clamp(campaign.progress || 0, 0, 100)}%`;
      $("campaignProgress").textContent = `${Math.round(campaign.progress || 0)}%`;
    }
    const adjacencyList = $("adjacencyList");
    adjacencyList.replaceChildren();
    regionNeighbors(region).forEach(({ id, kind }) => {
      const neighbor = state.regions[id];
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${regionDisplayName(neighbor, state.calendar.year)} · ${REGION_DATA.routeNames[kind] || "驿道"}`;
      button.addEventListener("click", () => {
        selectStrategicRegion(id, "region");
        window.TianxiaMap?.focusRegion(id);
      });
      adjacencyList.appendChild(button);
    });
    if (!adjacencyList.childElementCount) adjacencyList.textContent = "暂无可通行地区";
  }

  function renderCourt() {
    const container = $("courtActions");
    container.replaceChildren();
    COURT_ACTIONS.forEach((action) => {
      const cost = action.cost(state);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "court-action";
      button.disabled = state.actionPoints < 1 || !hasResources(cost);
      button.innerHTML = safeHtml`<span class="court-icon">${action.icon}</span><span><b>${action.name}</b><small>${action.description}</small><em>${costText(cost)} · 1 行动力</em></span><strong>${action.effect}</strong>`;
      button.addEventListener("click", () => performCourtAction(action));
      container.appendChild(button);
    });
    $("farmLevel").textContent = fmt(state.farmLevel);
    $("marketLevel").textContent = fmt(state.marketLevel);
    $("wallLevel").textContent = fmt(state.wallLevel);
    $("upkeepValue").textContent = `-${fmt(getUpkeep())}`;
  }

  function renderArmy() {
    $("infantryValue").textContent = fmt(state.infantry);
    $("archersValue").textContent = fmt(state.archers);
    $("cavalryValue").textContent = fmt(state.cavalry);
    $("armyPowerValue").textContent = fmt(getArmyPower());
    const recruitTarget = selectedArmies()[0] || activeArmies()[0];
    if ($("recruitTargetLabel")) {
      $("recruitTargetLabel").textContent = recruitTarget
        ? `当前征募对象：${armyDisplayName(recruitTarget)} · ${fmt(armySize(recruitTarget))}人`
        : "当前征募对象：暂无军团";
    }
    const recruitCosts = {
      infantry: { gold: 120, grain: 90, population: 200 },
      archers: { gold: 130, grain: 80, population: 100 },
      cavalry: { gold: 180, grain: 100, population: 50 },
    };
    document.querySelectorAll("[data-recruit]").forEach((button) => {
      button.disabled = state.actionPoints < 1 || !hasResources(recruitCosts[button.dataset.recruit]);
    });
    const createArmyButton = $("createArmyButton");
    if (createArmyButton) {
      createArmyButton.disabled = state.actionPoints < 1 || !hasResources(NEW_ARMY_COST);
    }
    document.querySelector('[data-order="drill"]').disabled = state.actionPoints < 1 || state.grain < 100 || state.drill >= 1.8;
    document.querySelector('[data-order="fortify"]').disabled = state.actionPoints < 1 || state.gold < 180;
    const frontier = $("frontierList");
    frontier.replaceChildren();
    const targets = getFrontier();
    if (!targets.length) {
      const empty = document.createElement("p");
      empty.className = "frontier-empty";
      empty.textContent = "四境皆已归于王化。";
      frontier.appendChild(empty);
    } else {
      targets.forEach((id) => {
        const province = state.provinces[id];
        const button = document.createElement("button");
        button.type = "button";
        button.className = "frontier-target";
        const status = province.siege ? `攻城 ${Math.round(province.siege.progress)}%` : `守备 ${fmt(enemyDefense(province))}`;
        button.innerHTML = safeHtml`<b>${province.name}</b><span>${ownerName(province.owner)} · ${province.terrain}</span><strong>${status}</strong>`;
        button.addEventListener("click", () => openBattle(id));
        frontier.appendChild(button);
      });
    }
  }

  function beginArmyRouteEdit(armyId) {
    if (!state.armies[armyId]) return;
    selectedArmyIds = [armyId];
    syncSelectedArmySelection();
    selectedMapObjectType = "army";
    clearPendingRegionOrder(false);
    const army = state.armies[armyId];
    $("orderHint")?.classList.remove("hidden");
    $("orderHintArmy").textContent = `已选：${armyDisplayName(army)} · ${fmt(armyPower(army))}战力 · 点击地图目标编辑路线`;
    renderMap();
    renderArmyCommand();
    toast(`已进入${armyDisplayName(army)}路线编辑`, "good");
  }

  function renderBattlePlanPanel() {
    const panel = $("battlePlanPanel");
    if (!panel) return;
    const selected = selectedArmies();
    const active = activeArmies().filter((army) => army.order?.targetRegionId || army.destinationRegion);
    $("battlePlanTitle").textContent = selected.length > 1 ? "作战编组" : "作战计划";
    const byId = new Map();
    [...active, ...selected].forEach((army) => byId.set(army.id, army));
    const pendingRoutes = pendingAttackPlan?.routesByArmyId || {};
    const routeLetters = new Map();
    let nextLetter = 0;
    const routeCode = (army, route, type) => {
      if (!route?.length) return "·";
      const key = `${type}|${route.join(">")}`;
      if (!routeLetters.has(key)) routeLetters.set(key, String.fromCharCode(65 + (nextLetter++ % 26)));
      return routeLetters.get(key);
    };
    const stateLabel = pendingAttackPlan
      ? "规划中"
      : active.length
        ? "作战进行中"
        : selected.length
          ? `待命 · 已选${selected.length}军`
          : "待命";
    $("battlePlanState").textContent = stateLabel;
    // An in-flight plan can exist after a refresh even though no army is
    // currently highlighted.  Keep that state distinct from the empty
    // selection state so the panel never says “已选虎贲” and “未选择军团”
    // at the same time.
    $("battlePlanSelection").textContent = selected.length
      ? `已选 ${selected.length}军 · ${fmt(selected.reduce((sum, army) => sum + armyPower(army), 0))}战力${selected.length > 1 ? " · 可协同或分路下令" : ""}`
      : active.length
        ? "未选中军团 · 作战进行中，点击军团卡查看"
        : "未选择军团 · 点击右侧军团卡或地图军旗；Shift+点击可多选";
    const target = pendingAttackPlan?.targetRegionId ? state.regions[pendingAttackPlan.targetRegionId] : null;
    $("battlePlanTarget")?.classList.toggle("hidden", !pendingAttackPlan);
    $("battlePlanCoordination")?.classList.toggle("hidden", !pendingAttackPlan || pendingAttackPlan.armyIds.length < 2 || pendingAttackPlan.orderType === "MOVE");
    if (pendingAttackPlan) {
      $("coordWaitAll")?.classList.toggle("active", pendingAttackPlan.coordinationMode === "WAIT_FOR_ALL");
      $("coordAttackArrival")?.classList.toggle("active", pendingAttackPlan.coordinationMode === "ATTACK_ON_ARRIVAL");
    }
    const list = $("battlePlanList");
    list.replaceChildren();
    if (!byId.size) {
      const empty = document.createElement("p");
      empty.className = "battle-plan-empty";
      empty.textContent = "尚无作战计划。选择军团后，点击地图上的地区开始规划。";
      list.appendChild(empty);
      return;
    }
    [...byId.values()].forEach((army) => {
      const order = army.order;
      const pendingRoute = pendingRoutes[army.id];
      const route = pendingRoute?.length ? pendingRoute : order?.route?.length ? order.route : [];
      const type = pendingAttackPlan?.armyIds?.includes(army.id) ? pendingAttackPlan.orderType : order?.type || "MOVE";
      const targetId = pendingAttackPlan?.armyIds?.includes(army.id) ? pendingAttackPlan.targetRegionId : order?.targetRegionId || army.destinationRegion;
      const targetRegion = targetId ? state.regions[targetId] : null;
      const card = document.createElement("article");
      card.className = `battle-plan-card${hasSelectedArmy(army.id) ? " selected" : ""}`;
      const head = document.createElement("div");
      head.className = "battle-plan-card-head";
      const badge = document.createElement("span");
      badge.className = "battle-plan-route-badge";
      badge.textContent = routeCode(army, route, type);
      const name = document.createElement("b");
      name.textContent = armyDisplayName(army);
      const power = document.createElement("strong");
      power.textContent = `${fmt(armySize(army))} / ${fmt(armyPower(army))}战力`;
      head.append(badge, name, power);
      const meta = document.createElement("span");
      meta.className = "battle-plan-card-meta";
      const leg = armyTravelLeg(army);
      const location = leg
        ? `${state.regions[leg.fromRegionId]?.name} → ${state.regions[leg.toRegionId]?.name}（途中 ${Math.round(leg.progress)}%）`
        : state.regions[army.region]?.name || "未知驻地";
      meta.textContent = `当前位置：${location} · 目标：${targetRegion ? regionDisplayName(targetRegion, state.calendar.year) : "未指定"}`;
      const routeNode = document.createElement("span");
      routeNode.className = "battle-plan-card-route";
      routeNode.textContent = route.length ? `${routeLetters.get(`${type}|${route.join(">")}`) || "·"}路 · ${route.map((id) => state.regions[id]?.name).filter(Boolean).join(" → ")}` : "尚未规划路线";
      const previewOrder = pendingRoute?.length ? makeArmyOrder(army, targetId, { type, route: pendingRoute }) : null;
      const eta = previewOrder ? previewOrder.etaDays : order ? estimateArmyArrival(army, order) : 0;
      const supply = Math.round(army.supply);
      const supplyNode = document.createElement("span");
      supplyNode.className = "battle-plan-card-supply";
      supplyNode.textContent = `${type === "ATTACK" ? "进攻" : type === "RETREAT" ? "撤退" : "移防"} · ETA ${eta}日 · 补给 ${supply}%`;
      const bar = document.createElement("i");
      bar.style.setProperty("--supply", `${clamp(supply, 0, 100)}%`);
      supplyNode.appendChild(bar);
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "battle-plan-card-edit";
      edit.textContent = "编辑路线";
      edit.addEventListener("click", () => beginArmyRouteEdit(army.id));
      card.append(head, meta, routeNode, supplyNode, edit);
      if (army.order) {
        const stop = document.createElement("button");
        stop.type = "button";
        stop.className = "battle-plan-card-edit";
        stop.textContent = "停止此军";
        stop.dataset.stopArmyId = army.id;
        stop.addEventListener("click", () => stopArmyOrder(army.id));
        card.appendChild(stop);
      }
      list.appendChild(card);
    });
    if (target) $("contextTargetName").textContent = `${regionDisplayName(target, state.calendar.year)} · ${regionOwnerName(target)}`;
  }

  function renderArmyCommand() {
    const list = $("armyList");
    list.replaceChildren();
    const armies = activeArmies();
    $("armyCountLabel").textContent = `${armies.length}军`;
    // Keep the compact command hint and the fixed作战计划 panel on the same
    // selection source.  The old static HTML contained a sample “已选” label
    // which remained in the DOM after a refresh even though no army was
    // selected, making the UI report two contradictory states to assistive
    // tooling and to users inspecting the page.
    const selected = selectedArmies();
    const hint = $("orderHint");
    const hintArmy = $("orderHintArmy");
    if (hint && hintArmy) {
      hint.classList.toggle("hidden", selected.length === 0);
      hintArmy.textContent = selected.length === 1
        ? `已选：${armyDisplayName(selected[0])} · ${fmt(armySize(selected[0]))}`
        : selected.length > 1
          ? `已选：${selected.length}支军团 · ${fmt(selected.reduce((sum, army) => sum + armySize(army), 0))}`
        : "";
    }
    armies.forEach((army) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `army-card ${hasSelectedArmy(army.id) ? "selected" : ""}`;
      const location = state.regions[army.region]?.name || state.provinces[army.province]?.name || "行军中";
      const order = army.order;
      const destination = state.regions[order?.targetRegionId || army.destinationRegion]?.name;
      const routeText = order?.route?.length ? order.route.map((id) => state.regions[id]?.name).filter(Boolean).join("→") : "";
      const orderLabel = destination
        ? `${order?.type === "RETREAT" ? "撤退至" : order?.type === "MOVE" ? "移防至" : "进攻至"}${destination} · ${Math.round(order?.movementProgress ?? army.progress)}% · ETA ${armyEtaDays(army)}日`
        : `${army.status} · 补给 ${Math.round(army.supply)}%`;
      button.setAttribute("aria-pressed", String(hasSelectedArmy(army.id)));
      const flag = document.createElement("span");
      flag.className = "army-flag";
      flag.textContent = armyBadge(army);
      const copy = document.createElement("span");
      const title = document.createElement("b");
      title.textContent = String(armyDisplayName(army));
      const detail = document.createElement("small");
      detail.textContent = `主将：${String(army.commander || "未知")} · ${location}${routeText ? ` · ${routeText}` : ""}`;
      copy.append(title, detail);
      const strength = document.createElement("strong");
      strength.textContent = fmt(armySize(army));
      const orderNode = document.createElement("em");
      orderNode.textContent = orderLabel;
      const bar = document.createElement("span");
      bar.className = "mini-bar";
      const fill = document.createElement("i");
      fill.style.width = `${clamp((army.morale + army.supply) / 2, 0, 100)}%`;
      bar.appendChild(fill);
      button.append(flag, copy, strength, orderNode, bar);
      button.addEventListener("click", (event) => selectArmy(army.id, Boolean(event.shiftKey)));
      list.appendChild(button);
    });
    const stop = $("stopArmyOrders");
    if (stop) stop.disabled = !armies.some((army) => hasSelectedArmy(army.id) && army.order);
    renderBattlePlanPanel();
  }

  function renderWars() {
    const list = $("warList");
    list.replaceChildren();
    const entries = [];
    activeArmies().filter((army) => army.order?.targetRegionId || army.destinationRegion).forEach((army) => {
      const origin = state.regions[army.region];
      const destination = state.regions[army.order?.targetRegionId || army.destinationRegion];
      if (!origin || !destination) return;
      entries.push({ title: `${armyDisplayName(army)}${army.order?.type === "RETREAT" ? "正在撤退" : "正在行军"}`, text: `${origin.name} → ${destination.name}，${REGION_DATA.routeNames[army.routeKind] || "驿道"}，进度 ${Math.round(army.order?.movementProgress ?? army.progress)}%，ETA ${armyEtaDays(army)}日` });
    });
    activeArmies().filter((army) => !army.destinationRegion && state.regions[army.region]?.contested).forEach((army) => {
      const region = state.regions[army.region];
      const province = state.provinces[army.province] || region;
      if (!region || !province) return;
      entries.push({ title: `${region.name}前线交战`, text: `${armyDisplayName(army)} ${fmt(armySize(army))} 在${province.name}争夺战略节点` });
    });
    Object.entries(state.provinces).filter(([, province]) => province.siege).forEach(([id, province]) => entries.push({ title: `围攻${province.capital}`, text: `${province.name}攻城进度 ${Math.round(province.siege.progress)}%，守军 ${fmt(province.garrison)}` }));
    Object.entries(state.enemyCampaigns).forEach(([id, campaign]) => {
      const target = state.provinces[id] || state.regions[id];
      if (!target) return;
      entries.push({ title: `${target.name}告急`, text: `${campaign.factionName}围城 ${Math.round(campaign.progress)}%，敌军 ${fmt(campaign.power)}` });
    });
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "war-empty";
      empty.textContent = "目前无大战，边境斥候仍在警戒。";
      list.appendChild(empty);
    } else {
      entries.forEach((entry) => {
        const node = document.createElement("article");
        node.className = "war-entry";
        const title = document.createElement("b");
        title.textContent = String(entry.title || "");
        const text = document.createElement("span");
        text.textContent = String(entry.text || "");
        node.append(title, text);
        list.appendChild(node);
      });
    }
    $("alertDot").classList.toggle("active", entries.length > 0);
  }

  function renderDiplomacy() {
    const list = $("diplomacyList");
    list.replaceChildren();
    let count = 0;
    Object.entries(FACTIONS).filter(([id]) => id !== "player").forEach(([id, faction]) => {
      const provinces = Object.values(state.provinces).filter((province) => province.owner === id).length;
      if (!provinces) return;
      count += 1;
      const row = document.createElement("div");
      row.className = "diplomacy-row";
      row.style.setProperty("--faction-color", faction.color);
      row.innerHTML = safeHtml`<i></i><span><b>${faction.name}</b><small>控制 ${provinces} 道 · ${faction.relation}</small></span><strong>${faction.relation === "友善" ? "+35" : faction.relation === "敌视" ? "-55" : "+0"}</strong>`;
      list.appendChild(row);
    });
    if (!count) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "暂无可见的外交势力。";
      list.appendChild(empty);
    }
  }

  function renderDecisions() {
    const decisions = [
      { title: "颁行屯田令", text: "在当前己方道增筑屯田，持续提高粮食产能。", action: "farm" },
      { title: "整饬边军", text: "消耗钱粮，使所有军团恢复士气与补给。", action: "resupply" },
      { title: "宣示王命", text: "以国库赈抚百姓，提高民心与威望。", action: "mandate" },
    ];
    $("decisionList").replaceChildren();
    decisions.forEach((decision) => {
      const node = document.createElement("article");
      node.className = "decision-card";
      node.innerHTML = safeHtml`<b>${decision.title}</b><p>${decision.text}</p><button type="button">颁布决策</button>`;
      node.querySelector("button").addEventListener("click", () => enactDecision(decision.action));
      $("decisionList").appendChild(node);
    });
    document.querySelectorAll("[data-policy]").forEach((button) => {
      button.classList.toggle("unlocked", Boolean(state.policies[button.dataset.policy]));
    });
  }

  function renderLogs() {
    const container = $("logList");
    container.replaceChildren();
    if (!state.logs.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "暂无史官记录。";
      container.appendChild(empty);
      return;
    }
    state.logs.slice(0, 50).forEach((entry) => {
      const node = document.createElement("article");
      node.className = `log-entry ${entry.type || "normal"}`;
      const body = document.createElement("div");
      const time = document.createElement("time");
      const paragraph = document.createElement("p");
      time.textContent = entry.date;
      paragraph.textContent = historicalDisplayText(entry.text);
      body.append(time, paragraph);
      node.appendChild(body);
      container.appendChild(node);
    });
  }

  function updateAdvisor() {
    const address = playerAddress();
    let advice = `“${address}，四海未靖，国事如弈。积一分国力，便多一分问鼎中原的胜算。”`;
    const threatened = Object.keys(state.enemyCampaigns);
    const activeSieges = Object.keys(state.provinces).filter((id) => state.provinces[id].siege);
    const threatenedTarget = threatened.map((id) => state.provinces[id] || state.regions[id]).find(Boolean);
    if (threatenedTarget) advice = `“急报！敌军正在围攻${threatenedTarget.name}，若不驰援，城池数月便会失守。”`;
    else if (state.actionPoints === 0) advice = "“本月政令已毕。可让时间继续流逝，但围城敌军也会趁机增援突围。”";
    else if (state.grain < getUpkeep() * 2 + 150) advice = "“军粮已经吃紧！宜劝课农桑或暂缓募兵，以免将士无食。”";
    else if (state.morale < 38) advice = "“民心如水，能载舟亦能覆舟。请速开仓赈民，勿令怨气蔓延。”";
    else if (getArmyPower() < 900) advice = `“${address}，邻国甲兵窥伺，${playerForceLabel()}尚单薄。可征步卒为阵，再以弓骑辅之。”`;
    else if (getFrontier().length) {
      const weakest = getFrontier().sort((a, b) => enemyDefense(state.provinces[a]) - enemyDefense(state.provinces[b]))[0];
      advice = activeSieges.length
        ? `“${state.provinces[activeSieges[0]].name}仍在围攻。围城贵在断援，切勿让敌军恢复城防。”`
        : `“${state.provinces[weakest].name}城外守军相对薄弱，可先破其援军，再合围州治。”`;
    }
    $("advisorText").textContent = advice;
  }

  function syncStartGate() {
    const preGame = !state.started;
    document.body.classList.toggle("pre-game", preGame);
    syncPanelGrid();
    const setup = $("setupModal");
    if (preGame) {
      const dialog = setup || ensureModal("setupModal");
      if (dialog && !dialog.open) dialog.showModal();
    } else if (setup) {
      if (setup.open) setup.close();
      // A started game has no setup flow in its DOM, even if an old modal was
      // left behind by a saved session or a cancelled submit.
      unmountClosedModal(setup);
    }
    pruneClosedModals();
  }

  function render() {
    renderDiagnostics.fullRenders += 1;
    syncStartGate();
    updateHeader();
    updateResources();
    updateRuler();
    updateGoal();
    updateSeason();
    renderMap();
    renderCourt();
    renderArmy();
    renderArmyCommand();
    renderWars();
    renderDiplomacy();
    renderDecisions();
    renderLogs();
    updateAdvisor();
    saveState();
  }

  function renderRealtime() {
    renderDiagnostics.realtimeRenders += 1;
    updateHeader();
    // Resource totals change on actions, battles and monthly settlement, all
    // of which already call render(). An idle calendar tick only changes time.
    if (!window.TianxiaMap?.isInteracting && activeArmies().some((army) => army.order)) {
      renderArmyLayer();
      renderWarLayer();
      renderArmyCommand();
      renderWars();
    }
    saveState({ realtime: true });
  }

  function performCourtAction(action) {
    const cost = action.cost(state);
    if (state.actionPoints < 1) return toast("本月政令点数已用尽", "bad");
    if (!hasResources(cost)) return toast("钱粮不足，无法颁行此令", "bad");
    spend(cost);
    action.apply(state);
    state.actionPoints -= 1;
    const province = developmentProvince();
    const location = action.id === "farm" && province ? `，${province.name}新增屯田在舆图上可见` : "";
    addLog(`${playerAddress()}颁行“${action.name}”之令，${action.effect.replace(/·/g, "，")}${location}。`, "good");
    sound("tap");
    toast(`${action.name}：${action.effect}`, "good");
    render();
    checkDefeat();
  }

  function performRecruit(type) {
    const data = {
      infantry: { label: "步卒", amount: 200, cost: { gold: 120, grain: 90, population: 200 } },
      archers: { label: "弓手", amount: 100, cost: { gold: 130, grain: 80, population: 100 } },
      cavalry: { label: "骑兵", amount: 50, cost: { gold: 180, grain: 100, population: 50 } },
    }[type];
    if (!data || state.actionPoints < 1) return toast("本月政令点数不足", "bad");
    if (!hasResources(data.cost)) return toast("征募所需的钱粮或人口不足", "bad");
    spend(data.cost);
    const receivingArmy = primarySelectedArmy() || activeArmies()[0];
    if (receivingArmy) receivingArmy[type] += data.amount;
    syncNationalArmyTotals();
    const province = developmentProvince();
    if (province) {
      province.garrison += Math.round(data.amount * 0.12);
      province.barracks = Math.min(6, (province.barracks || 1) + (province.garrison >= (province.barracks || 1) * 340 ? 1 : 0));
    }
    state.actionPoints -= 1;
    addLog(`军府征得${data.label}${fmt(data.amount)}名，编入王师${province ? `；${province.name}兵营扩充，舆图驻军随之增加` : ""}。`, "good");
    sound("war");
    toast(`${data.label} +${fmt(data.amount)}`, "good");
    render();
  }

  function createNewArmy() {
    if (state.actionPoints < 1) return toast("本月政令点数不足，无法编成新军", "bad");
    if (!hasResources(NEW_ARMY_COST)) return toast("编成新军所需的钱粮或人口不足", "bad");
    const sequence = Math.max(3, Number(state.nextArmyNumber) || 3);
    const id = `army-${sequence}`;
    const origin = state.regions[selectedRegionId]
      && regionController(state.regions[selectedRegionId]) === "player"
      ? state.regions[selectedRegionId]
      : state.regions[PROVINCE_CAPITAL_REGION[normalizeProvinceId(selectedProvince)]] || state.regions.changan;
    const province = origin?.province || "jingji";
    const name = `${NEW_ARMY_BANNERS[(sequence - 3) % NEW_ARMY_BANNERS.length]}${chineseNumber(sequence)}军`;
    const commander = NEW_ARMY_COMMANDERS[(sequence - 3) % NEW_ARMY_COMMANDERS.length];
    spend(NEW_ARMY_COST);
    state.armies[id] = {
      id,
      name,
      commander,
      province,
      region: origin?.id || "changan",
      destination: null,
      destinationRegion: null,
      progress: 0,
      infantry: 160,
      archers: 30,
      cavalry: 10,
      morale: 68,
      supply: 78,
      status: `驻守${origin?.name || "长安"}`,
      order: null,
      route: [],
      eta: null,
      movementProgress: 0,
      battleState: "idle",
    };
    state.nextArmyNumber = sequence + 1;
    state.actionPoints -= 1;
    if (state.provinces[province]) {
      state.provinces[province].garrison += 18;
      state.provinces[province].barracks = Math.min(6, (state.provinces[province].barracks || 1) + 1);
    }
    selectedArmyIds = [id];
    syncSelectedArmySelection();
    selectedRegionId = origin?.id || "changan";
    selectedProvince = province;
    selectedMapObjectType = "army";
    syncNationalArmyTotals();
    addLog(`军府新编${name}，由${commander}统领，驻守${origin?.name || "长安"}。`, "good");
    sound("war");
    toast(`${name}编成，可在军团列表中独立下令`, "good");
    render();
  }

  function selectArmy(id, additive = false) {
    const army = state.armies[id];
    if (!army) return;
    setRightPanelCollapsed(false, { persist: false });
    setRightSidebarTab("army");
    if (additive) {
      selectedArmyIds = selectedArmyIds.includes(id)
        ? selectedArmyIds.filter((item) => item !== id)
        : [...selectedArmyIds, id];
    } else {
      selectedArmyIds = selectedArmyIds.length === 1 && selectedArmyIds[0] === id ? [] : [id];
    }
    syncSelectedArmySelection();
    selectedMapObjectType = selectedArmyIds.length ? "army" : "region";
    clearPendingRegionOrder(false);
    const selected = selectedArmies();
    $("orderHint").classList.toggle("hidden", !selected.length);
    if (selected.length) {
      $("orderHintArmy").textContent = selected.length === 1
        ? `已选：${armyDisplayName(selected[0])} · ${fmt(armySize(selected[0]))}`
        : `已选：${selected.length}支军团 · ${fmt(selected.reduce((sum, item) => sum + armySize(item), 0))}`;
    }
    renderMap();
    renderProvinceCard();
    renderArmyCommand();
    sound("tap");
  }

  function issueRegionOrder(targetId, options = {}) {
    const armies = selectedArmies();
    if (!armies.length) return toast("请先选择要下令的军团", "bad");
    const target = state.regions[targetId];
    if (!target) return false;
    const type = options.type || (regionController(target) === "player" ? "MOVE" : "ATTACK");
    if (type === "RETREAT" && regionController(target) !== "player") {
      return toast("撤退目标必须是当前可通行的友方地区", "bad");
    }
    const routesByArmyId = routesForArmies(armies, targetId, { type });
    const eligible = armies.filter((army) => routesByArmyId[army.id]?.length);
    if (!eligible.length) return toast(type === "RETREAT" ? "撤退必须沿合法友方路径" : "所选军团没有通往该地区的合法路线", "bad");
    const coordinationMode = options.coordinationMode || pendingAttackPlan?.coordinationMode || (eligible.length > 1 && type === "ATTACK" ? "WAIT_FOR_ALL" : "ATTACK_ON_ARRIVAL");
    const planId = type === "ATTACK" && eligible.length > 1
      ? `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      : null;
    if (planId) {
      state.attackPlans ||= {};
      state.attackPlans[planId] = {
        id: planId,
        armyIds: eligible.map((army) => army.id),
        targetRegionId: targetId,
        routesByArmyId,
        coordinationMode,
        status: "marching",
        arrivedArmyIds: [],
        createdAt: Date.now(),
      };
    }
    let grainCost = 0;
    eligible.forEach((army) => {
      const route = routesByArmyId[army.id];
      const modifying = Boolean(army.order || army.haltedLeg);
      const previousPlanId = army.order?.attackPlanId;
      if (previousPlanId && state.attackPlans?.[previousPlanId]) {
        state.attackPlans[previousPlanId].armyIds = state.attackPlans[previousPlanId].armyIds.filter((id) => id !== army.id);
        state.attackPlans[previousPlanId].arrivedArmyIds = (state.attackPlans[previousPlanId].arrivedArmyIds || []).filter((id) => id !== army.id);
        if (!state.attackPlans[previousPlanId].armyIds.length) delete state.attackPlans[previousPlanId];
      }
      const order = makeArmyOrder(army, targetId, { type, route, attackPlanId: planId, coordinationMode });
      if (!order) return;
      const preservedProgress = order.movementProgress;
      army.order = order;
      army.haltedLeg = null;
      army.route = route;
      army.eta = order.etaDays;
      // Same-edge edits preserve progress; other routes first walk the
      // remaining returnLeg back to the actual route junction.
      army.movementProgress = preservedProgress;
      army.progress = preservedProgress;
      army.destinationRegion = targetId;
      army.destination = target.province;
      army.routeKind = routeBetween(route[0], route[1])?.kind || "road";
      army.battleState = type === "RETREAT" ? "retreating" : type === "ATTACK" ? "marching_attack" : "marching";
      army.status = type === "RETREAT" ? `撤往${target.name}` : type === "MOVE" ? `移防${target.name}` : `进攻${target.name}`;
      if (!modifying && !options.noCharge) {
        const routeCost = routeDistance(route);
        const cost = Math.round((18 + armySize(army) * .025) * routeCost);
        grainCost += cost;
        army.supply = Math.max(8, army.supply - Math.round(3 * routeCost));
      }
    });
    state.grain = Math.max(0, state.grain - grainCost);
    const names = eligible.map(armyDisplayName).join("、");
    addLog(`${names}${type === "RETREAT" ? "奉令撤退" : type === "MOVE" ? "奉令移防" : "奉令进攻"}${target.name}，${eligible.length > 1 ? `分${eligible.length}路` : "沿合法路线"}${grainCost ? `，耗粮${fmt(grainCost)}` : "，调整原有军令"}。`, type === "ATTACK" ? "war" : "normal");
    selectedRegionId = targetId;
    selectedProvince = target.province;
    pendingOrderTargetId = null;
    pendingAttackPlan = null;
    $("battlePlanTarget")?.classList.add("hidden");
    render();
    return true;
  }

  function stopArmyOrder(armyId, { render: shouldRender = true } = {}) {
    const army = state.armies[armyId];
    if (!army?.order) return false;
    const planId = army.order.attackPlanId;
    const leg = armyTravelLeg(army);
    army.haltedLeg = leg?.progress > 0 && leg.progress < 100 ? { ...leg } : null;
    army.order = null;
    army.route = [];
    army.eta = null;
    army.movementProgress = 0;
    army.progress = 0;
    army.destinationRegion = null;
    army.destination = null;
    army.battleState = "idle";
    army.status = army.haltedLeg ? `停驻${state.regions[army.haltedLeg.fromRegionId]?.name || ""}至${state.regions[army.haltedLeg.toRegionId]?.name || ""}途中`
      : `驻守${state.regions[army.region]?.name || "当前地区"}`;
    if (planId && state.attackPlans?.[planId]) {
      state.attackPlans[planId].armyIds = state.attackPlans[planId].armyIds.filter((id) => id !== armyId);
      state.attackPlans[planId].arrivedArmyIds = (state.attackPlans[planId].arrivedArmyIds || []).filter((id) => id !== armyId);
      if (!state.attackPlans[planId].armyIds.length) delete state.attackPlans[planId];
    }
    if (shouldRender) render();
    return true;
  }

  function advanceArmyOrders(days = 1) {
    let mapStateChanged = false;
    const steps = Math.max(0, Math.floor(Number(days) || 0));
    for (let day = 0; day < steps; day += 1) {
      const arrivalsByPlan = new Map();
      activeArmies().forEach((army) => {
        const order = army.order;
        if (!order || !army.destinationRegion) return;
        if (order.returnLeg) {
          const leg = order.returnLeg;
          const nextRegion = state.regions[leg.toRegionId];
          const edge = routeBetween(leg.fromRegionId, leg.toRegionId);
          const modifier = regionTerrainModifier(nextRegion, edge?.kind || "road");
          const cavalryMobility = army.cavalry / Math.max(1, armySize(army)) * (/平原|河谷/.test(nextRegion.terrain) ? 9 : 2);
          leg.progress = clamp(leg.progress + Math.max(2.5, (9 + army.supply / 22 + cavalryMobility) / modifier), 0, 100);
          army.supply = Math.max(0, army.supply - (edge?.kind === "water" ? .8 : modifier * .95));
          order.etaDays = estimateArmyArrival(army, order);
          army.eta = order.etaDays;
          if (leg.progress < 100) return;
          order.returnLeg = null;
          if (order.route.length === 1) stopArmyOrder(army.id, { render: false });
          army.status = army.order ? `改道经${nextRegion.name}` : `驻守${nextRegion.name}`;
          mapStateChanged = true;
          return;
        }
        const route = order.route?.length ? order.route : [army.region, order.targetRegionId];
        // Meeting armies stay at their destination. Do not advance the final
        // edge again or consume marching supplies while waiting for allies.
        if (army.battleState === "arrived" && order.routeIndex >= route.length - 1) {
          const plan = state.attackPlans?.[order.attackPlanId];
          if (plan) arrivalsByPlan.set(plan.id, plan);
          else {
            // A removed/corrupt meeting plan must not leave an army waiting
            // forever. Preserve its reached location and require a new order.
            stopArmyOrder(army.id, { render: false });
            mapStateChanged = true;
          }
          return;
        }
        const nextId = route[Math.min(order.routeIndex + 1, route.length - 1)];
        const nextRegion = state.regions[nextId];
        if (!nextRegion) { stopArmyOrder(army.id, { render: false }); mapStateChanged = true; return; }
        const edge = routeBetween(army.region, nextId);
        const modifier = regionTerrainModifier(nextRegion, edge?.kind || army.routeKind);
        const cavalryMobility = army.cavalry / Math.max(1, armySize(army)) * (/平原|河谷/.test(nextRegion.terrain) ? 9 : 2);
        const daily = Math.max(2.5, (9 + army.supply / 22 + cavalryMobility) / modifier);
        order.movementProgress = clamp(order.movementProgress + daily, 0, 100);
        army.movementProgress = order.movementProgress;
        army.progress = order.movementProgress;
        army.supply = Math.max(0, army.supply - (edge?.kind === "water" ? .8 : modifier * .95));
        army.eta = estimateArmyArrival(army, order);
        order.etaDays = army.eta;
        if (order.movementProgress < 100) return;
        mapStateChanged = true;
        army.battleApproachRegionId = nextId === order.targetRegionId && regionController(nextRegion) !== "player"
          ? army.region : null;
        army.region = nextId;
        army.province = nextRegion.province;
        army.routeKind = edge?.kind || army.routeKind || "road";
        order.routeIndex += 1;
        order.movementProgress = 0;
        army.movementProgress = 0;
        army.progress = 0;
        if (order.routeIndex < route.length - 1) {
          // Arrival at an intermediate node is a real movement event, not a
          // teleport: the next day starts from this node on the same route.
          army.status = `${order.type === "RETREAT" ? "撤退经" : "行军经"}${nextRegion.name}`;
          return;
        }
        const targetId = order.targetRegionId;
        const planId = order.attackPlanId;
        if (order.type === "RETREAT" || regionController(nextRegion) === "player") {
          stopArmyOrder(army.id, { render: false });
          army.status = `驻守${nextRegion.name}`;
          army.supply = clamp(army.supply + 9, 0, 100);
          if (state.enemyCampaigns[nextRegion.province]) resolveReliefArmy(army, nextRegion.province);
          else addLog(`${armyDisplayName(army)}抵达${nextRegion.name}，依托当地粮仓恢复补给。`, "good");
        } else {
          army.battleState = "arrived";
          army.eta = 0;
          order.etaDays = 0;
          army.status = `抵达${nextRegion.name}待战`;
          if (planId) {
            const plan = state.attackPlans?.[planId];
            if (plan) {
              plan.arrivedArmyIds = [...new Set([...(plan.arrivedArmyIds || []), army.id])];
              arrivalsByPlan.set(planId, plan);
            } else resolveRegionBattle(army, targetId);
          } else {
            resolveRegionBattle(army, targetId);
          }
        }
        if (army.order && army.order.type !== "ATTACK") {
          army.order = null;
          army.destinationRegion = null;
        }
      });
      arrivalsByPlan.forEach((plan) => {
        const allArrived = plan.armyIds.every((id) => plan.arrivedArmyIds.includes(id) || !state.armies[id]?.order);
        const participants = plan.coordinationMode === "WAIT_FOR_ALL" && !allArrived
          ? []
          : plan.armyIds.map((id) => state.armies[id]).filter((army) => army && plan.arrivedArmyIds.includes(army.id));
        if (participants.length && (plan.coordinationMode === "ATTACK_ON_ARRIVAL" || allArrived)) resolveAttackPlan(plan, participants);
      });
    }
    if (mapStateChanged) {
      syncNationalArmyTotals();
      saveState({ realtime: true });
    }
    return mapStateChanged;
  }

  function resolveAttackPlan(plan, participants) {
    if (!plan || plan.status === "resolved" || !participants.length) return;
    const target = state.regions[plan.targetRegionId];
    if (!target) return;
    plan.status = "resolving";
    const uniqueEdges = new Set(participants.map((army) => {
      const route = army.order?.route || plan.routesByArmyId?.[army.id] || [];
      const index = army.order?.routeIndex ?? route.length - 1;
      return route[Math.max(0, index - 1)] || army.region;
    }));
    const edgeBonus = 1 + Math.min(.28, Math.max(0, uniqueEdges.size - 1) * .12);
    const combinedPower = participants.reduce((sum, army) =>
      sum + armyPower(army) * (battleApproach(army, target.id)?.kind === "river" ? .72 : 1), 0) * edgeBonus;
    const defense = Math.max(90, target.garrison * (1 + target.defense / 120) * regionTerrainModifier(target, routeBetween(target.id, [...uniqueEdges][0])?.kind) * (target.type === "gate" ? 1.75 : target.type === "capital" ? 1.28 : 1));
    const ratio = combinedPower / Math.max(defense, 1);
    const victory = Math.random() < clamp(.16 + ratio * .44, .12, .93);
    const totalSize = Math.max(1, participants.reduce((sum, army) => sum + armySize(army), 0));
    const lossRate = clamp((victory ? .05 : .13) / Math.max(.7, ratio), .035, .3);
    const totalLoss = Math.round(totalSize * lossRate);
    participants.forEach((army) => {
      const share = Math.round(totalLoss * armySize(army) / totalSize);
      distributeArmyLoss(army, share);
      army.order = null;
      army.route = [];
      army.eta = null;
      army.movementProgress = 0;
      army.progress = 0;
      army.destination = null;
      army.destinationRegion = null;
      army.battleState = victory ? "idle" : "engaged";
    });
    const enemyLoss = Math.min(target.garrison, Math.round(target.garrison * clamp(victory ? .64 * ratio : .24 * ratio, .12, .9)));
    target.garrison = Math.max(victory ? 0 : 25, target.garrison - enemyLoss);
    if (victory && target.garrison < 45) {
      const previousOwner = regionController(target);
      setRegionControl(target, "player");
      target.contested = false;
      target.garrison = Math.max(35, Math.round(totalSize * .06));
      participants.forEach((army) => {
        army.region = target.id;
        army.province = target.province;
        army.status = `占领${target.name}`;
        army.morale = clamp(army.morale + 5, 0, 100);
      });
      addLog(`${participants.map(armyDisplayName).join("、")}从${uniqueEdges.size}个方向合击${target.name}，击破${ownerName(previousOwner)}守军，合围加成${Math.round((edgeBonus - 1) * 100)}%，我军折损${fmt(totalLoss)}。`, "war");
      toast(`${target.name}已被协同攻占`, "good");
      updateProvinceFromRegions(target.province);
    } else {
      target.contested = true;
      participants.forEach((army) => { army.status = `受挫于${target.name}`; army.morale = clamp(army.morale - 9, 0, 100); });
      addLog(`${participants.map(armyDisplayName).join("、")}进攻${target.name}受挫：${uniqueEdges.size > 1 ? "多面夹击仍未破关" : "敌军据地顽抗"}，我军折损${fmt(totalLoss)}，敌军损失${fmt(enemyLoss)}。`, "bad");
      toast(`${target.name}尚未攻克`, "bad");
    }
    const resolvedIds = new Set(participants.map((army) => army.id));
    plan.armyIds = plan.armyIds.filter((id) => !resolvedIds.has(id));
    plan.arrivedArmyIds = (plan.arrivedArmyIds || []).filter((id) => !resolvedIds.has(id));
    if (plan.armyIds.length) plan.status = "marching";
    else { plan.status = "resolved"; delete state.attackPlans[plan.id]; }
  }

  function resolveReliefArmy(army, targetId) {
    const campaign = state.enemyCampaigns[targetId];
    const province = state.provinces[targetId];
    if (!campaign) return;
    const ratio = armyPower(army) / Math.max(campaign.power, 1);
    const victory = Math.random() < clamp(.24 + ratio * .46, .2, .9);
    const enemyLoss = Math.round(campaign.power * (victory ? .58 : .26));
    const ourLoss = distributeArmyLoss(army, Math.round(armySize(army) * (victory ? .08 : .17)));
    campaign.power = Math.max(0, campaign.power - enemyLoss);
    army.morale = clamp(army.morale + (victory ? 7 : -10), 5, 100);
    if (victory || campaign.power < 100) {
      delete state.enemyCampaigns[targetId];
      const capital = state.regions[PROVINCE_CAPITAL_REGION[targetId]];
      if (capital) capital.contested = false;
      army.status = `解围${province.capital}`;
      addLog(`${armyDisplayName(army)}驰抵${province.name}，内外夹击击退围城军，折损${fmt(ourLoss)}。`, "good");
      toast(`${province.capital}之围已解`, "good");
    } else {
      campaign.progress = Math.max(0, campaign.progress - 15);
      army.status = `${province.name}城外御敌`;
      addLog(`${armyDisplayName(army)}在${province.capital}城外与敌激战，虽折损${fmt(ourLoss)}，仍迟滞敌军攻势。`, "war");
    }
  }

  function resolveRegionBattle(army, regionId) {
    const region = state.regions[regionId];
    const planId = army.order?.attackPlanId;
    const province = state.provinces[region.province];
    const route = battleApproach(army, regionId);
    const terrainDefense = regionTerrainModifier(region, route?.kind);
    const gateBonus = region.type === "gate" ? 1.75 : region.type === "capital" ? 1.28 : 1;
    const riverPenalty = route?.kind === "river" ? .72 : 1;
    const supplyFactor = .55 + army.supply / 180;
    const attack = armyPower(army) * riverPenalty * supplyFactor;
    const defense = Math.max(90, region.garrison * (1 + region.defense / 120) * terrainDefense * gateBonus);
    const ratio = attack / defense;
    const victory = Math.random() < clamp(.16 + ratio * .44, .12, .9);
    const ourLossRate = clamp((victory ? .05 : .13) * terrainDefense * gateBonus / Math.max(.7, ratio), .035, .28);
    const ourLoss = distributeArmyLoss(army, armySize(army) * ourLossRate);
    const enemyLoss = Math.min(region.garrison, Math.round(region.garrison * clamp(victory ? .64 * ratio : .24 * ratio, .12, .9)));
    region.garrison = Math.max(victory ? 0 : 25, region.garrison - enemyLoss);
    army.destination = null;
    army.destinationRegion = null;
    army.progress = 0;
    army.order = null;
    army.route = [];
    army.eta = null;
    army.movementProgress = 0;
    army.battleState = "engaged";
    if (planId && state.attackPlans?.[planId]) {
      state.attackPlans[planId].armyIds = state.attackPlans[planId].armyIds.filter((id) => id !== army.id);
      state.attackPlans[planId].arrivedArmyIds = (state.attackPlans[planId].arrivedArmyIds || []).filter((id) => id !== army.id);
      if (!state.attackPlans[planId].armyIds.length) delete state.attackPlans[planId];
    }
    if (victory && region.garrison < 45) {
      const previousOwner = regionController(region);
      setRegionControl(region, "player");
      region.contested = false;
      region.garrison = Math.max(35, Math.round(armySize(army) * .06));
      army.region = regionId;
      army.province = region.province;
      army.status = `占领${region.name}`;
      army.battleState = "idle";
      army.morale = clamp(army.morale + 5, 0, 100);
      addLog(`${armyDisplayName(army)}在${region.terrain}击破${ownerName(previousOwner)}守军，攻占${region.name}；我军折损${fmt(ourLoss)}。`, "war");
      toast(`战略节点已占领：${region.name}`, "good");
      updateProvinceFromRegions(region.province);
    } else {
      region.contested = true;
      army.status = `受挫于${region.name}`;
      army.morale = clamp(army.morale - 9, 0, 100);
      const reason = region.type === "gate" ? "关隘险固" : route?.kind === "river" ? "渡河受阻" : "敌军据地顽抗";
      addLog(`${armyDisplayName(army)}进攻${region.name}受挫：${reason}，我军折损${fmt(ourLoss)}，敌军损失${fmt(enemyLoss)}。`, "bad");
      toast(`${region.name}尚未攻克`, "bad");
    }
  }

  function updateProvinceFromRegions(provinceId) {
    const regions = Object.values(state.regions).filter((region) => region.province === provinceId);
    const playerCount = regions.filter((region) => regionController(region) === "player").length;
    const capital = regions.find((region) => region.id === PROVINCE_CAPITAL_REGION[provinceId]);
    const province = state.provinces[provinceId];
    if (regionController(capital) === "player" && playerCount >= Math.ceil(regions.length * .75)) {
      const newlyAcquired = province.owner !== "player";
      province.owner = "player";
      province.fieldTroops = 0;
      province.garrison = regions.reduce((sum, region) => sum + (regionController(region) === "player" ? region.garrison : 0), 0);
      province.siege = null;
      if (newlyAcquired) {
        state.prestige += 8;
        state.morale = clamp(state.morale + 2, 0, 100);
        selectedProvince = provinceId;
        addLog(`${province.name}府治与多数战略区域皆入王化，朝廷正式接管本道。`, "good");
      }
    } else if (playerCount > 0) {
      province.fieldTroops = Math.max(100, Math.round(province.fieldTroops * .82));
    }
  }

  function advanceFrontlineArmies() {
    activeArmies().forEach((army) => {
      if (army.destinationRegion) return;
      const region = state.regions[army.region];
      if (region?.contested && regionController(region) !== "player") {
        resolveRegionBattle(army, region.id);
        return;
      }
      if (regionController(region) === "player") return;
      const province = state.provinces[army.province];
      if (!province || province.owner === "player") return;
      if (province.fieldTroops > 0) resolveArmyArrival(army, army.province);
      else if (province.siege) army.status = `围攻${province.capital}`;
    });
  }

  function resolveArmyArrival(army, targetId) {
    const target = state.provinces[targetId];
    const attack = armyPower(army);
    const defense = enemyDefense(target);
    const ratio = attack / Math.max(defense, 1);
    const victory = Math.random() < clamp(.2 + ratio * .45, .18, .88);
    const loss = clamp((victory ? .07 : .16) * (1.15 - army.morale / 200), .04, .2);
    army.infantry = Math.max(0, Math.round(army.infantry * (1 - loss)));
    army.archers = Math.max(0, Math.round(army.archers * (1 - loss * .9)));
    army.cavalry = Math.max(0, Math.round(army.cavalry * (1 - loss * .7)));
    army.morale = clamp(army.morale + (victory ? 4 : -11), 5, 100);
    if (victory) {
      target.fieldTroops = Math.max(0, Math.round(target.fieldTroops * (ratio > 1.2 ? .28 : .52)));
      if (target.fieldTroops < 100) {
        target.fieldTroops = 0;
        target.siege ||= { progress: 6, rounds: 0, originalOwner: target.owner, armyId: army.id };
        army.province = targetId;
        army.status = `围攻${target.capital}`;
        addLog(`${armyDisplayName(army)}在${target.name}城外击溃敌军，地图战线推进至${target.capital}城下。`, "war");
      } else {
        army.province = targetId;
        army.status = `${target.name}前线作战`;
        addLog(`${armyDisplayName(army)}进入${target.name}，野战得利但敌军仍能成阵。`, "good");
      }
    } else {
      army.morale = Math.max(5, army.morale - 6);
      army.status = `受挫于${target.name}`;
      addLog(`${armyDisplayName(army)}进攻${target.name}受挫，正在边境重整军阵。`, "bad");
    }
    army.destination = null;
    army.progress = 0;
    syncNationalArmyTotals();
  }

  function enactDecision(action) {
    if (state.actionPoints < 1) return toast("本月政令点数不足", "bad");
    if (action === "farm") {
      if (state.gold < 180) return toast("国库不足", "bad");
      const province = developmentProvince();
      state.gold -= 180;
      province.farms = (province.farms || 1) + 1;
      province.prosperity += 2;
      addLog(`${province.name}奉诏开垦屯田，粮食地图上的产能随之提高。`, "good");
    } else if (action === "resupply") {
      if (state.gold < 140 || state.grain < 180) return toast("钱粮不足", "bad");
      state.gold -= 140; state.grain -= 180;
      activeArmies().forEach((army) => { army.morale = clamp(army.morale + 8, 0, 100); army.supply = clamp(army.supply + 18, 0, 100); });
      addLog("朝廷调拨军粮与甲械，各军士气、补给得到恢复。", "good");
    } else {
      if (state.gold < 160) return toast("国库不足", "bad");
      state.gold -= 160; state.morale = clamp(state.morale + 6, 0, 100); state.prestige += 4;
      addLog("天子颁诏抚民，郡县传檄，民心与朝廷威望上升。", "good");
    }
    state.actionPoints -= 1;
    render();
  }

  function performMilitaryOrder(order) {
    if (state.actionPoints < 1) return toast("本月政令点数不足", "bad");
    if (order === "drill") {
      if (state.grain < 100) return toast("粮草不足，无法大练三军", "bad");
      if (state.drill >= 1.8) return toast("王师训练已臻化境", "good");
      state.grain -= 100;
      state.drill = Math.min(1.8, state.drill + 0.08);
      addLog("王师会操于京郊，阵法号令愈发精熟，全军战力提升。", "good");
      toast("操练完成：全军战力 +8%", "good");
    } else {
      if (state.gold < 180) return toast("国库不足，无法整修城防", "bad");
      state.gold -= 180;
      state.wallLevel += 1;
      ownedProvinces().forEach((id) => {
        state.provinces[id].defense = clamp(state.provinces[id].defense + 3, 0, 100);
        state.provinces[id].barracks = Math.min(6, (state.provinces[id].barracks || 1) + 1);
      });
      addLog("工匠修葺各州城垒，增置垛口箭楼，疆土更为稳固。", "good");
      toast("城防等级 +1", "good");
    }
    state.actionPoints -= 1;
    sound("tap");
    render();
  }

  function targetRegionForProvince(provinceId) {
    if (provinceId && typeof provinceId === "object") {
      provinceId = Object.entries(state.provinces).find(([, item]) => item === provinceId)?.[0];
    }
    const candidates = Object.values(state.regions).filter((region) => region.province === provinceId);
    return candidates.find((region) => region.id === selectedRegionId)
      || candidates.find((region) => regionController(region) !== "player")
      || candidates[0]
      || null;
  }

  function enemyDefense(province, targetRegion = targetRegionForProvince(province)) {
    const regionalGarrison = Math.max(0, Number(targetRegion?.garrison ?? province.garrison ?? 0));
    const fieldTroops = Math.max(0, Number(province.fieldTroops || 0));
    const fortification = Math.max(0, Number(targetRegion?.defense ?? province.defense ?? 0)) + Math.max(0, Number(targetRegion?.fort || 0)) * 8;
    const activeTroops = fieldTroops + regionalGarrison;
    const wallFactor = fieldTroops > 0 ? 1 : 1 + fortification / 140;
    const terrainFactor = targetRegion ? regionTerrainModifier(targetRegion) : (province.terrainMod || 1);
    return Math.max(1, Math.round(activeTroops * wallFactor * terrainFactor));
  }

  function battleChance(province, dispatchPercent, tactic = "field", targetRegion = null) {
    const attack = dispatchArmyPower() * (dispatchPercent / 100);
    let defense = enemyDefense(province, targetRegion || targetRegionForProvince(province));
    if (state.enemyCampaigns[battleTarget]) defense = state.enemyCampaigns[battleTarget].power;
    if (tactic === "assault") defense *= 1.16;
    if (tactic === "siege") defense *= 0.8;
    const ratio = attack / Math.max(defense, 1);
    return clamp(0.12 + ratio * 0.41 + state.prestige / 1000, 0.14, 0.9);
  }

  function openBattle(id, regionId = selectedRegionId) {
    const selected = selectedArmies();
    if (selected.length) {
      selectedRegionId = regionId || id;
      selectedProvince = state.regions[selectedRegionId]?.province || id;
      if (!prepareRegionOrder(selectedRegionId)) return toast("所选军团没有通往该地区的合法路线", "bad");
      return;
    }
    const firstReady = activeArmies().find((army) => !army.order);
    if (!firstReady) return toast("请先选择要出征的军团", "bad");
    selectedArmyIds = [firstReady.id];
    syncSelectedArmySelection();
    renderMap();
    renderArmyCommand();
    if (!prepareRegionOrder(regionId || id)) return toast("军团只能攻击实际相邻地区", "bad");
  }

  function updateBattlePreview() {
    if (!battleTarget) return;
    const province = state.provinces[battleTarget];
    const targetRegion = state.regions[battleTargetRegionId] || targetRegionForProvince(battleTarget);
    const percent = Number($("dispatchRange").value);
    const tactic = new FormData($("battleForm")).get("tactic") || "field";
    const power = Math.round(dispatchArmyPower() * percent / 100);
    const chance = battleChance(province, percent, tactic, targetRegion);
    const relief = state.enemyCampaigns[battleTarget];
    const phase = relief ? "驰援解围" : province.fieldTroops > 0 ? "第一阶段 · 争夺城外战场" : `第二阶段 · 围攻${province.capital}`;
    $("battleTargetName").textContent = targetRegion ? `${province.name} · ${targetRegion.name} · ${targetRegion.terrain}` : province.name;
    $("ourBattlePower").textContent = fmt(power);
    $("campaignPhase").textContent = province.siege && !relief ? `${phase} · 已围 ${province.siege.rounds} 轮` : phase;
    $("enemyBattlePower").textContent = fmt(relief ? relief.power : enemyDefense(province, targetRegion));
    $("dispatchLabel").textContent = `${percent}%`;
    $("dispatchBreakdown").replaceChildren();
    const selectedArmy = primarySelectedArmy();
    const totals = selectedArmy
      ? { infantry: selectedArmy.infantry, archers: selectedArmy.archers, cavalry: selectedArmy.cavalry }
      : nationalArmyTotals();
    [["步卒", totals.infantry], ["弓手", totals.archers], ["骑兵", totals.cavalry]].forEach(([label, count]) => {
      const span = document.createElement("span");
      span.textContent = `${label} ${fmt(count * percent / 100)}`;
      $("dispatchBreakdown").appendChild(span);
    });
    const odds = chance >= 0.78 ? "胜算很高" : chance >= 0.62 ? "可堪一战" : chance >= 0.46 ? "胜负难料" : chance >= 0.3 ? "形势不利" : "不宜冒进";
    $("battleOdds").textContent = `${odds} · ${Math.round(chance * 100)}%`;
    $("battleOdds").style.color = chance >= 0.62 ? "#9fbb9e" : chance < 0.4 ? "#c87665" : "#d1b779";
    const grainCost = 140 + Math.round((province.travel || 80) / 4) + (tactic === "assault" ? 55 : tactic === "siege" ? 25 : 0);
    $("battleWarning").textContent = relief
      ? `驰援消耗 ${grainCost} 粮和 1 行动力。击破围城军可降低围城进度；敌军溃退后方能解围。`
      : `本轮消耗 ${grainCost} 粮和 1 行动力。${province.fieldTroops > 0 ? "须先击溃城外守军，方能围攻州治。" : "围城更稳但敌方可能来援；强攻破城快但伤亡大。"}`;
    $("confirmBattleButton").textContent = relief ? "驰援破围" : tactic === "field" ? "列阵接战" : tactic === "siege" ? "断道围城" : "备器攻城";
  }

  function resolveBattle() {
    const selected = selectedArmies();
    if (!selected.length || !battleTargetRegionId) return toast("出征军团或目标地区已失效", "bad");
    const targetRegion = state.regions[battleTargetRegionId] || targetRegionForProvince(battleTarget);
    const adjacentEnemy = targetRegion && regionNeighbors(targetRegion).some(({ id }) => regionController(state.regions[id]) === "player");
    if (!battleTarget || (!getFrontier().includes(battleTarget) && !state.enemyCampaigns[battleTarget] && !adjacentEnemy)) return;
    const province = state.provinces[battleTarget];
    const percent = Number($("dispatchRange").value);
    const tactic = new FormData($("battleForm")).get("tactic") || "field";
    const chance = battleChance(province, percent, tactic, targetRegion);
    const dispatchedPower = commandArmyPower(selected);
    const grainCost = 140 + Math.round((province.travel || 80) / 4) + (tactic === "assault" ? 55 : tactic === "siege" ? 25 : 0);
    state.grain -= grainCost;
    state.actionPoints -= 1;
    const victory = Math.random() < chance;
    const lossRisk = tactic === "assault" ? 1.55 : tactic === "siege" ? 0.58 : 1;
    const baseLoss = (victory ? 0.045 + Math.random() * 0.075 : 0.11 + Math.random() * 0.12) * lossRisk;
    const lossShare = baseLoss * (percent / 100);
    const totals = selected.reduce((sum, army) => ({
      infantry: sum.infantry + Math.max(0, army.infantry),
      archers: sum.archers + Math.max(0, army.archers),
      cavalry: sum.cavalry + Math.max(0, army.cavalry),
    }), { infantry: 0, archers: 0, cavalry: 0 });
    const losses = {
      infantry: Math.min(totals.infantry, Math.round(totals.infantry * lossShare)),
      archers: Math.min(totals.archers, Math.round(totals.archers * lossShare)),
      cavalry: Math.min(totals.cavalry, Math.round(totals.cavalry * lossShare)),
    };
    const totalLoss = losses.infantry + losses.archers + losses.cavalry;
    let remainingLoss = totalLoss;
    selected.forEach((army, index, armies) => {
      const share = index === armies.length - 1 ? remainingLoss : Math.min(remainingLoss, Math.round(totalLoss * armySize(army) / Math.max(1, totals.infantry + totals.archers + totals.cavalry)));
      remainingLoss -= distributeArmyLoss(army, share);
    });
    syncNationalArmyTotals();
    const relief = state.enemyCampaigns[battleTarget];
    if (relief) {
      const damage = Math.round(dispatchedPower * percent / 100 * (victory ? 0.48 : 0.2));
      relief.power = Math.max(0, relief.power - damage);
      relief.progress = Math.max(0, relief.progress - (victory ? 28 : 8));
      if (relief.power < 160 || relief.progress <= 0) {
        delete state.enemyCampaigns[battleTarget];
        addLog(`王师驰援${province.name}，内外夹击，敌军弃营溃退。此役折损${fmt(totalLoss)}名。`, "war");
        toast(`${province.name}之围已解`, "good");
      } else {
        addLog(`王师驰援${province.name}，杀伤围城军${fmt(damage)}，但敌军尚未退却。`, victory ? "good" : "bad");
        toast(victory ? "援军得势，围城压力下降" : "援军受阻，敌围未解", victory ? "good" : "bad");
      }
    } else if (province.fieldTroops > 0) {
      const enemyLoss = Math.round((victory ? 0.48 + Math.random() * 0.22 : 0.2 + Math.random() * 0.18) * province.fieldTroops);
      province.fieldTroops = Math.max(0, province.fieldTroops - enemyLoss);
      if (province.fieldTroops < 110) province.fieldTroops = 0;
      if (province.fieldTroops === 0) {
        province.siege = { progress: 0, rounds: 0, originalOwner: province.owner };
        addLog(`王师在${province.name}城外击溃敌军，斩获约${fmt(enemyLoss)}，已进抵${province.capital}城下。`, "war");
        toast(`野战告捷，开始围攻${province.capital}`, "good");
      } else {
        addLog(`王师与${province.name}敌军野战，杀伤约${fmt(enemyLoss)}，我军折损${fmt(totalLoss)}，敌军尚能成阵。`, victory ? "good" : "bad");
        toast(victory ? "野战得利，敌军仍未全溃" : "野战受挫，敌军仍据城外", victory ? "good" : "bad");
      }
    } else {
      province.siege ||= { progress: 0, rounds: 0, originalOwner: province.owner };
      province.siege.rounds += 1;
      const ratio = dispatchedPower * percent / 100 / Math.max(enemyDefense(province, targetRegion), 1);
      let gain = tactic === "assault" ? 18 + ratio * 18 : 10 + ratio * 13;
      gain *= victory ? 1 : tactic === "assault" ? 0.35 : 0.65;
      province.siege.progress = clamp(province.siege.progress + gain, 0, 100);
      const garrisonLoss = Math.round((tactic === "assault" ? 0.16 : 0.08) * province.garrison * (victory ? 1.25 : 0.65));
      province.garrison = Math.max(30, province.garrison - garrisonLoss);
      if (tactic === "assault") province.defense = Math.max(12, province.defense - (victory ? 7 : 3));
      addLog(`${tactic === "assault" ? "王师督造云梯冲车，猛攻" : "王师断绝外道，围困"}${province.capital}，攻城进度至${Math.round(province.siege.progress)}%，我军折损${fmt(totalLoss)}。`, victory ? "good" : "bad");
      if (province.siege.progress >= 100) captureProvince(battleTarget);
      else toast(`${province.capital}尚未攻克 · ${Math.round(province.siege.progress)}%`, victory ? "good" : "bad");
    }
    battleTarget = null;
    battleTargetRegionId = null;
    render();
    checkVictory();
    checkDefeat();
    sound(victory ? "good" : "war");
  }

  function captureProvince(id) {
    const province = state.provinces[id];
    const formerOwner = ownerName(province.owner);
    province.owner = "player";
    province.fieldTroops = 0;
    province.garrison = Math.max(100, Math.round((state.infantry + state.archers) * 0.07));
    province.troops = province.garrison;
    province.farms = Math.max(1, province.farms || 1);
    province.barracks = 1;
    province.siege = null;
    province.unrest = 22;
    Object.values(state.regions).filter((region) => region.province === id).forEach((region) => {
      setRegionControl(region, "player");
      region.contested = false;
    });
    activeArmies().filter((army) => army.province === id).forEach((army) => {
      army.status = `镇守${province.capital}`;
      army.supply = Math.max(10, army.supply - 6);
      army.morale = clamp(army.morale + 5, 0, 100);
    });
    state.prestige += 10;
    state.morale = clamp(state.morale + 2, 0, 100);
    selectedProvince = id;
    addLog(`${province.capital}城破，${formerOwner}守军弃械。王师设官安民，${province.name}正式纳入版图。`, "war");
    toast(`攻克州治！${province.name}归附`, "good");
  }

  function applyEffects(effects = {}) {
    Object.entries(effects).forEach(([key, value]) => {
      if (key === "morale") state.morale = clamp(state.morale + value, 0, 100);
      else if (key === "prestige") state.prestige = Math.max(0, state.prestige + value);
      else if (key === "infantry") {
        const army = primarySelectedArmy() || activeArmies()[0] || Object.values(state.armies || {})[0];
        if (army) army.infantry = Math.max(0, (Number(army.infantry) || 0) + value);
        syncNationalArmyTotals();
      }
      else state[key] = Math.max(0, (state[key] || 0) + value);
    });
  }

  function showEvent() {
    pendingEventTimer = 0;
    state.speed = 0;
    restartStrategicClock();
    const eventDialog = ensureModal("eventModal");
    if (!eventDialog) return;
    const event = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    $("eventEmblem").textContent = event.emblem;
    $("eventTitle").textContent = event.title;
    $("eventDescription").textContent = event.description.replaceAll("陛下", playerAddress());
    const choices = $("eventChoices");
    choices.replaceChildren();
    event.choices.forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "event-choice";
      button.disabled = !hasResources(choice.cost || {});
      const label = document.createElement("b");
      const detail = document.createElement("small");
      const result = document.createElement("em");
      label.textContent = choice.label;
      detail.textContent = choice.detail;
      result.textContent = button.disabled ? "钱粮不足" : choice.result;
      button.append(label, detail, result);
      button.addEventListener("click", () => {
        spend(choice.cost || {});
        applyEffects(choice.effects);
        addLog(`${event.title}：${playerAddress()}选择“${choice.label}”。${choice.result.replace(/·/g, "，")}。`, choice.effects.morale < 0 ? "bad" : "good");
        $("eventModal").close();
        unmountClosedModal($("eventModal"));
        sound("tap");
        render();
        checkDefeat();
      });
      choices.appendChild(button);
    });
    eventDialog.showModal();
  }

  function endTurn({ movementAlreadyAdvanced = false } = {}) {
    syncNationalArmyTotals();
    const income = calculateMonthlyBalance();
    state.gold += income.gold;
    state.grain += income.grain;
    state.population += income.population;
    const reports = [`征得赋税 ${fmt(income.gold)} 贯`, `粮仓净入 ${fmt(income.grain)} 粮`, `人口规模增 ${fmt(income.population)} 点`];

    if (state.grain < 0) {
      const shortage = Math.abs(state.grain);
      state.grain = 0;
      state.morale = clamp(state.morale - 8, 0, 100);
      const army = activeArmies().sort((a, b) => a.supply - b.supply)[0];
      const desertion = distributeArmyLoss(army, Math.round(80 + shortage * 0.35));
      if (army) army.morale = clamp(army.morale - 8, 0, 100);
      reports.push(`军粮告罄，逃散步卒 ${fmt(desertion)}`);
      addLog("国中粮草断绝，军民怨声四起，部分士卒离营逃散。", "bad");
    }

    addLog(`本月结算：${reports.join("；")}。`, income.grain >= 0 ? "good" : "bad");
    growEnemies();
    if (!movementAlreadyAdvanced) advanceArmyOrders(DAYS_PER_MONTH - state.calendar.day + 1);
    advanceFrontlineArmies();
    advancePlayerSieges();
    advanceEnemyCampaigns();
    enemyStrategy();
    state.turns += 1;
    state.calendar.month += 1;
    if (state.calendar.month > 12) { state.calendar.month = 1; state.calendar.year += 1; }
    // The explicit month command advances to the first day of the next month;
    // otherwise the HUD can remain on (for example) 12月17日 while monthly
    // resources have already been settled for January.
    state.calendar.day = 1;
    state.season = seasonForMonth(state.calendar.month);
    state.year = Math.max(1, state.calendar.year - 740);
    state.actionPoints = MAX_ACTIONS;
    state.morale = clamp(state.morale - (ownedProvinces().length >= 6 ? 1 : 0), 0, 100);
    sound("tap");
    render();
    if (!checkVictory() && !checkDefeat() && state.turns % 3 === 0) {
      window.clearTimeout(pendingEventTimer);
      pendingEventTimer = window.setTimeout(showEvent, 260);
    }
  }

  function advanceDay() {
    state.calendar.day += 1;
    const mapStateChanged = advanceArmyOrders();
    if (state.calendar.day > DAYS_PER_MONTH) {
      state.calendar.day = 1;
      endTurn({ movementAlreadyAdvanced: true });
    } else if (mapStateChanged) {
      render();
      checkVictory();
    } else {
      renderRealtime();
    }
  }

  function setSpeed(speed) {
    if (state.speed > 0) lastRunningSpeed = state.speed;
    state.speed = clamp(Number(speed) || 0, 0, 4);
    if (state.speed > 0) lastRunningSpeed = state.speed;
    restartStrategicClock();
    render();
  }

  function handleStrategyKeydown(event) {
    if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    const dialog = [...document.querySelectorAll("dialog[open]")].at(-1);
    if (dialog) {
      if (event.key === "Escape") { event.preventDefault(); dialog.close(); }
      return;
    }
    const focus = document.activeElement;
    if (!state.started || focus?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(focus?.tagName)) return;
    if (event.key === "Tab" && !event.shiftKey && (!focus || focus === document.body || focus === document.documentElement)) {
      event.preventDefault();
      toggleAllPanels();
    } else if (event.code === "Space" && !focus?.closest("button, a, [role=button]")) {
      event.preventDefault();
      setSpeed(state.speed === 0 ? lastRunningSpeed : 0);
    } else if (/^[1-4]$/.test(event.key)) {
      event.preventDefault();
      setSpeed(Number(event.key));
    }
  }

  function restartStrategicClock() {
    if (strategicTimer) window.clearInterval(strategicTimer);
    strategicTimer = null;
    if (cloudHydrationPending || !state.started || state.speed === 0) return;
    // All rates use one base game-day duration; the previous hand-tuned
    // table made the 4× button advance about 5.45× as fast as 1×.
    const delay = 1200 / state.speed;
    strategicTimer = window.setInterval(advanceDay, delay);
  }

  function growEnemies() {
    Object.values(state.provinces).forEach((province) => {
      if (province.owner !== "player") {
        if (province.siege) {
          province.troops = province.fieldTroops + province.garrison;
          return;
        }
        const levy = Math.round(12 + province.prosperity * 0.28 + Math.random() * 24);
        province.fieldTroops = Math.min(1400, province.fieldTroops + levy);
        province.garrison = Math.min(900, province.garrison + Math.round(levy * 0.45));
        province.troops = province.fieldTroops + province.garrison;
        if (Math.random() < 0.16) province.defense = clamp(province.defense + 1, 15, 90);
      } else {
        province.garrison = Math.min(700, province.garrison + Math.round(12 + province.prosperity * 0.12));
        province.troops = province.garrison;
        province.unrest = Math.max(0, (province.unrest || 0) - 3);
      }
    });
  }

  function advancePlayerSieges() {
    Object.entries(state.provinces).forEach(([id, province]) => {
      if (!province.siege || province.owner === "player") return;
      province.siege.rounds += 1;
      const assignedArmy = state.armies[province.siege.armyId];
      const besiegingArmy = assignedArmy?.province === id && !assignedArmy.destinationRegion && armySize(assignedArmy) >= 80
        ? assignedArmy
        : activeArmies().find((army) => army.province === id && !army.destinationRegion && armySize(army) >= 80);
      if (!besiegingArmy) {
        province.siege.progress = Math.max(0, province.siege.progress - 12);
        addLog(`${province.capital}城下王师兵力不足，围城圈出现缺口。`, "bad");
        return;
      }
      province.siege.armyId = besiegingArmy.id;
      besiegingArmy.status = `围攻${province.capital}`;
      besiegingArmy.supply = Math.max(0, besiegingArmy.supply - 6);
      const friendlyRelief = province.adjacent
        .map((neighbor) => state.provinces[neighbor])
        .filter((neighbor) => neighbor.owner === province.owner && neighbor.fieldTroops > 240)
        .sort((a, b) => b.fieldTroops - a.fieldTroops)[0];
      if (friendlyRelief && Math.random() < 0.52) {
        const aid = Math.round(friendlyRelief.fieldTroops * 0.24);
        friendlyRelief.fieldTroops -= aid;
        province.fieldTroops += Math.round(aid * 0.65);
        province.garrison += Math.round(aid * 0.35);
        province.siege.progress = Math.max(0, province.siege.progress - 14);
        addLog(`${ownerName(province.owner)}自邻州调集援军${fmt(aid)}人，冒险驰入${province.name}，我军围城受阻。`, "bad");
      } else if (Math.random() < 0.32) {
        const sortie = Math.round(province.garrison * (0.14 + Math.random() * 0.1));
        province.garrison = Math.max(30, province.garrison - Math.round(sortie * 0.42));
        province.siege.progress = Math.max(0, province.siege.progress - Math.round(5 + sortie / 65));
        const playerLoss = distributeArmyLoss(besiegingArmy, Math.round(sortie * 0.28));
        besiegingArmy.morale = clamp(besiegingArmy.morale - 4, 0, 100);
        addLog(`${province.capital}守军夜袭围城营垒，我军折损${fmt(playerLoss)}，攻城进度倒退。`, "bad");
      } else {
        province.garrison = Math.max(30, province.garrison - Math.round(10 + province.garrison * 0.035));
        const pressure = clamp(armyPower(besiegingArmy) / Math.max(enemyDefense(province), 1), 0.35, 2.2);
        province.siege.progress = clamp(province.siege.progress + 4 + pressure * 5, 0, 100);
        addLog(`${province.capital}断粮日久，守军疲惫，围城进度自然推进至${Math.round(province.siege.progress)}%。`, "good");
      }
      if (province.siege.progress >= 100) captureProvince(id);
    });
  }

  function advanceEnemyCampaigns() {
    Object.entries(state.enemyCampaigns).forEach(([id, campaign]) => {
      const province = state.provinces[id];
      if (!province || province.owner !== "player") { delete state.enemyCampaigns[id]; return; }
      const capitalRegion = state.regions[PROVINCE_CAPITAL_REGION[id]];
      if (capitalRegion) capitalRegion.contested = true;
      campaign.rounds += 1;
      const defenders = activeArmies().filter((army) => army.province === id && !army.destinationRegion);
      const fieldDefense = defenders.reduce((sum, army) => sum + armyPower(army), 0);
      const defense = (province.garrison * (1 + province.defense / 130) + fieldDefense) * province.terrainMod;
      const ratio = campaign.power / Math.max(defense, 1);
      const progress = clamp(5 + ratio * 10 + Math.random() * 8, 4, 24);
      campaign.progress += progress;
      province.garrison = Math.max(25, province.garrison - Math.round(12 + campaign.power * 0.025));
      if (defenders.length) {
        const defenderLoss = Math.round(campaign.power * .035 / defenders.length);
        defenders.forEach((army) => {
          distributeArmyLoss(army, defenderLoss);
          army.morale = clamp(army.morale - 2, 0, 100);
          army.status = `守卫${province.capital}`;
        });
      }
      campaign.power = Math.max(80, campaign.power - Math.round(defense * 0.025));
      addLog(`${campaign.factionName}继续围攻${province.capital}，敌方攻城进度至${Math.round(campaign.progress)}%。`, "bad");
      if (campaign.progress >= 100) loseProvince(id, campaign);
    });
  }

  function loseProvince(id, campaign) {
    const province = state.provinces[id];
    province.owner = campaign.owner;
    province.fieldTroops = Math.max(180, Math.round(campaign.power * 0.38));
    province.garrison = Math.max(120, Math.round(campaign.power * 0.2));
    province.troops = province.fieldTroops + province.garrison;
    province.barracks = Math.max(1, province.barracks || 1);
    province.siege = null;
    Object.values(state.regions).filter((region) => region.province === id).forEach((region) => {
      setRegionControl(region, campaign.owner);
      region.contested = false;
      region.garrison = Math.max(region.garrison, Math.round(campaign.power * .08));
    });
    delete state.enemyCampaigns[id];
    state.morale = clamp(state.morale - 8, 0, 100);
    state.prestige = Math.max(0, state.prestige - 6);
    if (selectedProvince === id) selectedProvince = ownedProvinces()[0] || "jingji";
    if (state.regions[selectedRegionId]?.province === id) selectedRegionId = PROVINCE_CAPITAL_REGION[selectedProvince] || "changan";
    addLog(`${province.capital}城破，${province.name}被${campaign.factionName}夺回。守土军民死伤惨重，朝野震动。`, "war");
    toast(`${province.name}失守！`, "bad");
  }

  function enemyStrategy() {
    const enemyIds = Object.keys(state.provinces).filter((id) => state.provinces[id].owner !== "player");
    const exposedPlayer = ownedProvinces().filter((id) => {
      const province = state.provinces[id];
      return !state.enemyCampaigns[id] && province.adjacent.some((neighbor) => state.provinces[neighbor].owner !== "player");
    });
    if (exposedPlayer.length && Math.random() < 0.64) {
      const targetId = exposedPlayer.sort((a, b) => playerProvinceDefense(a) - playerProvinceDefense(b))[0];
      const target = state.provinces[targetId];
      const candidates = target.adjacent
        .map((id) => ({ id, province: state.provinces[id] }))
        .filter(({ province }) => province.owner !== "player" && province.fieldTroops > 280)
        .sort((a, b) => b.province.fieldTroops - a.province.fieldTroops);
      if (candidates.length) {
        const source = candidates[0].province;
        const committed = Math.round(source.fieldTroops * (0.48 + Math.random() * 0.18));
        source.fieldTroops -= committed;
        state.enemyCampaigns[targetId] = {
          owner: source.owner,
          factionName: ownerName(source.owner),
          source: candidates[0].id,
          power: Math.round(committed * (0.95 + Math.random() * 0.2)),
          progress: 0,
          rounds: 0,
        };
        addLog(`${ownerName(source.owner)}集结${fmt(committed)}兵马进犯${target.name}，已抵${target.capital}城下。敌军将按月持续攻城！`, "war");
        return;
      }
    }
    if (enemyIds.length < 2 || Math.random() > 0.38) return;
    const attackerId = enemyIds[Math.floor(Math.random() * enemyIds.length)];
    const attacker = state.provinces[attackerId];
    const possible = attacker.adjacent.filter((id) => {
      const target = state.provinces[id];
      return target.owner !== "player" && target.owner !== attacker.owner;
    });
    if (!possible.length) return;
    const defenderId = possible[Math.floor(Math.random() * possible.length)];
    const defender = state.provinces[defenderId];
    const attackRoll = attacker.fieldTroops * (0.8 + Math.random() * 0.55);
    const defenseRoll = (defender.fieldTroops + defender.garrison) * (0.85 + defender.defense / 260) * (0.8 + Math.random() * 0.45);
    if (attackRoll > defenseRoll) {
      const former = ownerName(defender.owner);
      const attackerOwner = attacker.owner;
      defender.owner = attackerOwner;
      Object.values(state.regions).filter((region) => region.province === defenderId).forEach((region) => {
        setRegionControl(region, attackerOwner);
        region.contested = false;
      });
      defender.siege = null;
      defender.fieldTroops = Math.max(180, Math.round(attacker.fieldTroops * 0.32));
      defender.garrison = Math.max(120, Math.round(attacker.fieldTroops * 0.18));
      defender.troops = defender.fieldTroops + defender.garrison;
      attacker.fieldTroops = Math.max(200, Math.round(attacker.fieldTroops * 0.64));
      addLog(`${ownerName(attacker.owner)}攻破${defender.name}，${former}势力受挫，四海格局再变。`, "war");
    } else {
      attacker.fieldTroops = Math.max(180, Math.round(attacker.fieldTroops * 0.82));
      defender.fieldTroops = Math.max(120, Math.round(defender.fieldTroops * 0.9));
      addLog(`${ownerName(attacker.owner)}进犯${defender.name}，为守军所退，两军各有损伤。`, "normal");
    }
  }

  function playerProvinceDefense(id) {
    const province = state.provinces[id];
    return province.garrison * (1 + province.defense / 130) * province.terrainMod + state.wallLevel * 45;
  }

  function checkVictory() {
    if (ownedProvinces().length < TOTAL_PROVINCES) return false;
    const resultDialog = ensureModal("resultModal");
    if (!resultDialog) return false;
    state.speed = 0;
    restartStrategicClock();
    updateHeader();
    if (resultDialog.open) return true;
    saveState();
    $("resultSeal").textContent = "统";
    $("resultKicker").textContent = "四海归心";
    $("resultTitle").textContent = "诸道一统";
    $("resultText").textContent = `${state.ruler}${playerAddress()}扫平群雄，使海内复归于${state.kingdom}。车同轨，书同文，万民共沐太平。`;
    renderResultStats();
    $("resultRestartButton").textContent = "再开一朝";
    $("resultModal").dataset.result = "victory";
    resultDialog.showModal();
    return true;
  }

  function checkDefeat() {
    if (state.morale > 0 && state.population >= 500 && ownedProvinces().length > 0) return false;
    const resultDialog = ensureModal("resultModal");
    if (!resultDialog) return false;
    state.speed = 0;
    restartStrategicClock();
    updateHeader();
    if (resultDialog.open) return true;
    saveState();
    $("resultSeal").textContent = "殁";
    $("resultKicker").textContent = "天命已改";
    $("resultTitle").textContent = "王业中道";
    $("resultText").textContent = "朝廷根基尽失，百姓离散，群雄乘势而起。此番王业虽败，山河仍待后来之主。";
    renderResultStats();
    $("resultRestartButton").textContent = "重整山河";
    $("resultModal").dataset.result = "defeat";
    resultDialog.showModal();
    return true;
  }

  function renderResultStats() {
    const stats = [
      ["历经", `${state.year} 年`],
      ["疆域", `${ownedProvinces().length} 道`],
      ["威望", fmt(state.prestige)],
    ];
    $("resultStats").replaceChildren();
    stats.forEach(([label, value]) => {
      const node = document.createElement("div");
      const small = document.createElement("small");
      const strong = document.createElement("strong");
      small.textContent = label;
      strong.textContent = value;
      node.append(small, strong);
      $("resultStats").appendChild(node);
    });
  }

  function syncSetupIdentityFields() {
    const characterMode = $("characterMode")?.value === "custom" ? "custom" : "historical";
    const custom = characterMode === "custom";
    const historicalName = $("historicalCharacter")?.value || "玄宗";
    const emperorOpening = !custom && historicalName === "玄宗";
    $("historicalCharacterField")?.classList.toggle("hidden", custom);
    $("customCharacterField")?.classList.toggle("hidden", !custom);
    $("politicalPathFieldset")?.classList.toggle("hidden", emperorOpening);
    $("kingdomField")?.classList.toggle("hidden", !custom);
    $("rulerField")?.classList.toggle("hidden", !custom);
    const summary = $("historicalIdentitySummary");
    summary?.classList.toggle("hidden", custom);
    if (summary) summary.textContent = emperorOpening
      ? "唐玄宗 · 天子：固定唐室与开元二十九年史境；历史开局不选择反叛、自立或另填国号。"
      : `${historicalName} · 唐室将领：历史人物与唐国号固定；选择非忠诚道路将进入架空推演。`;
  }

  function startNewGame() {
    const characterMode = $("characterMode")?.value === "custom" ? "custom" : "historical";
    const selectedHistorical = $("historicalCharacter")?.value || "玄宗";
    const customCharacter = $("customCharacter")?.value.trim().slice(0, 8) || "新主";
    const characterName = characterMode === "custom" ? customCharacter : selectedHistorical;
    const kingdom = characterMode === "custom" ? ($("kingdomInput").value.trim().slice(0, 6) || "大晟") : "大唐";
    const rulerInput = $("rulerInput").value.trim().slice(0, 8);
    const ruler = characterMode === "custom" ? rulerInput || characterName : characterName;
    const doctrine = new FormData($("setupForm")).get("doctrine") || "benevolent";
    const politicalPath = characterMode === "historical" && selectedHistorical === "玄宗"
      ? "loyal" : new FormData($("setupForm")).get("politicalPath") || "loyal";
    state = initialState();
    state.started = true;
    state.kingdom = kingdom;
    state.ruler = ruler;
    state.characterMode = characterMode;
    state.characterName = characterName;
    state.politicalPath = politicalPath;
    // The untouched 741 opening is the historical Tang scenario.  A player
    // who chooses a non-loyal political road or changes the dynasty enters
    // the alternate-history layer; this keeps “大晟” and other invented
    // polities out of the historical starting state.
    state.scenarioType = kingdom === "大唐" && politicalPath === "loyal" && characterMode === "historical"
      ? "historicalScenario"
      : "alternateHistory";
    state.doctrine = doctrine;
    if (doctrine === "benevolent") { state.morale += 10; state.prestige += 5; }
    if (doctrine === "wealth") { state.gold += 250; state.grain += 200; }
    if (doctrine === "military") {
      state.armies.tiger.infantry += 200;
      state.armies.tiger.cavalry += 50;
      syncNationalArmyTotals();
    }
    if (state.scenarioType === "historicalScenario" && characterName === "玄宗") {
      state.logs[0] = {
        type: "normal",
        date: `${ERA.reign} · 岁首`,
        text: "开元二十九年，玄宗在位近三十年。诸道军府权势渐长，朝廷须整饬边政、经营粮道并维持中央号令。",
      };
    } else if (state.scenarioType === "historicalScenario") {
      state.logs[0] = {
        type: "normal",
        date: `${ERA.reign} · 岁首`,
        text: `开元二十九年，玄宗在位。${characterName}奉诏在${PROVINCES[selectedProvince]?.name || "地方"}任事，受命协理军政。`,
      };
    } else {
      const pathText = politicalPath === "rebel" ? "举兵反叛" : politicalPath === "independent" ? "自立门户" : politicalPath === "observer" ? "观望时局" : "另立新局";
      state.logs[0] = {
        type: "war",
        date: `${ERA.reign} · 岁首`,
        text: `架空推演：${characterName}选择${pathText}，以${kingdom}为号；此局势不代表公元741年的真实历史。`,
      };
    }
    selectedProvince = "jingji";
    selectedRegionId = "changan";
    selectedArmyIds = [];
    selectedMapObjectType = "region";
    clearPendingRegionOrder(false);
    ensureModal("setupModal")?.close();
    sound("good");
    render();
    restartStrategicClock();
    window.setTimeout(() => ensureModal("helpModal")?.showModal(), 260);
  }

  function switchView(view) {
    document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    document.querySelectorAll(".view").forEach((node) => node.classList.remove("active"));
    $(`${view}View`).classList.add("active");
    sound("tap");
  }

  // All right-side information now lives in one sidebar.  The region card is
  // moved into that sidebar once at boot so its detail state cannot create a
  // second column or a competing overlay above the map.
  function mountProvinceSidebar() {
    const card = $("provinceCard");
    const rail = document.querySelector(".right-rail");
    const battle = $("battlePlanPanel");
    if (!card || !rail || !battle || card.parentElement === rail) return;
    card.dataset.rightPane = "region";
    rail.insertBefore(card, battle);
    card.hidden = false;
  }

  function setRightSidebarTab(tab = "region") {
    const allowed = new Set(["region", "army", "operation", "war"]);
    activeRightSidebarTab = allowed.has(tab) ? tab : "region";
    const rail = document.querySelector(".right-rail");
    if (!rail) return;
    rail.dataset.activeTab = activeRightSidebarTab;
    rail.querySelectorAll("[data-right-tab]").forEach((button) => {
      const active = button.dataset.rightTab === activeRightSidebarTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    rail.querySelectorAll("[data-right-pane]").forEach((pane) => {
      pane.hidden = pane.dataset.rightPane !== activeRightSidebarTab;
    });
  }

  function persistPanelLayout() {
    try { localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(panelLayoutState)); } catch { /* optional preference */ }
  }

  function notifyPanelResize() {
    // The map owns a ResizeObserver, but dispatching resize after the short
    // slide keeps canvas sizing and geographic hit-testing correct throughout
    // the transition as well as at its final position.
    window.dispatchEvent(new Event("resize"));
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), 260);
  }

  // Keep the grid contract deterministic at every desktop breakpoint.  The
  // stylesheet owns the visual rail transitions, but a few responsive rules
  // can otherwise win the cascade while a rail is collapsed (leaving the
  // hidden 370px column allocated to the map).  Writing the three track sizes
  // inline makes the actual layout width match the visible rails immediately.
  function syncPanelGrid() {
    const shell = document.querySelector(".game-shell");
    if (!shell) return;
    // The setup flow owns a single full-width shell. Never inject the
    // three-track gameplay grid while NewGameFlow is visible.
    if (window.innerWidth <= 940 || document.body.classList.contains("pre-game")) {
      shell.style.removeProperty("grid-template-columns");
      delete shell.dataset.panelGridTracks;
      return;
    }
    const { leftCollapsed, rightCollapsed, allCollapsed } = panelLayoutState;
    const left = leftCollapsed || allCollapsed;
    const right = rightCollapsed || allCollapsed;
    const tracks = left && right
      ? "40px minmax(0, 1fr) 40px"
      : left
        ? "40px minmax(0, 1fr) 370px"
        : right
          ? "142px minmax(0, 1fr) 40px"
          : "142px minmax(0, 1fr) 370px";
    // ResizeObserver and the synthetic resize event can fire several times
    // during one rail transition.  Do not rewrite the same declaration: a
    // redundant write restarts the 240ms grid transition indefinitely and
    // leaves getComputedStyle stuck at the old column widths.
    if (shell.dataset.panelGridTracks === tracks) return;
    shell.dataset.panelGridTracks = tracks;
    shell.style.setProperty("grid-template-columns", tracks, "important");
  }

  function applyPanelLayout({ persist = true } = {}) {
    const { leftCollapsed, rightCollapsed, allCollapsed } = panelLayoutState;
    document.body.classList.toggle("panels-left-collapsed", Boolean(leftCollapsed));
    document.body.classList.toggle("panels-right-collapsed", Boolean(rightCollapsed));
    document.body.classList.toggle("panels-all-collapsed", Boolean(allCollapsed));
    const leftButton = $("toggleLeftPanel");
    const rightButton = $("toggleRightPanel");
    const allButton = $("toggleAllPanels");
    if (leftButton) {
      leftButton.setAttribute("aria-pressed", String(leftCollapsed));
      leftButton.setAttribute("aria-label", leftCollapsed ? "展开左侧面板" : "收起左侧面板");
      leftButton.title = leftCollapsed ? "展开左侧面板" : "收起左侧面板";
      leftButton.querySelector("span").textContent = leftCollapsed ? "›" : "‹";
      leftButton.querySelector("b").textContent = leftCollapsed ? "展开" : "收起";
    }
    if (rightButton) {
      rightButton.setAttribute("aria-pressed", String(rightCollapsed));
      rightButton.setAttribute("aria-label", rightCollapsed ? "展开右侧面板" : "收起右侧面板");
      rightButton.title = rightCollapsed ? "展开右侧面板" : "收起右侧面板";
      rightButton.querySelector("span").textContent = rightCollapsed ? "‹" : "›";
      rightButton.querySelector("b").textContent = rightCollapsed ? "展开" : "收起";
    }
    if (allButton) {
      allButton.setAttribute("aria-pressed", String(allCollapsed));
      allButton.setAttribute("aria-label", allCollapsed ? "显示全部面板" : "隐藏全部面板");
      allButton.title = allCollapsed ? "显示全部面板" : "隐藏全部面板";
      allButton.textContent = allCollapsed ? "◧" : "◫";
    }
    syncPanelGrid();
    if (persist) persistPanelLayout();
    notifyPanelResize();
  }

  function loadPanelLayout() {
    try {
      const saved = JSON.parse(localStorage.getItem(PANEL_STATE_KEY) || "null");
      if (saved && typeof saved === "object") {
        panelLayoutState = {
          leftCollapsed: Boolean(saved.leftCollapsed),
          rightCollapsed: Boolean(saved.rightCollapsed),
          allCollapsed: Boolean(saved.allCollapsed),
          beforeAll: saved.beforeAll && typeof saved.beforeAll === "object"
            ? { leftCollapsed: Boolean(saved.beforeAll.leftCollapsed), rightCollapsed: Boolean(saved.beforeAll.rightCollapsed) }
            : null,
        };
      }
    } catch { /* malformed preference is ignored */ }
    applyPanelLayout({ persist: false });
  }

  function setRightPanelCollapsed(collapsed, { persist = true } = {}) {
    panelLayoutState.rightCollapsed = Boolean(collapsed);
    if (!collapsed) panelLayoutState.allCollapsed = false;
    applyPanelLayout({ persist });
  }

  function restorePanelLayoutBeforeAll() {
    if (!panelLayoutState.allCollapsed) return;
    const restore = panelLayoutState.beforeAll || { leftCollapsed: false, rightCollapsed: false };
    panelLayoutState.leftCollapsed = Boolean(restore.leftCollapsed);
    panelLayoutState.rightCollapsed = Boolean(restore.rightCollapsed);
    panelLayoutState.allCollapsed = false;
    panelLayoutState.beforeAll = null;
  }

  function toggleAllPanels() {
    if (panelLayoutState.allCollapsed) {
      restorePanelLayoutBeforeAll();
    } else {
      panelLayoutState.beforeAll = {
        leftCollapsed: Boolean(panelLayoutState.leftCollapsed),
        rightCollapsed: Boolean(panelLayoutState.rightCollapsed),
      };
      panelLayoutState.leftCollapsed = true;
      panelLayoutState.rightCollapsed = true;
      panelLayoutState.allCollapsed = true;
    }
    applyPanelLayout();
  }

  function showMapTooltip(event, id) {
    if (window.TianxiaMap?.isInteracting) return hideMapTooltip();
    const province = state.provinces[id];
    const tooltip = $("mapTooltip");
    const relation = province.owner === "player" ? "我方直辖" : FACTIONS[province.owner]?.relation || "中立";
    const totalProsperity = Object.values(state.provinces).reduce((sum, item) => sum + item.prosperity, 0);
    const contentKey = ["province", id, province.owner, province.prosperity, province.farms, province.fieldTroops, province.garrison, province.defense, state.population].join("|");
    if (tooltip.dataset.contentKey !== contentKey) {
      tooltip.dataset.contentKey = contentKey;
      tooltip.innerHTML = safeHtml`<b>${province.name} · ${province.capital}</b>${ownerName(province.owner)}（${relation}）<br>人口规模 ${fmt(Math.round(state.population * province.prosperity / Math.max(1, totalProsperity)))}点 · 粮产 ${fmt((province.farms || 1) * 80 + province.prosperity)}<br>驻军 ${fmt((province.fieldTroops || 0) + (province.garrison || 0))} · 城防 ${fmt(province.defense)} · ${province.terrain}`;
    }
    tooltip.classList.remove("hidden");
    queueTooltipPosition(event);
  }

  function showRegionTooltip(event, id) {
    if (window.TianxiaMap?.isInteracting) return hideMapTooltip();
    const region = state.regions[id];
    if (!region) return hideMapTooltip();
    const tooltip = $("mapTooltip");
    const contentKey = ["region", id, state.calendar.year, state.ruler, state.kingdom, regionController(region), region.population, region.grain, region.garrison, region.defense, region.fort].join("|");
    if (tooltip.dataset.contentKey !== contentKey) {
      tooltip.dataset.contentKey = contentKey;
      tooltip.innerHTML = safeHtml`<b>${regionDisplayName(region, state.calendar.year)}</b><span>所属道 · ${PROVINCES[region.province].name}</span><span>州府 · ${region.admin}</span><span>控制者 · ${regionOwnerName(region)}</span><span>地形 · ${region.terrain} · ${REGION_DATA.typeNames[region.type]}</span><strong>驻军 ${fmt(region.garrison)} · 城防 ${fmt(region.defense + region.fort * 8)}</strong>`;
    }
    tooltip.classList.remove("hidden");
    queueTooltipPosition(event);
  }

  function queueTooltipPosition(event) {
    pendingTooltipPosition = { x: event.clientX, y: event.clientY };
    if (tooltipFrame) return;
    tooltipFrame = window.requestAnimationFrame(() => {
      tooltipFrame = 0;
      if (!pendingTooltipPosition) return;
      const x = Math.min(window.innerWidth - 225, pendingTooltipPosition.x + 15);
      const y = Math.min(window.innerHeight - 110, pendingTooltipPosition.y + 15);
      $("mapTooltip").style.transform = `translate3d(${x}px, ${y}px, 0)`;
    });
  }

  function hideMapTooltip() { $("mapTooltip").classList.add("hidden"); }

  function bindTerritoryEvents() {
    if (territoryEventsBound) return;
    const layer = $("territoryLayer");
    if (!layer) return;
    territoryEventsBound = true;
    const cellFromEvent = (event) => {
      // Always prefer canonical WGS84 hit-testing.  SVG paint order is not a
      // valid geography rule when modern source unions overlap at a seam (the
      // Chang'an/Wuguan/Huaili cluster is one such case).  TianxiaMap resolves
      // overlaps using the historical anchor and geometry area, while the
      // direct element remains a keyboard/fallback path for synthetic events.
      const canonicalCell = window.TianxiaMap?.regionAtClientPoint?.(event.clientX, event.clientY);
      if (canonicalCell) return canonicalCell;
      return event.target?.closest?.("[data-region-cell]") || null;
    };
    const clearHover = () => {
      pendingHoverPoint = null;
      if (hoveredRegionId) document.querySelector(`[data-region-cell="${hoveredRegionId}"]`)?.classList.remove("hover-region-cell");
      hoveredRegionId = null;
      hideMapTooltip();
    };
    const resolveHover = () => {
      hoverFrame = 0;
      const point = pendingHoverPoint;
      pendingHoverPoint = null;
      if (!point || window.TianxiaMap?.isInteracting) return clearHover();
      const event = { clientX: point.x, clientY: point.y };
      const cell = cellFromEvent(event);
      if (!cell) return clearHover();
      const id = cell.dataset.regionCell;
      if (id !== hoveredRegionId) {
        if (hoveredRegionId) document.querySelector(`[data-region-cell="${hoveredRegionId}"]`)?.classList.remove("hover-region-cell");
        hoveredRegionId = id;
        cell.classList.add("hover-region-cell");
      }
      showRegionTooltip(event, id);
    };
    const queueHover = (event) => {
      pendingHoverPoint = { x: event.clientX, y: event.clientY };
      if (!hoverFrame) hoverFrame = window.requestAnimationFrame(resolveHover);
    };
    const selectPointerRegion = (cell, id) => {
      if (!cell || !id) return;
      if (window.TianxiaMap?.isInteracting) {
        window.requestAnimationFrame(() => {
          if (cell.isConnected && !window.TianxiaMap?.isInteracting) selectStrategicRegion(id, "region");
        });
        return;
      }
      selectStrategicRegion(id, "region");
    };
    layer.addEventListener("pointerdown", (event) => {
      const cell = cellFromEvent(event);
      territoryPointer = cell ? { id: cell.dataset.regionCell, x: event.clientX, y: event.clientY, dragged: false } : null;
    });
    layer.addEventListener("pointermove", (event) => {
      if (territoryPointer) {
        territoryPointer.dragged = territoryPointer.dragged || Math.hypot(event.clientX - territoryPointer.x, event.clientY - territoryPointer.y) > 6;
      }
      queueHover(event);
    });
    layer.addEventListener("pointerup", (event) => {
      const cell = cellFromEvent(event);
      const pointer = territoryPointer;
      territoryPointer = null;
      if (!pointer || pointer.dragged) return;
      // SVG path bounding boxes are not reliable click centers after a zoom
      // transform. Keep the region captured on pointerdown, so a click that
      // ends on an adjacent path still selects the polygon the user pressed.
      const pressedCell = document.querySelector(`[data-region-cell="${pointer.id}"]`);
      if (!pressedCell) return;
      selectPointerRegion(pressedCell, pointer.id);
    });
    layer.addEventListener("pointercancel", () => { territoryPointer = null; });
    layer.addEventListener("pointerleave", clearHover);
    layer.addEventListener("click", (event) => {
      const cell = cellFromEvent(event);
      if (!cell || event.detail !== 0) return;
      selectStrategicRegion(cell.dataset.regionCell, "region");
    });
    layer.addEventListener("dblclick", (event) => {
      const cell = cellFromEvent(event);
      if (!cell) return;
      event.preventDefault();
      event.stopPropagation();
      const id = cell.dataset.regionCell;
      selectStrategicRegion(id, "region");
      window.TianxiaMap?.doubleClickRegion?.(id);
    });
    layer.addEventListener("keydown", (event) => {
      const cell = cellFromEvent(event);
      if (!cell || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      selectStrategicRegion(cell.dataset.regionCell, "region");
    });
  }

  function bindEvents() {
    mountProvinceSidebar();
    try {
      const savedTab = localStorage.getItem("guoyun-right-sidebar-tab-v1");
      if (savedTab) activeRightSidebarTab = savedTab;
    } catch { /* optional UI preference */ }
    setRightSidebarTab(activeRightSidebarTab);
    loadPanelLayout();
    window.addEventListener("resize", syncPanelGrid, { passive: true });
    $("toggleLeftPanel")?.addEventListener("click", () => {
      restorePanelLayoutBeforeAll();
      panelLayoutState.leftCollapsed = !panelLayoutState.leftCollapsed;
      applyPanelLayout();
    });
    $("toggleRightPanel")?.addEventListener("click", () => {
      restorePanelLayoutBeforeAll();
      panelLayoutState.rightCollapsed = !panelLayoutState.rightCollapsed;
      applyPanelLayout();
    });
    $("toggleAllPanels")?.addEventListener("click", toggleAllPanels);
    document.querySelectorAll("[data-right-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        setRightSidebarTab(button.dataset.rightTab);
        try { localStorage.setItem("guoyun-right-sidebar-tab-v1", activeRightSidebarTab); } catch { /* optional */ }
      });
    });
    document.addEventListener("keydown", handleStrategyKeydown);
    $("characterMode")?.addEventListener("change", syncSetupIdentityFields);
    $("historicalCharacter")?.addEventListener("change", syncSetupIdentityFields);
    syncSetupIdentityFields();
    document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
    bindTerritoryEvents();
    $("attackButton").addEventListener("click", () => {
      if (selectedArmyIds.length) {
        if (!prepareRegionOrder(selectedRegionId)) return toast("该地区不与军团驻地直接相邻", "bad");
        renderMap();
        return;
      }
      const army = activeArmies().find((item) => !item.order);
      if (!army) return toast("目前没有可调动的军团", "bad");
      selectArmy(army.id);
      toast(`已选择${armyDisplayName(army)}，请在地图上点击相邻目标地区`, "good");
    });
    $("confirmRegionOrder").addEventListener("click", () => {
      const targetId = pendingOrderTargetId;
      if (targetId) issueRegionOrder(targetId, { coordinationMode: pendingAttackPlan?.coordinationMode });
    });
    $("retreatRegionOrder")?.addEventListener("click", () => {
      const targetId = pendingOrderTargetId;
      if (targetId) issueRegionOrder(targetId, { type: "RETREAT", noCharge: true });
    });
    document.querySelectorAll("[data-coordination-mode]").forEach((button) => button.addEventListener("click", () => {
      if (!pendingAttackPlan || pendingAttackPlan.armyIds.length < 2) return;
      pendingAttackPlan.coordinationMode = button.dataset.coordinationMode;
      renderBattlePlanPanel();
    }));
    $("viewRegionTarget").addEventListener("click", () => {
      clearPendingRegionOrder();
      setRightSidebarTab("region");
    });
    $("cancelRegionOrder").addEventListener("click", () => clearPendingRegionOrder());
    document.querySelectorAll("[data-recruit]").forEach((button) => button.addEventListener("click", () => performRecruit(button.dataset.recruit)));
    $("createArmyButton")?.addEventListener("click", createNewArmy);
    document.querySelectorAll("[data-order]").forEach((button) => button.addEventListener("click", () => performMilitaryOrder(button.dataset.order)));
    document.querySelectorAll("[data-speed]").forEach((button) => button.addEventListener("click", () => {
      const requested = Number(button.dataset.speed);
      setSpeed(button.id === "pauseButton" && state.speed === 0 ? lastRunningSpeed : requested);
    }));
    document.querySelectorAll("[data-map-mode]").forEach((button) => button.addEventListener("click", () => {
      state.mapMode = button.dataset.mapMode;
      renderMap();
      saveState();
    }));
    document.querySelectorAll("[data-close-drawer]").forEach((button) => button.addEventListener("click", () => switchView("map")));
    $("cancelArmySelection").addEventListener("click", () => {
      selectedArmyIds = [];
      syncSelectedArmySelection();
      selectedMapObjectType = "region";
      clearPendingRegionOrder();
      $("orderHint").classList.add("hidden");
      renderMap();
      renderProvinceCard();
      renderArmyCommand();
    });
    $("selectAllArmies")?.addEventListener("click", () => {
      selectedArmyIds = activeArmies().map((army) => army.id);
      syncSelectedArmySelection();
      clearPendingRegionOrder(false);
      selectedMapObjectType = selectedArmyIds.length ? "army" : "region";
      renderMap();
      renderArmyCommand();
    });
    $("clearArmyGroup")?.addEventListener("click", () => $("cancelArmySelection").click());
    $("stopArmyOrders")?.addEventListener("click", () => {
      const ids = selectedArmyIds.slice();
      ids.forEach((id) => stopArmyOrder(id));
      renderMap();
      renderArmyCommand();
    });
    document.querySelectorAll("[data-policy]").forEach((button) => button.addEventListener("click", () => {
      const policy = button.dataset.policy;
      if (state.policies[policy]) return toast("此项制度已经施行", "good");
      if (policy === "restore") return;
      if (state.prestige < 15) return toast("威望不足 15，无法推行", "bad");
      state.prestige -= 15;
      state.policies[policy] = true;
      if (policy === "benevolence") state.morale = clamp(state.morale + 8, 0, 100);
      else { state.drill += .1; activeArmies().forEach((army) => { army.morale = clamp(army.morale + 5, 0, 100); }); }
      button.classList.add("unlocked");
      addLog(`朝廷确立“${button.querySelector("b").textContent}”制度，国策由此转向。`, "good");
      render();
    }));
    $("endTurnButton").addEventListener("click", endTurn);
    $("cloudButton").addEventListener("click", openCloudModal);
    window.addEventListener("tianxia-cloud-status", (event) => updateCloudStatus(event.detail));
    window.addEventListener("online", () => {
      if (cloudSaveReady && window.TianxiaCloudSave?.isDirty()) scheduleCloudSave(false);
    }, { passive: true });
    $("helpButton").addEventListener("click", () => ensureModal("helpModal")?.showModal());
    $("soundButton").addEventListener("click", () => { state.sound = !state.sound; render(); if (state.sound) sound("tap"); });
    $("clearLogButton").addEventListener("click", () => {
      state.logs = state.logs.slice(0, 4);
      addLog("史官整理旧卷，近来要事仍录于册。", "normal");
      render();
    });
    $("resetButton").addEventListener("click", () => {
      if (!window.confirm("确定放弃当前王业，重新开创一朝吗？")) return;
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(MAP_V4_SAVE_KEY);
      localStorage.removeItem(OLD_SAVE_KEY);
      localStorage.removeItem(LEGACY_SAVE_KEY);
      window.TianxiaCloudSave?.markDirty();
      window.location.reload();
    });
    MODAL_IDS.forEach((id) => bindMountedModal($(id)));
  }

  function bindModalLifecycle() {
    MODAL_IDS.forEach((id) => {
      const dialog = $(id);
      bindModalLifecycleFor(dialog);
      bindMountedModal(dialog);
    });
  }

  async function prepareForUpdate() {
    // Keep the current local snapshot first, then require a successful D1
    // write before a PWA update can reload the page.
    if (state.speed !== 0) setSpeed(0);
    saveState();
    if (!window.TianxiaCloudSave) return true;
    if (!cloudSaveReady) {
      toast("云端尚未就绪，请稍后再更新", "bad");
      return false;
    }
    try {
      await window.TianxiaCloudSave.save(state);
      return true;
    } catch {
      toast("云端同步失败，暂不重启页面；本地缓存仍在", "bad");
      return false;
    }
  }

  window.TianxiaGameDiagnostics = {
    snapshot() {
      return {
        ...renderDiagnostics,
        strategicNodeCount: strategicRegionNodes.size,
        routeNodeCount: $("routeLayer")?.childElementCount || 0,
        armyNodeCount: $("armyLayer")?.childElementCount || 0,
        worldLayerConnected: Boolean($("mapWorld")?.isConnected),
        uiLayerConnected: Boolean($("mapUi")?.isConnected),
        selectedRegionId,
        selectedArmyIds: selectedArmyIds.slice(),
        attackPlanCount: Object.keys(state.attackPlans || {}).length,
        inProgressOrders: activeArmies().filter((army) => army.order).map((army) => ({ id: army.id, targetRegionId: army.order.targetRegionId, route: [...(army.order.route || [])], etaDays: army.order.etaDays, movementProgress: army.order.movementProgress, battleState: army.battleState })),
        selectedMapObjectType,
        pendingOrderTargetId,
        performanceMode: PERFORMANCE_MODE,
      };
    },
  };

  window.TianxiaGame = {
    // Region metadata includes nameAtYear functions; return the same serializable
    // snapshot used by saves, rather than throwing DataCloneError during QA.
    getState: () => JSON.parse(JSON.stringify(state)),
    prepareForUpdate,
    version: VERSION,
  };

  window.addEventListener("tianxia-map-ready", () => renderMap(), { once: true });
  window.addEventListener("tianxia-map-interaction-end", () => {
    // Zoom/pan already updated the persistent map and screen-space layer in
    // geo-map.js. Do not run a full game render after every gesture; selection
    // and orders are handled by their own click handlers.
    hideMapTooltip();
    // Refresh high-zoom viewport culling only after the gesture ends. This
    // keeps wheel/pointermove work on the persistent map transform path.
    renderStrategicRegions();
    renderArmyLayer();
    renderWarLayer();
  });
  window.addEventListener("tianxia-map-lod-change", () => {
    // LOD changes are threshold events, not per-wheel renders.  Only the
    // dynamic marker/war layers need to reconsider their visible aggregate.
    renderArmyLayer();
    renderWarLayer();
  });
  window.addEventListener("tianxia-map-error", () => toast("地理图层加载失败，请检查网络或刷新页面", "bad"), { once: true });
  // Cache modal templates before the first render can unmount setupModal for
  // an existing save.  A later "重整山河" must be able to mount a fresh
  // NewGameFlow instead of leaving the pre-game shell blank.
  cacheModalTemplates();
  bindModalLifecycle();
  bindEvents();
  if (PERFORMANCE_MODE) state.speed = 0;
  render();
  updateCloudStatus();
  if (PERFORMANCE_MODE) {
    updateCloudStatus({ state: "offline", message: "性能模式：已停用云端与游戏时钟" });
  } else {
    // Hydrate a running local campaign before its first automatic day tick.
    initializeCloudSave().catch(() => {
      updateCloudStatus({ state: "offline", message: "云端暂不可用，使用本地缓存" });
    }).finally(() => {
      cloudHydrationPending = false;
      restartStrategicClock();
      updateHeader();
      setCloudControlsBusy(false);
    });
    syncStartGate();
  }
})();
