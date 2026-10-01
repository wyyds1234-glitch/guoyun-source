# 地图数据来源与处理说明

## 可发布的地理底图

- `natural-earth-land-110m.geojson` / `natural-earth-land-50m.geojson` / `natural-earth-land-10m.geojson`：Natural Earth 公共领域陆地几何的离线 110m、50m、10m LOD；浏览器启动时一次性加载，缩放只切换已绘制图层。
- `natural-earth-rivers.geojson`：Natural Earth 1:10m Rivers + Lake Centerlines，Public Domain；保留当前东亚—中亚战略层的主要水系。
- `natural-earth-lakes.geojson`：Natural Earth 1:50m Lakes，Public Domain；保留当前东亚—中亚战略层的主要湖泊。
- `natural-earth-terrain.geojson`：Natural Earth 1:50m Geographic Regions，Public Domain；作为东亚—中亚战略层的山地、盆地、高原和平原参考。
- `strategy-regions.geojson`：版本化的战略区 GeoJSON；100 个 Feature 都有稳定 `region_id` 与 MultiPolygon geometry。每个战略区由 geoBoundaries 中国县级真实 polygon 按共享边界聚合而成，浏览器直接将其作为交互 hitbox 加载；它是唐代剧本的现代行政区代理，不冒充唐代史实边界。
- `strategy-provinces.geojson`：由上述战略区 polygon 组成的顶层开元十五道 MultiPolygon overlay；只表达场景分组，不携带玩家控制状态。
- `strategy-adjacency.json` / `strategy-adjacency.js`：由已提交战略区 polygon 的共享边界段离线生成的邻接缓存；每条边保留 `type`、`sharedBoundaryKm`、`distanceKm`、地形与通行方式，浏览器不使用质心距离猜测接壤关系。
- `tang-map-model.json` / `tang-map-model.js`：唐开元 741 年的独立历史/游戏模型。它把 100 个稳定 `region_id` 与现代 GeoJSON 的 `geometryId` 连接起来，并保存开元十五道数量、`nameHistory`、城市、关隘、边疆军镇和控制状态字段；它不复制几何，也不把现代行政名称作为玩家显示内容。

Natural Earth：<https://www.naturalearthdata.com/downloads/>

## 现代地理填充规则

唐代剧本允许使用现代世界地理资料补足物理地理层。当前实现使用 Natural Earth 公共领域数据绘制海岸线、河流、湖泊、山地、盆地和高原；这些资料只描述自然地理，不提供也不推导现代国界。唐代的道、府州、战略区、势力颜色、战争前线和控制权始终来自独立的历史/游戏 vector overlay，因此现代底图不会把现代国家边界带入唐代政治层。

## 历史行政与地名校核（公开免费资源政策）

本项目只接受可以公开访问、明确允许再分发的历史数据。付费数据库、仅限学术使用的瓦片、没有再分发条款的扫描地图，都不能进入 `public/data/`，也不能作为生产 polygon 的隐含来源。

- **OpenHistoricalMap（OHM）**：项目声明数据致力于公共领域，并提供可按时间筛选的行政边界矢量数据；可作为后续历史 polygon 的首选候选来源。OHM 中国项目页面目前公开列出的完整中国历史边界主要是清代，东汉末年州郡尚未形成完整覆盖。我们对 189 CE 时间窗口的行政关系做过只读审计，结果不足以覆盖本项目所需的 80–100 个战略区，因此当前没有把它拼接成一张“看似完整”的假地图。
- **Cliopatria（Seshat Global History Databank）**：公开 GeoJSON 使用 EPSG:4326，按 `FromYear`/`ToYear` 提供全球政权 polygon，数据许可为 CC BY 4.0，可作为外围政权和汉帝国宏观疆域 overlay。对 189 CE 的只读筛选得到 Han Dynasty、鲜卑、高句丽、乌孙、马韩、辰韩、弁韩等记录；这些是宏观政治范围，不是汉帝国内部州郡边界，因此不能直接替换 `strategy-regions.geojson`。后续若加入，应单独存为 `historical-polities-189.geojson`，保留原始名称、年份、Wikidata/Seshat ID 和署名信息，并以虚线/半透明 frontier 表现不确定边界。来源：<https://github.com/Seshat-Global-History-Databank/cliopatria>，许可：<https://creativecommons.org/licenses/by/4.0/>。
- **国家地球系统科学数据中心·东汉时期行政区划基础数据（公元 140 年）**：公开目录描述为 WGS84 的州、郡/国、县三级数据，来源机构为南京师范大学地理科学学院；它是目前最接近本项目“内部历史 polygon”需求的候选。但数据年份是 140 CE 而不是 189 CE，而且平台使用声明要求标注来源并写明“未经书面许可不得复制、修改、抄录、传播及销售”。因此它不是本项目允许的开放再分发来源：当前只保留检索记录，不能下载进仓库或进入生产门禁。来源：<https://www.geodata.cn/data/datadetails.html?dataguid=109230036661066&docId=20297>；平台使用条款示例：<https://gre.geodata.cn/data/datadetails.html?dataguid=39099061696594&docId=188>。
- **Wikimedia Commons《东汉建安时期州郡地图》**：作者自绘，CC BY-SA 4.0，附带 SVG 矢量版本；可用于名称、州郡相对位置和历史拼接的人工校核，但它是制图作品而非带 WGS84 坐标的行政数据库，不能把 SVG 轮廓直接冒充地理 polygon。来源：<https://commons.wikimedia.org/wiki/File:Jian%27an_Commanderies.png>。
- **Wikimedia Commons《Map of the Han dynasty.svg》**：作者自绘，CC0；同样只是非地理参考图，适合核对古名和宏观疆域，不作为交互行政 geometry。来源：<https://commons.wikimedia.org/wiki/File:Map_of_the_Han_dynasty.svg>。
- **Wikimedia Commons《Qin dynasty territory.svg》**：作者自绘，CC0，标明使用 Albers 投影并参考 Natural Earth 与公开历史研究；包含秦代郡县与人口中心的视觉信息，但仍是制图 SVG，不是带稳定 `region_id` 的 WGS84 行政 GeoJSON。可以作为秦代剧本的校核参考，不能直接当生产 polygon。来源：<https://commons.wikimedia.org/wiki/File:Qin_dynasty_territory.svg>。
- **Wikimedia Commons《Tang Dynasty Map.svg》**：作者自绘，CC BY 4.0，但页面明确没有提供数据来源；可作为唐代疆域视觉参考，不能作为生产 GIS 数据。来源：<https://commons.wikimedia.org/wiki/File:Tang_Dynasty_Map.svg>。
- **ArcGIS ChinaX《Eastern Han Dynasty 36 CE》**：公开 Feature Service，只有汉帝国宏观疆域，不包含本项目所需的 80–100 个内部战略区；服务元数据没有明确 license/accessInformation，因此不作为生产资源。来源：<https://www.arcgis.com/home/item.html?id=baa4657a86b5404eb1c2353f0b8f622e>。
- **Scientific Data《County-level population dataset of ancient China》**：Figshare 数据包虽标注 CC BY 4.0，但论文覆盖的是 2/742/1102/1820 年，且明确说明县界用 Thiessen polygon 模拟；论文文本本身是 CC BY-NC-ND 4.0。它不能满足 189 CE 的真实郡县 polygon 要求，不能作为本项目战略区来源，只能参考其州府级资料说明。来源：<https://www.nature.com/articles/s41597-026-07086-6>。
- **Hartwell China Historical GIS**：Harvard 发布的 CC0 数据，覆盖唐、宋、元、明的若干时间切片（包括唐 741、明 1391），确实有 GIS 面数据；但官方明确说明它用现代县界“co-location”合并/拆分来近似历史区域，边界存在问题。因此它可以作为单独的“唐/明历史剧本”候选，并且必须标注 `approximateHistoricalGeometry`、降低边界视觉确定性；不能冒充精确的东汉或秦代边界。来源：<https://chgis.fas.harvard.edu/data/hartwell/>，永久数据入口：<https://doi.org/10.7910/DVN/29302>。
- **Natural Earth**：仅用于公开领域的海岸线、河流、湖泊和地貌底图，不承担汉代政治边界语义。
- **公开领域的史料文本**（如《后汉书·郡国志》及公开汉代州郡表）：只用于名称、层级、治所和历史时间的人工校核，不生成未经授权的边界几何。

以下资料仅作为研究线索，不进入打包资源，也不作为生产数据来源：CHGIS、中央研究院历史瓦片、国家地球系统科学数据中心（禁止未经书面许可复制传播）、ArcGIS 无明确许可图层、版权地图册以及 Wikimedia 上没有明确可再分发几何授权的地图图片。Hartwell 虽然是 CC0，但它属于“近似历史几何”，必须与东汉精确行政 polygon 分开管理。它们不能绕过本项目的开放许可门槛。CHGIS 官方明确限制为学术研究，禁止商业使用、转售和再分发；因此不能直接放进公开游戏。可参考：<https://chgis.fas.harvard.edu/data/chgis/v6/>。

## 游戏化处理

当前可选剧本已切换为**唐代开元二十九年（741 CE）**：日历、开局叙事、地图标题和外围政权语义统一使用唐代语境。`tang-map-model-v2` 使用现代公开县级 polygon 作为空间骨架，按历史州府、山脉、河流和城市关系做可追溯的游戏聚合；它明确不宣称这些现代 polygon 是唐代史实边界。唐代名称、控制权、战争与前线仍由独立游戏状态提供。若未来取得授权更明确的唐代历史 polygon，可在不改变 `region_id` 的前提下替换几何。

所有城池、郡国治所和关隘均以 WGS84 经纬度存储。战略区与顶层道府州边界以已提交的 GeoJSON Polygon/MultiPolygon 保存，地图引擎只负责投影、绘制和绑定 `region_id`，不会在缩放、游戏 tick 或领土变化时重建 geometry。玩家的 `owner`、`controller`、战争前线和占领状态来自游戏 state，按每个 region polygon 实时计算并重绘；领土变化不会修改底层地理数据。史料无法确定精确控制线的外围地区使用半透明虚线 frontier zone 表现，不作为现代国界。

## 历史拼接规则

地图采用“多源拼接、逐区留证”的方式，而不是把一张历史图片当作底图：

1. Natural Earth 公共领域几何提供现代 WGS84 海岸线、河流、湖泊和地貌骨架。
2. OHM 或其他明确开放许可的历史矢量，只在其时间标签与几何覆盖可核验时写入对应战略区。
3. 公开领域史料文本负责名称、治所、道路和时间关系；文本不能单独制造边界 polygon。
4. 来源缺失或学界存在分歧的区域保留 `frontier zone` / 虚线边界，并在属性中写明 `sourceStatus` 与 `sourceNote`。
5. 每个进入生产的 Feature 必须能追溯到公开 URL、许可、历史时间窗和处理记录；没有证据的区域不能通过生产门禁。

这样可以把不同公开历史碎片逐步拼成一张地图，同时保留不确定性，不会为了填满地图而把现代边界或点位 Voronoi 冒充东汉行政 polygon。

## 几何来源门槛

生产环境不得使用由点位 Voronoi/Thiessen 网格冒充历史行政边界，也不得使用没有明确公共领域 / 开放许可的来源。本项目当前使用公开现代行政 polygon 的共享边界聚合，所有输入 geometry 均来自公开数据，输出明确标记为现代代理而不是唐代史实；当前模型版本为 `tang741-v2`，历史数据版本为 `tang-history-v1`。邻接生成脚本不会再生成或修改区域 geometry，只会从最终 GeoJSON 读取共享边界并生成缓存。`.github/workflows/cloudflare-pages.yml` 的生产部署步骤会执行 `npm run map:verify`，越界、重复 ID、缺少开放许可元数据或邻接缓存失配的几何会被主动拦截。

## 公开许可白名单

生产 polygon 必须在 GeoJSON `metadata.license` 中写明下列之一，并同时提供稳定 `sourceUrl`：`Public Domain`、`CC0`、`CC BY 4.0`、`CC BY-SA 4.0` 或 `ODbL 1.0`。仅写“免费”“可查看”“学术用途”不算可再分发授权。若来源条款发生变化，应先停止部署并重新审计。
