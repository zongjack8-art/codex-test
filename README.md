# CampusMarket 校园二手平台

基于 Taro 4、React 18、TypeScript 和 SCSS 的校园闲置交易小程序。当前开发与预览默认使用本地 Mock 模式，无需开通云服务；界面按微信小程序优先设计，同时可构建 H5。已有 CloudBase 与 HTTP API 接口预留，只有主动提供对应环境变量并重新构建时才会切换数据源。

## 本地运行

需要 Node.js 20+ 和 pnpm 11。仓库已为 Taro 构建所需依赖配置 pnpm `allowBuilds`。

```bash
pnpm install --store-dir .pnpm-store
pnpm test:cloud
pnpm typecheck
pnpm build:weapp
pnpm build:h5
```

微信开发者工具导入仓库根目录，将 `project.config.json` 中的 `touristappid` 替换为自己的小程序 AppID；项目编译设置使用 `dist/weapp/` 作为小程序产物目录。H5 产物位于 `dist/h5/`。开发时使用 `pnpm dev:weapp` 或 `pnpm dev:h5`。

界面采用统一的薄荷青色、柔和紫色与浅色商品卡片。颜色、间距、圆角和字级集中维护在 `src/styles/_tokens.scss`，公共样式在 `src/styles/_components.scss`，页面样式在 `src/styles/_pages.scss`。组件和页面设计约定见 [视觉规范](docs/DESIGN.md)；本地演示图片的来源与许可见 [图片说明](docs/ASSETS.md)。参考 UI 只用于提炼视觉方向，没有作为项目素材直接复制。

## CloudBase 正式模式

在微信开发者工具中开通云开发、创建环境后，从控制台复制 envId。不要把真实 envId 写入源码；按 [CloudBase 部署步骤](docs/CLOUDBASE.md) 创建集合、设置规则并部署 `market` 云函数。完成后在命令行传入 envId 构建：

```bash
TARO_APP_CLOUDBASE_ENV_ID=你的envId pnpm build:weapp
```

PowerShell 使用 `$env:TARO_APP_CLOUDBASE_ENV_ID='你的envId'; pnpm build:weapp`。`.env.example` 仅展示变量名，构建脚本不会自动读取该文件。切换环境需要重新构建。

CloudBase 模式的路径为：页面 → `src/services` → `wx.cloud.callFunction('market')` → 云数据库。登录通过 `Taro.login()` 启动微信登录流程，云函数从可信微信上下文取得 OPENID，首次登录自动建档。昵称、头像、学校和校区可在“我的 → 编辑个人资料”修改。商品和收藏的写操作均在云函数中验证身份。

## 页面与功能

| 页面 | 路径 | 功能 |
| --- | --- | --- |
| 首页 | `/pages/index/index` | 商品流、分类入口、毕业季专题、搜索入口 |
| 分类搜索 | `/pages/categories/index` | 分类筛选、关键词搜索、排序 |
| 商品详情 | `/pages/detail/index?id=...` | 商品信息、卖家信息、收藏、交易提醒 |
| 发布/编辑商品 | `/pages/publish/index` | 表单校验、图片上传、保存修改 |
| 收藏 | `/pages/favorites/index` | 收藏列表、快捷取消收藏 |
| 我的 | `/pages/profile/index` | 登录入口、发布与收藏统计、交易安全提醒 |
| 我的发布 | `/pages/my-listings/index` | 编辑、下架、标记售出、重新上架、删除 |
| 编辑资料 | `/pages/profile/edit` | 昵称、头像、学校、校区 |

Mock 商品在 `src/data/mock.ts`。未设置环境变量时，微信小程序和 H5 都使用本机 Mock 数据，不需要开通 CloudBase。商品、收藏、个人资料和发布文字草稿保存在当前设备；照片不写入草稿，离开发布页后需重新选择。微信小程序发布时会把照片转存到本地持久文件（单张不超过 3 MB），编辑移除或删除商品时清理；H5 照片仍使用浏览器临时地址，刷新后可能失效。Mock 数据不会跨设备同步，清除应用数据后也会消失。当前“联系卖家”仍显示交易提醒，聊天和支付不在本阶段范围内。

升级视觉样式后，内置示例商品会在读取时换成新的文案和缩略图；已发布的本地商品、收藏及商品状态继续保留。首页展示的学校名称取自当前本地个人资料，可到“我的 → 编辑个人资料”修改。

## 其他后端与兼容性

原有 HTTP API Service 仍可作为未来替代方案：设置 `TARO_APP_API_BASE_URL` 后重新构建可接入 [HTTP API 设计](docs/API.md)。微信端同时配置 CloudBase 和 HTTP 时优先 CloudBase；H5 仅在单独提供 HTTP API 时使用 HTTP，否则保持 Mock。示例：

```bash
TARO_APP_API_BASE_URL=https://api.example.edu pnpm build:weapp
```

`src/services/products.ts` 负责商品与收藏，`src/services/auth.ts` 负责用户，`src/services/upload.ts` 负责上传，`src/services/cloudbase.ts` 只封装云调用。CloudBase 小程序不需要在前端配置 AppSecret。H5 真实微信登录需要独立网页授权后端。

其他设计文档：[数据库设计](docs/DATABASE.md)、[安全说明](SECURITY.md)。
