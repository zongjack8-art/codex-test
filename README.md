# CampusMarket 校园二手平台

面向**天津师范大学**的校园闲置交易小程序，基于 Taro 4、React 18、TypeScript 和 SCSS。默认使用本地 Mock 数据；只有显式选择 `cloud` 并重新构建微信小程序才会调用 CloudBase。H5 在选择 `cloud` 时仍降级到 Mock。

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

## 天津师范大学与数据模式

学校名称、简称、品牌、默认面交范围和开发环境 ID 集中在 `cloudfunctions/market/campus.json`，前端通过 `src/config/campus.ts` 读取。当前 envId 为 `campusmarket-dev-d7e8qkifecb7d51`；envId 是公开的环境标识，**不是密钥**。若未来更换环境，可使用 `TARO_APP_CLOUDBASE_ENV_ID` 在构建时覆盖，禁止提交 AppSecret、服务端密钥或访问令牌。

默认构建保持 Mock，即使配置文件中已有 envId 也不会自动连接云端。明天在电脑完成 [CloudBase 部署步骤](docs/CLOUDBASE.md) 后，显式构建云端版本：

```bash
TARO_APP_DATA_SOURCE=cloud pnpm build:weapp
```

PowerShell：`$env:TARO_APP_DATA_SOURCE='cloud'; pnpm build:weapp`。回退本地数据：`TARO_APP_DATA_SOURCE=mock pnpm build:weapp`；PowerShell 改为 `$env:TARO_APP_DATA_SOURCE='mock'; pnpm build:weapp`。每次切换后在微信开发者工具重新编译。`.env.example` 仅是说明文件，不会被自动读取。云端请求失败时会显示重试提示，**不会静默写入本地 Mock**，避免误以为数据已上传。

CloudBase 模式的路径为：页面 → `src/services` → `wx.cloud.callFunction('market')` → 云数据库。`wx.cloud.init` 仅在首次调用时运行一次。云函数从可信微信上下文取得 OPENID，首次登录自动建档；客户端无权指定商品卖家、收藏用户或学校。昵称、头像、常用校内范围和简介可在“我的 → 编辑个人资料”修改；学校固定为天津师范大学。`users`、`products`、`favorites`、`reports` 集合及 `market` 云函数**尚需在云开发控制台创建、配置和部署**。

## 页面与功能

| 页面 | 路径 | 功能 |
| --- | --- | --- |
| 首页 | `/pages/index/index` | 商品流、分类入口、毕业季专题、搜索入口 |
| 分类搜索 | `/pages/categories/index` | 分类筛选、关键词搜索、排序 |
| 商品详情 | `/pages/detail/index?id=...` | 商品信息、卖家信息、收藏、交易提醒 |
| 发布/编辑商品 | `/pages/publish/index` | 表单校验、图片上传、保存修改 |
| 收藏 | `/pages/favorites/index` | 收藏列表、快捷取消收藏 |
| 我的 | `/pages/profile/index` | 用户资料、发布与收藏统计、交易安全提醒 |
| 我的发布 | `/pages/my-listings/index` | 编辑、下架、标记售出、重新上架、删除 |
| 编辑资料 | `/pages/profile/edit` | 昵称、头像、常用校内范围、简介；学校只读 |

Mock 商品在 `src/data/mock.ts`。商品、收藏、个人资料和发布文字草稿保存在当前设备；照片不写入草稿，离开发布页后需重新选择。微信小程序 Mock 发布时会把照片转存到本地持久文件（单张不超过 3 MB），编辑移除或删除商品时清理；H5 照片仍使用浏览器临时地址，刷新后可能失效。Mock 数据不会跨设备同步，清除应用数据后也会消失。当前“联系卖家”只显示线下交易提醒，站内联系、聊天和支付均未开通。

内置示例商品会在读取时更新为天津师范大学的通用校内面交描述；已发布的本地商品、收藏及商品状态继续保留。旧 Mock 资料中的学校和虚构校区名在读取时归一化。首页学校名称统一来自校园配置，不依赖用户输入。

## 其他后端与兼容性

原有 HTTP API Service 仍可作为未来替代方案，使用显式的 `api` 模式与 `TARO_APP_API_BASE_URL` 接入 [HTTP API 设计](docs/API.md)。它与 CloudBase 独立，不会因为设置 URL 就自动启用：

```bash
TARO_APP_DATA_SOURCE=api TARO_APP_API_BASE_URL=https://api.example.edu pnpm build:weapp
```

`src/services/products.ts` 负责商品与收藏，`src/services/auth.ts` 负责用户，`src/services/upload.ts` 负责上传，`src/services/reports.ts` 预留举报接口，`src/services/cloudbase.ts` 只封装云调用。CloudBase 小程序不需要在前端配置 AppSecret。H5 真实微信登录需要独立网页授权后端。

其他设计文档：[数据库设计](docs/DATABASE.md)、[安全说明](SECURITY.md)。
