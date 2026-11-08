# 第三阶段第三批 Market PostgreSQL 适配

`market` 的 43 个旧 action 均有 PostgreSQL 路径。第三批新增 11 个 action，完善已接入的图片操作。默认仍使用文档数据库。只有服务端设置 `REHUB_MARKET_BACKEND=postgresql` 才启用 PostgreSQL。客户端页面、调用参数和现有配置沿用原项目。

| 范围 | Action | 行为 |
| --- | --- | --- |
| 评价 | `createReview`、`getOrderReview`、`getSellerReviewSummary`、`listSellerReviews` | 只有已完成订单的买家能提交。`UNIQUE(order_id)` 拦住并发重复，重试返回原有 `ALREADY_REVIEWED`。订单双方可查该单评价，卖家统计保留一位小数和最新 20 条列表 |
| 举报 | `createReport`、`getAdminStatus({ includeMyReports: true })` | 同一用户对同一商品仅一条待处理举报，滚动 24 小时最多 10 条。本人只可读取自己的私有记录与处理结果。图片清理记录留在独立类型中 |
| 管理 | `getAdminStatus`、`getAdminNotificationSummary`、`adminListProducts`、`adminTakeDownProduct`、`adminListReports`、`adminResolveReport` | 后端按可信 `APPID` 与 `OPENID` 校验启用的 `admin` 授权。修改 RPC 在数据库中再次校验。管理员下架和订单取消锁同一商品行。举报决定和商品下架同事务提交 |
| 图片 | `finalizeImage`、`discardImages`，以及资料修改、商品发布和编辑、商品删除涉及的图片路径 | 保留 JPEG、PNG、WebP、5 MB 与文件归属校验。未完成的临时清理记录可重试。正式文件清理保留为内部待办及只读预检 |

管理员下架时保留已有订单状态。待确认订单无法继续确认，已确认订单可由参与者取消，且取消不会重新上架已封锁商品。处理已封锁商品上的另一条举报仍可记录决定，商品保留第一次下架的时间、理由和管理员，避免覆盖审核记录。管理列表和本人举报按时间取最新 100 条。

## 图片引用与补偿

- 商品图片和资料头像沿用 `wx.cloud.uploadFile`、`finalizeImage` 及 `cloud://` 文件 ID。订单首图和聊天会话首图沿用商品快照，聊天消息仍只支持文本。数据库迁移保留源 JSON、`cloud://` 引用和历史图片清理记录。真实旧对象与恢复目标的对应关系需通过旧桶清单核对，旧引用可用于对账。
- 临时对象必须位于本环境 `incoming/<内部用户ID>/`。转存前登记带令牌的持久化清理任务。删除响应逐个确认，失败、缺失结果或运行中断可重试。同一用户后续转存最多顺带重试三项到期任务，失败后退避，六次后保留待人工核对。待办不暴露给小程序，也没有新增 `market` action 或定时任务。
- 转存响应失败时将预期正式路径加入内部清理待办。用户放弃正式图片、替换头像、替换商品图片或删除商品时，继续使用事务中的 `image_cleanup` 待办。若应用在首次 `finalizeImage` 前中断，或进程在正式上传完成后退出且来不及登记候选，需通过临时对象生命周期或存储清单对账补偿。
- [正式文件只读预检](formal-cleanup-plan.sql)按当前桶前缀、文件路径及当前头像、商品、订单、聊天快照、历史文档中的引用分类。预检应由迁移所有者本地执行，`$1` 传入已核实的 `cloud://` 前缀。`review_required` 只表示进入人工复核。正式删除执行器尚未实现，落地前需确认旧桶恢复清单并设计删除期间阻止对象重新被引用的机制。

CloudBase PG 数据访问仍通过官方 SDK `app.rdb()`。存储沿用微信原生 SDK。官方文件管理文档说明 PG 模式的底层权限由 RLS 控制。实际目标环境需核对存储模式、内部用户 ID 路径规则、签名和 `cloud://` 读取能力。[CloudBase SDK 文件管理](https://docs.cloudbase.net/storage/sdk) · [CloudBase RPC 权限](https://docs.cloudbase.net/database/postgresql/rpc)

## 文件

- 云函数 `pg-market.js`、`pg-store.js`、`pg-chat.js`、`pg-reviews.js`、`pg-moderation.js`、`pg-images.js` 位于 `cloudfunctions/market`。
- SQL 为 `market-batch-three.sql`、`market-storage.sql`、`formal-cleanup-plan.sql`。
- 测试为 `market-batch-three.test.mjs`、`market-batch-two-native.test.mjs`、`market-batch-one.test.mjs`、`market-test-support.mjs` 和测试命令配置 `package.json`。

## 复测与云端准备

本地空库按 `schema.sql`、`transactions.sql`、`market-batch-one.sql`、`market-batch-two.sql`、`market-batch-three.sql`、`market-storage.sql` 加载。沿用前两批的 PGlite、109 条备份副本及本机 PostgreSQL 17 多会话测试命令。原生数据库会话用于本机争用测试，运行时代码经 CloudBase SDK 网关访问。[复测命令](MARKET-BATCH-TWO.md)

1. 确认新 AppID 审核、与目标环境关联和真机可信微信上下文。梳理需要在新 AppID 单独授予的管理员身份，先用合成账号验证。
2. 获得云端联调授权后，检查目标 schema 和平台角色，评审已有结构的增量 DDL，准备独立事件测试函数与合成数据。核对 `SECURITY INVOKER`、网关返回与错误映射，验证匿名和普通用户直调 RPC 被拒绝。
3. 双端实测并发评价、重复审核、下架与取消、页面红点。核对 `REHUB_MARKET_PG_STORAGE_PREFIX`、同桶上传转存、旧图片读取与恢复清单、失败返回码、部分成功及文件不存在时的幂等语义。存储权限核对后再评审任何实际删除。
4. 联调通过后，再单独评审历史导入、回退方案和生产切换。正式图片删除与旧对象恢复继续独立验收。
