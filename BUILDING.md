# 构建游戏源码

本仓库是公开源码副本，不包含生产凭据、玩家存档、内部报告或旧 Git 历史。

推荐 Node.js 24。安装并检查：

```sh
npm ci
npm run check
npm test
npm run types:check
npm run dev
```

本地游戏入口为开发服务器的 /play/。部署自有后端时，需创建自己的 D1 数据库并替换 wrangler.jsonc 中的占位 ID，再执行迁移；不共享正式玩家数据。

桌面版使用 Tauri 2，另需 Rust 和平台构建依赖。`npm run desktop:prepare` 准备内置前端；安装 Tauri CLI 后按本机平台构建。桌面发布工作流仅作构建参考，在公开副本中禁用生产发布。

地图与依赖授权见 [数据来源](public/data/SOURCES.md)。源码开放查看、下载不等于对第三方素材另行授予许可。
