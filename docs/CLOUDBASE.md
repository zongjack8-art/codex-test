# CloudBase 部署步骤

以下操作需要在你自己的微信开发者工具和云开发控制台完成。当前仓库没有真实 envId、AppID 或云端权限，因此代码提交和本地构建不会自动创建云端资源。

1. 在微信开发者工具中导入仓库根目录，填写自己的小程序 AppID。在“云开发”面板开通云开发并新建或选择环境，记下 **envId**。确保小程序和云开发环境属于同一账号。
2. 在云开发“文档型数据库 / 集合管理”中创建 `users`、`products`、`favorites`、`reports` 四个集合。逐个切换至“安全规则”，分别粘贴 `cloudbase/rules/` 中同名 JSON。四个集合均禁止客户端直读直写，云函数使用服务端权限访问。规则变更可能需要数分钟生效。
3. 在“云存储 / 权限设置 / 自定义安全规则”中粘贴 `cloudbase/rules/storage.json`。它只允许已登录客户端向 `incoming/` 上传不超过 5 MB 的文件；正式商品图片和头像由云函数重编码后写入 `images/`、`avatars/`，客户端只能读取。建议给 `incoming/` 配置定期清理策略，清理未完成确认的临时文件。
4. 在工具中选中 `cloudfunctions/market`，选择“上传并部署：云端安装依赖”，运行时选择支持 Node.js 18+ 的版本。该函数需要安装 `wx-server-sdk` 和 `sharp`；`package-lock.json` 已锁定依赖。等待函数状态显示部署成功，再通过云函数日志排查运行错误。
5. 在命令行构建正式小程序：`TARO_APP_CLOUDBASE_ENV_ID=你的envId pnpm build:weapp`。PowerShell 可执行 `$env:TARO_APP_CLOUDBASE_ENV_ID='你的envId'; pnpm build:weapp`。随后在微信开发者工具中编译并预览。变量的示例见 `.env.example`，不要提交自己的本地环境配置。
6. 首次打开“我的”时，云函数从 `getWXContext().OPENID` 取得身份并自动创建 `users` 文档。编辑昵称、头像、学校、校区；再发布带实物图的商品，验证首页、搜索、收藏、下架和删除流程。云端数据不会自动迁移第一阶段的本地 Mock 商品。

## 云函数协议

前端只调用 `market` 函数，`event.action` 可为 `login`、`updateProfile`、`listProducts`、`getProduct`、`createProduct`、`updateProduct`、`setProductStatus`、`deleteProduct`、`getMyProducts`、`getFavoriteIds`、`getFavorites`、`setFavorite`、`finalizeImage`。返回 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`。所有写操作以云函数上下文 OPENID 为准，客户端传入的 `sellerId` 或 `userId` 不会被采用。

## 验证边界

本地已运行 TypeScript 检查、云函数安全单测和双端构建。实际的登录、云数据库读写、云存储规则及函数部署，需要上述云环境配置后在微信开发者工具中联调；不要将本地构建成功视为云端已上线。H5 在只配置 envId 时使用本地演示数据并显示提示。
