# 天津师范大学 CloudBase 联调：电脑操作清单

仓库只完成代码准备。数据库集合、安全规则、索引、云存储规则和云函数目前都**需要你在电脑上的微信开发者工具或云开发控制台手动配置**。本项目使用现有 `market` 单函数，客户端不直连数据库。环境名称 `campusmarket-dev`，环境 ID `campusmarket-dev-d7e8qkifecb7d51`。环境 ID 是公开标识，不是 AppSecret。

## 按顺序操作

1. **取得分支代码。** 在电脑上打开终端：`git clone https://github.com/zongjack8-art/codex-test.git`（已有仓库则进入仓库执行 `git fetch origin`），然后执行 `git switch feature/campusmarket-product-detail`。如果本地尚无该分支，先执行 `git switch -c feature/campusmarket-product-detail --track origin/feature/campusmarket-product-detail`。确认 `git branch --show-current` 输出该分支。
2. **安装依赖并检查 Mock 版。** 使用 Node.js 20+ 和 pnpm 11，依次执行 `pnpm install --store-dir .pnpm-store`、`pnpm test:cloud`、`pnpm typecheck`、`pnpm build:weapp`、`pnpm build:h5`。不设置变量时就是 Mock，能先确认 UI 和本地数据仍正常。
3. **导入微信开发者工具。** 打开“项目 → 导入项目”，选择仓库根目录。`project.config.json` 的 `miniprogramRoot` 已是 `dist/weapp/`，并已填写项目 AppID；在工具中核对它与云环境关联的小程序 AppID 一致。确认首页仍为 Mock，并能看到天津师范大学文案。
4. **核对云开发环境并关联 AppID。** 在微信开发者工具“云开发”面板选择已有的 `campusmarket-dev`；在环境设置中核对 envId 是 `campusmarket-dev-d7e8qkifecb7d51`。到云开发控制台“环境配置 → 安全配置 → 小程序关联”确认当前小程序 AppID 已关联此环境，未关联则先关联。仓库默认 envId 位于 `cloudfunctions/market/campus.json` 的 `cloudEnvId`；若控制台 ID 不同，以控制台为准，可在构建时用 `TARO_APP_CLOUDBASE_ENV_ID` 覆盖，或修改该配置后再构建。
5. **创建数据库集合。** 在该环境的“数据库/集合”中逐一新建 `users`、`products`、`favorites`、`reports`、`conversations`、`messages`，名称与大小写完全一致。若旧四个集合已存在，只新增聊天的两个集合，保留原数据。第一次微信登录会自动创建 `users` 文档；Mock 聊天不会上传。
6. **设置数据库安全规则。** 对六个集合分别进入“权限设置/安全规则”，使用 `cloudbase/rules/` 下对应同名 JSON 的内容。六个集合均为 `read: false, write: false`，即客户端不能直接读写；`market` 云函数通过服务端 SDK 操作。不要选择“所有用户可读写”。保存后等待规则生效，并在控制台检查每个集合都已应用。
7. **建立常用索引。** 在控制台的“索引管理”中按 [DATABASE.md](DATABASE.md) 的“索引”表添加。原有索引已建则不要重复；聊天新增 `conversations` 的 `buyerId + lastMessageAt`、`sellerId + lastMessageAt`，`messages` 的 `conversationId + createdAt` 和 `conversationId + senderId + createdAt`。`_id` 默认唯一索引已阻止同一买家对同一商品重复建会话。字段顺序和升降序按文档表执行；等待索引状态完成。
8. **设置云存储规则。** 在该环境“云存储 → 权限设置/安全规则”粘贴 `cloudbase/rules/storage.json`。它只允许登录用户在 `incoming/` 上传符合命名格式、不超过 5 MB 的临时文件，且资源归属与当前微信身份一致；正式 `images/` 和 `avatars/` 只由云函数写入。当前云函数校验路径、文件大小和 JPEG/PNG/WebP 文件头，按实际格式保存，未进行重编码或元数据清除。不要改成全员可写。若控制台提供临时文件生命周期清理，给 `incoming/` 设定过期清理，避免未完成上传长期占用空间。
9. **部署云函数。** 回到微信开发者工具，确认“云函数根目录”为仓库的 `cloudfunctions/`。右键 `cloudfunctions/market`，选择“上传并部署：云端安装依赖”，目标环境选 `campusmarket-dev`；若旧版 `market` 已部署，这一步要重新部署本分支版本。新版 `getProduct` 会按真实微信 OPENID 与数据库 `sellerId` 返回 `viewerIsSeller`；旧函数不返回该字段时，详情页会隐藏买家操作，提示重新加载。云函数使用 Node.js 20，依赖 `wx-server-sdk`；云端安装依赖不可跳过。部署完成后在云开发控制台确认 `market` 状态正常，并可查看日志。不要把整个仓库当成单个函数上传。
10. **构建 Cloud 版。** 在仓库根目录运行 `TARO_APP_DATA_SOURCE=cloud pnpm build:weapp`。PowerShell 用 `$env:TARO_APP_DATA_SOURCE='cloud'; pnpm build:weapp`。默认 envId 已配置；如需覆盖，Bash 还可加 `TARO_APP_CLOUDBASE_ENV_ID=控制台环境ID`，PowerShell 先设置 `$env:TARO_APP_CLOUDBASE_ENV_ID='控制台环境ID'`。`wx.cloud.init` 首次使用时初始化一次。回到微信开发者工具重新编译，确认编译的是新的 `dist/weapp/`。
11. **验证微信身份。** 用第一个微信账号预览，进入“我的”。应显示微信用户状态，`users` 集合出现一条新文档；其 `_id` 对应云函数 `getWXContext().OPENID`，`school` 为“天津师范大学”。编辑昵称、头像、校内范围和简介并保存，再检查这条文档更新，且 `createdAt` 不变、`updatedAt` 更新。不要求填写手机号、学号或真实姓名。
12. **验证商品与图片。** 用第一个账号发布含 1–3 张 JPEG/PNG/WebP 实物图的商品。发布后在 `products` 检查 `sellerId` 是该账号 OPENID、`school` 正确、`status=selling`、`images` 为 `cloud://` 文件 ID。在云存储检查 `images/<openid>/` 有相应格式的文件，`incoming/<openid>/` 的已完成临时文件被清理。用首页、分类、搜索和详情查看该商品；再测试编辑、下架、重新上架、标记已售和删除。已售后只可删除；编辑移除/删除后检查旧图片是否清理；若失败，查看 `reports` 中 `type=image_cleanup` 记录与函数日志。
13. **用第二个微信账号验证隔离。** 先在小程序后台把第二账号加入允许预览/体验的成员，再扫描预览码。第二账号进入“我的”后应创建**另一条** `users` 文档；能浏览第一个账号的在售商品并收藏，`favorites.userId` 应为第二账号 OPENID，同一商品重复收藏不应产生第二条记录。第二账号的“我的发布”不应出现第一个账号的商品，也不能通过改请求参数编辑、下架或删除第一个账号的商品。该权限由云函数验证，不能只看 UI 按钮是否隐藏。
14. **验证站内消息。** 第二账号进入第一账号在售商品详情，点“联系卖家”，发送文字。确认 `conversations` 新增一条且 `buyerId` 为第二账号 OPENID、`sellerId` 为第一账号 OPENID；再次点击应复用同一 `_id`。在 `messages` 检查 `senderId` / `receiverId`，第一账号的“消息”应出现未读，进入聊天后仅第一账号一侧未读清零。如有第三个测试账号，再验证非参与者不能读写该会话。随后将商品设为已售、下架，再删除，已建立聊天应仍可查看历史和商品快照。聊天只支持文字，建议在校内公共区域面交并自行付款。
15. **检查举报、规则与日志。** 用第二个微信账号打开第一个账号的商品详情，选择“举报 → 虚假信息”并提交，确认 `reports` 新增 `type=product`、`status=pending` 的记录，`reporterId` 是第二账号 OPENID；再次提交同一商品不应新增待处理记录。卖家自己的商品详情不应显示举报入口。核对六个集合的真实写入，以及 `market` 日志无权限或依赖错误。数据库和正式图片目录不允许客户端直写。当前没有举报审核后台；真机图片显示和多账号隔离需手工验证，本地构建不能替代这些验证。
16. **需要回退时切回 Mock。** Bash 执行 `TARO_APP_DATA_SOURCE=mock pnpm build:weapp`；PowerShell 执行 `$env:TARO_APP_DATA_SOURCE='mock'; pnpm build:weapp`，然后在开发者工具重新编译。Mock 聊天含演示会话并保存在本机；与 Cloud 数据独立。Cloud 故障不会自动把写入切到 Mock。H5 即使以 `cloud` 构建也只使用本机 Mock，并显示降级提示。

## 云函数协议

前端统一调用 `market`。聊天新增 `startConversation`、`listConversations`、`getConversation`、`listMessages`、`sendMessage`、`markConversationRead`、`getUnreadMessageCount`；原有商品、用户、收藏、上传及举报 action 保留。返回 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`。写操作只相信云函数上下文 OPENID；客户端传入的 `senderId`、`receiverId`、`buyerId`、`sellerId`、`userId`、`reporterId` 和 `school` 均不会决定真实归属。

## 当前边界

代码已配置 envId 和显式数据模式，并有本地安全单测。此仓库提交**不代表**集合、规则、索引、云函数已在你的云环境创建或部署；真实微信登录、云存储权限及聊天双账号隔离都必须按以上步骤在电脑和真机验证。站内消息只支持商品相关的一对一文字沟通，不提供支付、交易担保或学生身份认证。
