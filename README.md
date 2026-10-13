# CampusMarket 校园二手平台

基于 Taro 4、React 18、TypeScript 和 SCSS 的校园闲置交易前端。优先支持微信小程序，同时构建 H5。当前默认使用内置 Mock 数据，无需后端即可体验浏览、搜索、发布、收藏和商品管理。

## 本地运行

需要 Node.js 20+ 和 pnpm 11。仓库已为 Taro 构建所需依赖配置 pnpm `allowBuilds`。

```bash
pnpm install --store-dir .pnpm-store
pnpm typecheck
pnpm build:weapp
pnpm build:h5
```

微信开发者工具导入仓库根目录，将 `project.config.json` 中的 `touristappid` 替换为自己的小程序 AppID；小程序产物位于 `dist/weapp/`，H5 产物位于 `dist/h5/`。开发时使用 `pnpm dev:weapp` 或 `pnpm dev:h5`。

## 页面与功能

| 页面 | 路径 | 功能 |
| --- | --- | --- |
| 首页 | `/pages/index/index` | 商品流、分类入口、发布入口 |
| 分类搜索 | `/pages/categories/index` | 分类筛选、关键词搜索、排序 |
| 商品详情 | `/pages/detail/index?id=...` | 商品信息、卖家信息、收藏、交易提醒 |
| 发布商品 | `/pages/publish/index` | 商品表单、图片选择、图片上传预留 |
| 收藏 | `/pages/favorites/index` | 收藏列表 |
| 我的 | `/pages/profile/index` | 登录入口、发布与收藏统计、交易安全提醒 |
| 我的发布 | `/pages/my-listings/index` | 标记售出、重新上架、删除 |

Mock 商品在 `src/data/mock.ts`。演示数据使用 Taro Storage 保存在当前设备；发布商品和收藏刷新后仍在。演示模式中的图片使用本地临时路径，应用重启后可能失效；正式接入时应启用上传接口。演示模式不提供真实交易或聊天。当前“联系卖家”显示交易提示，后端接入后可扩展消息服务。

## 接入后端

设置 `TARO_APP_API_BASE_URL` 后重新构建，Service 层切换到 HTTP API。示例：

```bash
TARO_APP_API_BASE_URL=https://api.example.edu pnpm build:weapp
```

服务端必须实现 [API 设计](docs/API.md) 中的接口。`src/services/products.ts` 负责商品与收藏，`src/services/auth.ts` 负责微信 `code` 登录，`src/services/upload.ts` 负责上传。微信 AppSecret 只保存在服务端。小程序正式上线前，需要在微信公众平台配置 API 和上传合法域名，并使用 HTTPS。H5 真实登录需要另行接入网页授权，页面目前会明确提示。

其他设计文档：[数据库设计](docs/DATABASE.md)、[安全说明](SECURITY.md)。
