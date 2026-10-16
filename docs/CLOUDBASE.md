# 天津师范大学 CloudBase 联调：电脑操作清单

仓库只完成代码准备。数据库集合、安全规则、索引、云存储规则和云函数目前都**需要你在电脑上的微信开发者工具或云开发控制台手动配置**。本项目使用现有 `market` 单函数，客户端不直连数据库。环境名称 `campusmarket-dev`，环境 ID `campusmarket-dev-d7e8qkifecb7d51`。环境 ID 是公开标识，不是 AppSecret。

## 按顺序操作

1. **取得分支代码。** 在电脑上打开终端：`git clone https://github.com/zongjack8-art/codex-test.git`（已有仓库则进入仓库执行 `git fetch origin`），然后执行 `git switch feature/campusmarket-order-reservation`。如果本地尚无该分支，先执行 `git switch -c feature/campusmarket-order-reservation --track origin/feature/campusmarket-order-reservation`。确认 `git branch --show-current` 输出该分支。
2. **安装依赖并检查 Mock 版。** 使用 Node.js 20+ 和 pnpm 11，依次执行 `pnpm install --store-dir .pnpm-store`、`pnpm test:cloud`、`pnpm typecheck`、`pnpm build:weapp`、`pnpm build:h5`。不设置变量时就是 Mock，能先确认 UI 和本地数据仍正常。
3. **导入微信开发者工具。** 打开“项目 → 导入项目”，选择仓库根目录。`project.config.json` 的 `miniprogramRoot` 已是 `dist/weapp/`，并已填写项目 AppID；在工具中核对它与云环境关联的小程序 AppID 一致。确认首页仍为 Mock，并能看到天津师范大学文案。
4. **核对云开发环境并关联 AppID。** 在微信开发者工具“云开发”面板选择已有的 `campusmarket-dev`；在环境设置中核对 envId 是 `campusmarket-dev-d7e8qkifecb7d51`。到云开发控制台“环境配置 → 安全配置 → 小程序关联”确认当前小程序 AppID 已关联此环境，未关联则先关联。仓库默认 envId 位于 `cloudfunctions/market/campus.json` 的 `cloudEnvId`；若控制台 ID 不同，以控制台为准，可在构建时用 `TARO_APP_CLOUDBASE_ENV_ID` 覆盖，或修改该配置后再构建。
5. **创建数据库集合。** 在该环境的“数据库/集合”中逐一核对 `users`、`products`、`favorites`、`reports`、`conversations`、`messages`、`orders`、`admins`，再新建 `reviews`，名称与大小写完全一致。已有集合保留原数据，本轮需核对 `admins` 并新增 `reviews`。第一次微信登录会自动创建 `users` 文档；Mock 聊天不会上传。
6. **设置数据库安全规则。** 对九个集合分别进入“权限设置/安全规则”，使用 `cloudbase/rules/` 下对应同名 JSON 的内容。九个集合均为 `read: false, write: false`，即客户端不能直接读写；`market` 云函数通过服务端 SDK 操作。尤其 `admins` 不得允许客户端读写。不要选择“所有用户可读写”。保存后等待规则生效，并在控制台检查每个集合都已应用。
7. **建立常用索引。** 在控制台的“索引管理”中按 [DATABASE.md](DATABASE.md) 的索引表添加。保留已有索引；`orders` 必须建立 `activeKey` 升序**唯一索引**，以及 `buyerId + productId + status`、`buyerId + createdAt`、`sellerId + createdAt` 组合索引。**本轮还需新增 `orders` 的 `productId` 升序、`status` 升序组合索引**，供卖家确认订单时查询并自动取消同商品其他待确认单；现有以 `buyerId` 开头的组合索引无法高效支持这一查询。订单未读提醒沿用两个角色查询索引。`reviews` 需创建 `orderId` 升序唯一索引与 `sellerId + createdAt` 组合索引；同时由固定 `_id` 防止并发重复评价。等待索引创建完成后再测试多人下单。
8. **设置云存储规则。** 在该环境“云存储 → 权限设置/安全规则”粘贴 `cloudbase/rules/storage.json`。它只允许登录用户在 `incoming/` 上传符合命名格式、不超过 5 MB 的临时文件，且资源归属与当前微信身份一致；正式 `images/` 和 `avatars/` 只由云函数写入。当前云函数校验路径、文件大小和 JPEG/PNG/WebP 文件头，按实际格式保存，未进行重编码或元数据清除。不要改成全员可写。若控制台提供临时文件生命周期清理，给 `incoming/` 设定过期清理，避免未完成上传长期占用空间。
9. **部署云函数。** 回到微信开发者工具，确认“云函数根目录”为仓库的 `cloudfunctions/`。右键 `cloudfunctions/market`，选择“上传并部署：云端安装依赖”，目标环境选 `campusmarket-dev`；若旧版 `market` 已部署，这一步要重新部署本分支版本。本分支 `market` 包含管理员、评价及新的商品预订事务逻辑；**新索引建好后**再部署并测试。云函数使用 Node.js 20，依赖 `wx-server-sdk`；云端安装依赖不可跳过。部署完成后在云开发控制台确认 `market` 状态正常，并可查看日志。不要把整个仓库当成单个函数上传。
10. **构建 Cloud 版。** 在仓库根目录运行 `TARO_APP_DATA_SOURCE=cloud pnpm build:weapp`。PowerShell 用 `$env:TARO_APP_DATA_SOURCE='cloud'; pnpm build:weapp`。默认 envId 已配置；如需覆盖，Bash 还可加 `TARO_APP_CLOUDBASE_ENV_ID=控制台环境ID`，PowerShell 先设置 `$env:TARO_APP_CLOUDBASE_ENV_ID='控制台环境ID'`。`wx.cloud.init` 首次使用时初始化一次。回到微信开发者工具重新编译，确认编译的是新的 `dist/weapp/`。
11. **验证微信身份。** 用第一个微信账号预览，进入“我的”。应显示微信用户状态，`users` 集合出现一条新文档；其 `_id` 对应云函数 `getWXContext().OPENID`，`school` 为“天津师范大学”。编辑昵称、头像、校内范围和简介并保存，再检查这条文档更新，且 `createdAt` 不变、`updatedAt` 更新。不要求填写手机号、学号或真实姓名。
12. **验证商品与图片。** 用第一个账号发布含 1–3 张 JPEG/PNG/WebP 实物图的商品。发布后在 `products` 检查 `sellerId` 是该账号 OPENID、`school` 正确、`status=selling`、`images` 为 `cloud://` 文件 ID。在云存储检查 `images/<openid>/` 有相应格式的文件，`incoming/<openid>/` 的已完成临时文件被清理。用首页、分类、搜索和详情查看该商品；再测试编辑、下架、重新上架、标记已售和删除。已售后只可删除；编辑移除/删除后检查旧图片是否清理；若失败，查看 `reports` 中 `type=image_cleanup` 记录与函数日志。
13. **用第二个微信账号验证隔离。** 先在小程序后台把第二账号加入允许预览/体验的成员，再扫描预览码。第二账号进入“我的”后应创建**另一条** `users` 文档；能浏览第一个账号的在售商品并收藏，`favorites.userId` 应为第二账号 OPENID，同一商品重复收藏不应产生第二条记录。第二账号的“我的发布”不应出现第一个账号的商品，也不能通过改请求参数编辑、下架或删除第一个账号的商品。该权限由云函数验证，不能只看 UI 按钮是否隐藏。
14. **验证站内消息。** 第二账号进入第一账号在售商品详情，点“联系卖家”，发送文字。确认 `conversations` 新增一条且 `buyerId` 为第二账号 OPENID、`sellerId` 为第一账号 OPENID；再次点击应复用同一 `_id`。在 `messages` 检查 `senderId` / `receiverId`，第一账号的“消息”应出现未读，进入聊天后仅第一账号一侧未读清零。如有第三个测试账号，再验证非参与者不能读写该会话。随后将商品设为已售、下架，再删除，已建立聊天应仍可查看历史和商品快照。聊天只支持文字，建议在校内公共区域面交并自行付款。
15. **检查举报。** 用第二个微信账号打开第一个账号的商品详情，选择“举报 → 虚假信息”并提交，确认 `reports` 新增 `type=product`、`status=pending` 的记录，`reporterId` 是第二账号 OPENID；再次提交同一商品不应新增待处理记录。卖家自己的商品详情不应显示举报入口。用管理员账号在新后台处理这条测试举报。
16. **验证订单、提醒、规则与日志。** 第二账号在第一账号的在售商品详情点“我想要”，检查 `orders` 的 `buyerId`、`sellerId` 和 `amount` 来自真实身份与商品，`buyerUnread=false`、`sellerUnread=true`；重复操作不能产生第二笔活跃订单。第一账号进入“我的”，应看到“我的订单”红色数字；打开“我卖出的”后该角色未读清零。第一账号确认订单，第二账号应看到买家未读；面交后第一账号点“确认已完成交易”，检查订单 `completedAt` 与商品 `status=sold`，买家再次产生未读。另测双方取消、切换订单 Tab 只清当前角色、第三账号无权读写订单、聊天记录仍在。旧订单缺少未读字段时不显示红点。检查九个集合规则和 `market` 日志无权限或依赖错误；数据库和正式图片目录不允许客户端直写。本地构建不能代替真机验证。
17. **需要回退时切回 Mock。** Bash 执行 `TARO_APP_DATA_SOURCE=mock pnpm build:weapp`；PowerShell 执行 `$env:TARO_APP_DATA_SOURCE='mock'; pnpm build:weapp`，然后在开发者工具重新编译。Mock 聊天含演示会话并保存在本机；与 Cloud 数据独立。Cloud 故障不会自动把写入切到 Mock。H5 即使以 `cloud` 构建也只使用本机 Mock，并显示降级提示。

## 管理员后台：需手工完成

1. 在 CloudBase 数据库创建 **`admins`** 集合，并将安全规则设为 `cloudbase/rules/admins.json` 中的 `{ "read": false, "write": false }`。只有 `market` 云函数可以读写管理员记录；不要把管理员角色放进用户可以编辑的 `users` 文档。
2. 先用拟授权的微信账号打开 **Cloud 模式**小程序，在 `users` 集合找到该账号首次登录创建的文档。复制其 `_id`，它对应真实微信 OPENID；不要使用昵称、手机号或前端传来的 ID。不要把这个真实 OPENID 写进代码、文档或 Git。
3. 在控制台向 `admins` 集合新增一条文档，文档 ID 选择系统自动生成，填写 `{ "openid": "管理员真实OPENID", "role": "admin", "enabled": true, "createdAt": 0 }`；`createdAt` 建议填实际毫秒时间戳。完整复制 OPENID 到 `openid` 字段，不要截断，也不要填入自定义 `_id`；每个 OPENID 只保留一条管理员文档。集合规则关闭的是小程序客户端访问，控制台管理操作仍可完成。第一版**不提供**在小程序里添加或删除管理员的功能。停用管理员时，在控制台把 `enabled` 改为 `false`。
4. 重新部署 `cloudfunctions/market` 后，运行 `TARO_APP_DATA_SOURCE=cloud pnpm build:weapp` 并在微信开发者工具重新编译。管理员账号进入“我的”应看见“管理后台”；普通账号不应看见。普通账号即使直接调用 `adminListProducts`、`adminTakeDownProduct`、`adminListReports`、`adminResolveReport`，也应收到 `FORBIDDEN`。
5. 用普通账号举报一件商品，再用管理员账号进入“举报处理”选择下架或驳回。下架后该商品应离开首页与收藏在售流，卖家不能自行重新上架；聊天和订单历史仍应保留。对测试商品完成验证后，再处理真实举报。

`admins` 使用系统自动生成的 `_id`，云函数以真实 OPENID 查询 `admins.where({ openid }).limit(1)`。第一版管理员很少，不新增索引；管理员规模增长后可按查询性能再评估 `openid` 单字段索引。商品和举报列表第一版每次最多读取 100 条，在云函数内排序；若数据量增长，需要再设计分页和索引。仓库代码**不代表**云端已创建 `admins`、写入管理员或部署新函数。

## 云函数协议

前端统一调用 `market`。订单使用 `createOrder`、`listOrders`、`getOrder`、`confirmOrder`、`completeOrder`、`cancelOrder`、`getOrderUnreadSummary`、`markOrdersRead`；聊天使用 `startConversation`、`listConversations`、`getConversation`、`listMessages`、`sendMessage`、`markConversationRead`、`getUnreadMessageCount`；评价使用 `createReview`、`getOrderReview`、`getSellerReviewSummary`、`listSellerReviews`；管理员使用 `getAdminStatus`、`getAdminNotificationSummary`、`adminListProducts`、`adminTakeDownProduct`、`adminListReports`、`adminResolveReport`。原有商品、用户、收藏、上传及举报 action 保留。返回 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`。管理员操作只相信云函数上下文 OPENID 与 `admins` 集合；客户端传入的 `isAdmin`、`role` 或 `openid` 不决定权限。

## 当前边界

代码已配置 envId 和显式数据模式，并有本地安全单测。此仓库提交**不代表**集合、规则、索引、云函数已在你的云环境创建或部署；真实微信登录、云存储权限及聊天双账号隔离都必须按以上步骤在电脑和真机验证。站内消息只支持商品相关的一对一文字沟通，不提供支付、交易担保或学生身份认证。

管理员举报提醒需要重新部署本分支的 `market`（包含 `getAdminNotificationSummary`）并重新构建小程序，无需新增集合或索引。用普通账号提交本校商品举报后，管理员“我的”Tab、“管理后台”及后台“举报处理”入口应在可见期间最多约 5 秒内更新数字；驳回或确认违规后返回页面应立即刷新减少。订单未读数继续独立保留，并在“我的”Tab 与举报数相加。普通账号直接调用计数 action 应返回 `FORBIDDEN`。这些是电脑端待验证步骤，不代表真实云环境已经部署或真机验收。

## 交易评价：电脑端待完成

1. 检出 `feature/campusmarket-reviews`，运行 `pnpm install`、`pnpm test:cloud`、`pnpm typecheck`、`TARO_APP_DATA_SOURCE=cloud pnpm build:weapp`，重新导入或编译小程序。
2. 在现有云环境新建 `reviews` 集合；在权限设置粘贴 `cloudbase/rules/reviews.json`，确认客户端 `read: false`、`write: false`。保留已有八个集合的数据。
3. 在 `reviews` 的索引管理创建 `orderId` 升序**唯一索引**和 `sellerId` 升序、`createdAt` 降序组合索引。新集合为空时即可创建，等待索引构建完成。
4. 右键重新部署 `cloudfunctions/market`，选择“上传并部署：云端安装依赖”，确认目标环境为 `campusmarket-dev`。
5. 使用两个不同微信账号完成一笔订单。买家进入已完成订单，点“评价卖家”，选择星级并提交。检查 `reviews` 只有一条，`buyerId`、`sellerId`、`productId`、`school` 来自服务端，商品详情显示卖家信用与评价列表。重复提交应被拒绝；卖家和第三人不能替买家评价，第三人也不能查看订单评价状态。真机与云端验证完成前，不要把本地构建视为部署成功。

## 多人下单与商品预订：电脑端待验证

1. 检出 `feature/campusmarket-order-reservation`，保留现有集合与数据。在 CloudBase 控制台给 `orders` 新增 `productId` 升序、`status` 升序组合索引，等待构建完成；**不需要新建集合**。
2. 重新部署本分支的 `cloudfunctions/market`（云端安装依赖），运行 `TARO_APP_DATA_SOURCE=cloud pnpm build:weapp` 并在微信开发者工具重新编译。旧版前端/云函数不要与新版混用。
3. 用三个不同买家账号对同一件 `selling` 商品分别点“我想要”，确认生成三笔不同的 `pending` 订单。卖家确认其中一笔后，检查商品 `status=reserved`、只有该笔 `confirmed`；其他两笔自动 `cancelled`，`cancelReason=seller_selected_other_buyer`、`buyerUnread=true`、`sellerUnread=false`、`activeKey=closed_<订单ID>`。两个买家应看到订单未读红点和清晰的关闭原因。
4. 确认商品在首页/分类仍带“交易中”标记，详情不可新增订单或联系卖家；卖家不能编辑或手动改交易中商品。卖家完成已确认订单后商品应变 `sold`。另用测试商品取消已确认订单，检查商品恢复 `selling`，原先自动取消的买家可以重新下单。聊天和评价历史保留。
5. 同时快速点击确认两笔不同待确认订单，最终只能有一笔 `confirmed`。再用旧版已确认订单验证兼容：若商品仍为 `selling` 且订单没有 `reservedAt`，仍应能正常完成。这里是人工云端验证清单，仓库构建不代表真实环境已部署。
