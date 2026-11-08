# CampusMarket 云端部署准备与风险检查报告

第四阶段的本地发布检查通过。目标 CloudBase 环境已能进行只读核对，**新 AppID 的端到端业务联调条件尚未齐备**。现有探针可以作为下一步的最小验证入口。正式业务切换另行评审。

## 核对结果

| 检查项 | 已核对 | 仍需验证 |
| --- | --- | --- |
| 业务契约 | 19 个页面的服务层、旧 `market` 和 PostgreSQL 入口的 43 个 action 一一对应，无重复。保留默认旧入口和响应结构 | 微信开发者工具和真机走完整链路，确认权限错误、图片和通知的实际表现 |
| 数据库 | 14 张表、27 个业务 RPC、索引和外键在完整本地结构核对。业务 RPC 为 `SECURITY INVOKER`，固定 `search_path` 并检查角色。`anon` 和 `authenticated` 没有业务表或列访问权 | SHARED 实际网关的运行身份、标量与 JSON 返回、RPC 参数、错误映射和查询性能。PostgREST 端点可达性不能替代数据库授权 |
| 交易与聊天 | 本地独立会话覆盖并发下单、审核与取消、消息和已读、评价去重及失败回滚。第四阶段调整用户行锁，保留同一用户的写入串行性，并避免与订单外键检查互相等待 | 真机两端同时操作，核对红点和最终状态 |
| 微信身份 | PG 业务入口与本地探针使用 SDK 从本次调用的 `context` 读取身份。缺失、损坏或来源 AppID 不匹配时拒绝。管理员继续绑定精确的 `(APPID, OPENID)` | 核实新 AppID 的实际上下文字段，包括共享环境中的来源 AppID。检查热实例连续调用和非小程序调用拒绝结果 |
| 图片 | 本地验证路径、大小、类型、临时清理、失败补偿和历史引用保护。正式图片只有待办和只读预检 | 验证实际桶模式、跨用户写入拒绝、旧 `cloud://` 引用与恢复映射。正式图片删除执行器仍未实现，也不在本次联调范围内 |
| 历史备份 | 10 个原文件、109 条记录在完整结构上从临时副本导入和重放通过，原文件 SHA-256 一致。历史身份仍只归旧 AppID | 冻结旧写入后重新导出并对账，确认正式切换用的完整快照和增量 |

本地通过 82 项原业务测试、30 项迁移及业务接口测试、4 项发布检查、8 项探针测试、独立 PostgreSQL 17 多会话测试及 TypeScript 检查。普通微信小程序、隔离联调小程序及 H5 构建均完成，两个小程序产物各注册 19 页。构建产物中已核对 `wx.cloud.init` 和 `callFunction` 的实际目标。H5 仍有资源体积警告，只用于构建回归。本机 Node.js 为 24.21，目标事件运行时 Nodejs20.19 仍待实测。各套本地测试的微信调用和 CloudBase 传输均由测试替身覆盖。

## 云端只读检查与配置

- `queryEnv(info)` 确认 `additional-orangutan-d3abd2399c3` 为正常的上海 SHARED PostgreSQL 环境，派生的运行模式为 `postgresql`。环境用户信息中的微信 AppID 是旧的 `wxdb3e3d718940eae6`，该字段不是完整关联名单。`wxd07e4ed740dcd392` 的认证及关联仍需确认。
- `queryFunctions` 的列表、详情和触发器查询看到该环境只有 `rehub_pg_compat`，Event、Nodejs20.19、`index.main`、超时 10 秒，触发器列表为空。查询使用脱敏的函数配置。当前函数代码版本和真机调用结果待验。
- `queryPgDatabase(sql)` 查到零张 `public.rehub_*` 业务表、一个 `public.rehub_pg_compat_check()`。该函数为调用者权限且函数体含角色检查。目录权限显示 `service_role` 可执行、普通角色无执行授权。`service_role` 具备 `BYPASSRLS`，三种角色均有 `public` schema 使用权。以上均为目录元数据，实际网关拒绝和事件函数身份要单独验证。
- `managePgDatabase(listMigrations)` 返回零个版本。存储目录查询看到 `storage.buckets` 和 `storage.objects` 均启用 RLS，`storage.objects` 当前没有策略。若微信上传走 PG 存储路径，需在图片联调前评审最小对象策略或受控签名方案。目录结果也不能证明旧桶对新 AppID 可读。
- 普通小程序构建的 AppID 来自 `project.config.json`，仍是旧 AppID。缺少构建环境覆盖时，`campus.json` 的 `campusmarket-dev-d7e8qkifecb7d51` 继续用于普通构建，函数名是 `market`。把普通构建仅改环境 ID 会请求目标环境不存在的 `market`。部署普通入口时漏设 `REHUB_MARKET_BACKEND` 则会按原设计选择旧实现。

## SQL 发布包、重放与回滚

按下面顺序加载同一版本的 SQL。

| 顺序 | 脚本 | 依赖与作用 |
| --- | --- | --- |
| 1 | `schema.sql` | 域、业务表、历史审计表、索引、外键和基础权限 |
| 2 | `transactions.sql` | 商品流转和预留约束，订单、聊天事务及权限 |
| 3 | `market-batch-one.sql` | 身份、商品、收藏、浏览和图片待办 RPC |
| 4 | `market-batch-two.sql` | 订单提醒、会话和消息分页 RPC |
| 5 | `market-batch-three.sql` | 评价、举报、管理员审核与权限 |
| 6 | `market-storage.sql` | 临时对象清理任务、租约和重试 RPC |

`deployment-schema.mjs` 从这六个文件生成唯一的空库基线，输出仅包含 DDL。`formal-cleanup-plan.sql` 属于只读核对。探针和数据导入也各自独立。当前 DDL SHA-256 为 `10d7e138082bd1260f9ca8682e4f2cfb33914ab65b40190d26fba40ee50dc4a1`。

1. 申请结构变更授权后，重新查目标环境、角色、目录、已有迁移版本及对象。若已有任意业务对象，停止空库基线，编制专门增量。包头检查已有 `rehub_` 对象并拒绝重放，允许目标保留现有无参探针。禁止用 `IF NOT EXISTS` 跳过差异。
2. `node scripts/pg-migration/deployment-schema.mjs` 生成 DDL。选择大于远端最新版本的 14 位 UTC 版本号，将同一 UTF-8 内容放入 `cloudbase/migrations/<版本>_rehub_pg_baseline.sql`。通过官方 `managePgDatabase(planMigration)` 预览，核对文件哈希、对象范围和整文件事务语义。CLI 备用为 `tcb db pg migration up -e additional-orangutan-d3abd2399c3 --dry-run`。未确认托管执行器会原子执行整包时，停止申请应用。本地整包是在显式单事务中验证的。
3. 只有获准后才以相同版本和内容调用 `applyMigration`。成功标准为任务成功、迁移历史有该版本、目录及权限核对一致。超时先查任务状态、迁移历史和目录。存在部分对象或历史不一致时冻结下一步，核对故障点并单独评审前滚或回滚。`migration repair` 只修历史记录。
4. 已落地的结构回滚先停止测试入口。测试行、DDL 或探针的清理按影响评审后另行授权。正式切换前保留旧代码、配置和存储，回滚时先停止新写入。如果 PostgreSQL 已有正式新增订单、消息或审核记录，先导出并对账这些增量，再决定如何恢复旧路由，避免把新写入留在另一套库中。

真实数据需另行授权。合成数据联调结束后需盘点并清除获准的测试记录，或选择已核实的干净目标。当前导入器拒绝将历史快照混入有业务数据的目标。导入前校验集合计数、哈希、用户与商品引用及订单状态，确认保留旧身份、孤立会话商品快照及下架商品上的待确认订单。完全一致的快照可无写入重放，源或目标有变化则整笔失败。原始快照、含数据的导入 SQL、日志和对账明细均留在受控目录。[CloudBase 版本迁移](https://docs.cloudbase.net/en/cli-v1/db/postgresql/migration-up)

## 安全的历史身份接续

按 `(APPID, OPENID)` 标识微信身份。历史业务行保持旧身份的内部用户 ID，新 AppID 登录创建自己的身份。昵称、头像、客户端提交的 OPENID，以及未经核实的 UnionID 均不能作为接续凭据。

如需接续，另行设计经本人同意的一次性挑战，由旧小程序和新小程序分别向后端证明登录，设置短有效期、单次消费、冲突检查和人工复核。优先评审只读历史访问授权。已有新账号资产、活跃订单或重复认领时停止自动处理，单独核对归属。保留原主键与审计记录，不将旧管理员权限随接续移动。新管理员在新身份下单独审批。旧账号无法完成证明时，保留原历史，进入人工流程。正式开放历史在售商品前，核实卖家能否接收订单与消息，避免产生无人处理的交易。[小程序关联与微信上下文](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)

## 下一步最安全的联调顺序

1. **先验证现有探针。** 等新小程序认证和关联可核实后，确认目标 `additional-orangutan-d3abd2399c3`、探针配置 AppID 及代码版本。现有探针若仍限定旧 AppID，先记录现状并单独批准调整。仅用授权开发账号调用，验证两次连续真实调用与非小程序负例，响应只记录身份、常量 RPC、存储的状态和请求号。无可信本次身份、角色错误或 AppID 不匹配即停止。
2. **再验最小结构。** 获准后用上节版本化 DDL 安装空库基线，并通过真实网关测试匿名及普通登录角色不可直读表或冒用业务 RPC。验收合成管理员授权和角色隔离。保留正式 `market` 现有部署。
3. **再接独立业务函数。** 在批准的环境中使用 `cloudfunctions/market` 的锁定依赖，另建 Event 函数 `rehub_market_pg_preview`，入口 `pg-preview.main`，运行时 Nodejs20.19。显式设置 `REHUB_MARKET_BACKEND=postgresql`，`REHUB_MARKET_PG_APP_IDS` 仅放已批准的开发 AppID。限定开发账号来源，不建公开路由或定时任务。未设置开关时独立入口直接拒绝，页面调用不会转到正式 `market`。使用隔离的微信开发者工具目录，核对构建目标、新 AppID 和函数名。

   ```powershell
   $env:TARO_APP_CLOUDBASE_ENV_ID = 'additional-orangutan-d3abd2399c3'
   npm run build:weapp:pg-preview
   Remove-Item Env:TARO_APP_CLOUDBASE_ENV_ID
   ```

   联调产物在 `dist/weapp-pg-preview/`。只在独立开发者工具工程设置已批准的新 AppID 和该构建根目录，源仓的 `project.config.json` 沿用旧配置。

4. **最后验写操作和图片。** 使用合成账号验证发布、收藏、浏览、抢单、取消、聊天未读、评价、举报、审核和 19 页导航。开启图片试验前，确认 `REHUB_MARKET_PG_STORAGE_PREFIX` 和目标桶的所有者规则。要实测攻击者写入其他内部用户的 `incoming/` 前缀被拒绝，正式 `images/`、`avatars/` 只有服务端可写。仓库传统模式存储规则不能直接当作 PG 桶权限。若不能用存储规则绑定上传所有者，先评审服务端签发上传方案。随后用合成图片验证上传、读取、转存和仅临时文件的清理补偿，旧图片只读核对可达性和恢复映射。[CloudBase 文件管理](https://docs.cloudbase.net/storage/sdk) · [PG 存储权限](https://docs.cloudbase.net/storage/pg/introduce)
5. **正式导入与切换单独批准。** 前述验收、清理、回退及历史身份方案完成后，再分别审批历史导入、客户端发布和正式函数切换。本轮只执行了本地准备与云端只读查询。
