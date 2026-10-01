(() => {
  "use strict";

  // Keep release, save, and map compatibility independent.  The service
  // worker uses APP_VERSION while game saves use SAVE_SCHEMA_VERSION.
  window.TIANXIA_VERSION = Object.freeze({
    APP_VERSION: "0.4.19",
    SAVE_SCHEMA_VERSION: 5,
    MAP_VERSION: "tang741-v2",
    HISTORY_DATA_VERSION: "tang-history-v1",
    MAP_MODEL_VERSION: "tang-map-model-v2",
  });
})();
