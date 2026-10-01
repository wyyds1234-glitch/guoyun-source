(() => {
  "use strict";

  // The active scenario is deliberately kept in one small, versioned config so
  // the calendar, map chrome, help text and migration code cannot drift apart.
  // The current Tang scenario uses openly licensed modern administrative
  // polygons as an explicitly labelled geographic gameplay proxy. Historical
  // political control is stored separately in the game state.
  window.TIANXIA_ERA = Object.freeze({
    id: "tang",
    label: "唐代",
    year: 741,
    reign: "开元二十九年",
    administration: "开元十五道 · 州府县",
    daoIds: ["jingji", "guannei", "duji", "henan", "hedong", "hebei", "longyou", "shannan_east", "shannan_west", "jiannan", "huainan", "jiangnan_east", "jiangnan_west", "qianzhong", "lingnan"],
    capital: "长安",
    mapTitle: "天下舆图",
    mapSubtitle: "唐 · 十五道 · 军镇关隘",
    geography: {
      source: "Natural Earth",
      license: "Public Domain",
      role: "physical-only",
    },
    geometryStatus: "modern-geography-tang-metadata-v2",
    mapVersion: "tang741-v2",
    historyDataVersion: "tang-history-v1",
    mapModelVersion: "tang-map-model-v2",
    frontierSystems: ["frontier_region", "protectorate_region", "military_command"],
  });
})();
