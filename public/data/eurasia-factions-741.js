/* 741 historical context. Label anchors are WGS84 [longitude, latitude],
 * NOT borders. Previous hand-authored bounding rings have been removed.
 * No foreign boundary is published until source, year and license are verified.
 * Regional anchors without a source are explicitly approximate placements.
 * Sources below support site positions only, never empire territorial claims. */
window.EURASIA_FACTIONS_741 = [
  { id: "tubo", name: "吐蕃", kind: "高原政权", color: "#806055", labelAnchor: [91.118418, 29.655485], anchorSource: "https://whc.unesco.org/en/list/707/maps" },
  { id: "nanzhao", name: "南诏", kind: "地方王国", color: "#55746d", labelAnchor: [100.15, 25.60] },
  { id: "khitan", name: "契丹诸部", kind: "草原部族", color: "#806a52", labelAnchor: [119, 43.5] },
  { id: "xi", name: "奚", kind: "部族", color: "#71634d", labelAnchor: [117.5, 42], labelDetail: true, labelPriority: 90 },
  { id: "bohai", name: "渤海", kind: "王国", color: "#4f6e68", labelAnchor: [128.3, 43.4] },
  { id: "silla", name: "新罗", kind: "王国", color: "#68734f", labelAnchor: [129.2, 35.85] },
  { id: "japan", name: "日本", kind: "列岛政权", color: "#6d5d66", labelAnchor: [135.8, 34.68], anchorSource: "https://whc.unesco.org/en/list/870" },
  // These are Tang military/administrative commands, not independent polities.
  // Their names remain in the frontier metadata, not the foreign-faction layer.
  { id: "hexi", name: "河西军镇", kind: "唐军镇", color: "#876b4f", labelAnchor: [102.6, 37.9], displayOnMap: false },
  { id: "anxi", name: "安西都护府", kind: "唐都护府", color: "#80654d", labelAnchor: [82.95, 41.73], displayOnMap: false },
  { id: "beiting", name: "北庭都护府", kind: "唐都护府", color: "#80654d", labelAnchor: [89.2075, 44.096944], displayOnMap: false, anchorSource: "https://whc.unesco.org/en/list/1442/maps" },
  { id: "turgesh", name: "突骑施汗国", kind: "汗国", color: "#84734f", labelAnchor: [75.203333, 42.801944], anchorSource: "https://whc.unesco.org/en/list/1442/maps" },
  { id: "shiguo", name: "石国", kind: "中亚城邦", color: "#6d7052", labelAnchor: [69.28, 41.3], labelDetail: true },
  { id: "kangguo", name: "康国", kind: "中亚城邦", color: "#6d7052", labelAnchor: [66.97, 39.65], labelDetail: true },
  { id: "kucha", name: "龟兹", kind: "唐属西域治所", color: "#806b4f", labelAnchor: [82.95, 41.73], displayOnMap: false },
  { id: "khotan", name: "于阗", kind: "唐属西域治所", color: "#806b4f", labelAnchor: [79.93, 37.1], displayOnMap: false },
  { id: "kamarupa", name: "迦摩缕波", kind: "印度王国", color: "#78614e", labelAnchor: [91.7, 26.2], labelDetail: true },
  { id: "rajput", name: "拉其普特诸国", kind: "未核定的旧概括条目", color: "#75614e", displayOnMap: false },
  { id: "umayyad", name: "倭马亚哈里发国", kind: "哈里发国", color: "#6b6254", labelAnchor: [42, 32] },
  { id: "byzantine", name: "东罗马帝国", kind: "罗马帝国（东部）", color: "#596c72", labelAnchor: [30, 40] },
  { id: "khazar", name: "可萨汗国", kind: "汗国", color: "#66704f", labelAnchor: [47, 46] },
].map((item) => ({ ...item, boundaryStatus: "unverified", geometry: null,
  anchorAccuracy: item.anchorSource ? "referenced-site" : "approximate-regional" }));
