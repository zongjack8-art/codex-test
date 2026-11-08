# 第三阶段第二批 Market PostgreSQL 适配

`market` 默认继续使用文档数据库。只有服务端显式设置 `REHUB_MARKET_BACKEND=postgresql` 时，订单与聊天才通过 CloudBase SDK `app.rdb()` 访问 PostgreSQL。身份由可信微信 `APPID` 和 `OPENID` 查询得到内部用户 ID。旧、新 AppID 之间的资料、商品归属、订单、聊天和管理员授权各自独立。

## 接口与事务

| 范围 | Action | PostgreSQL 行为 |
| --- | --- | --- |
| 订单 | `createOrder`、`listOrders`、`getOrder`、`confirmOrder`、`cancelOrder`、`completeOrder` | 查询按参与者授权。写操作锁定商品后处理订单，卖家确认一笔后关闭同商品的其余待确认订单。历史商品名称、价格、首图引用来自订单快照 |
| 订单提醒 | `getOrderUnreadSummary`、`markOrdersRead` | 跨全部订单汇总买家和卖家的未读。批量已读只更新当前用户在请求角色下的订单 |
| 聊天 | `startConversation`、`listConversations`、`getConversation`、`listMessages`、`sendMessage` | 同一买家与商品复用会话。发送限频为每个会话中每位参与者每分钟 20 条。消息写入、会话摘要和收件方未读同一事务提交 |
| 聊天提醒 | `markConversationRead`、`getUnreadMessageCount` | 发送和标记已读竞争同一会话行。先提交的发送可被后续已读清除，后提交的发送产生新未读。总数汇总当前用户两种角色的全部会话 |

`listMessages({ id })` 仍返回最新 100 条并按时间正序排列。可选的 `before` 接收上一页第一条消息的 ID，向前读取更早一页。相同毫秒以消息 ID 作为稳定排序依据，游标限定在当前会话。现有页面继续使用原调用与轮询。消息总数由 SQL 聚合，超过旧实现每个角色 1,000 个会话的扫描范围时也会计入。

早期没有 `reserved_at` 的已确认订单可按旧规则处理仍在售的商品。商品被手动标售或软删除后，订单仍可取消并保留快照。管理员下架已预留商品后，卖家可软删除该商品，取消订单时也不会重新上架。仍处于 `reserved` 的商品继续禁止删除。

## 本地复测

```powershell
$env:REHUB_TEST_BACKUP_DIR = 'D:\青拾rehub'
npm --prefix scripts/pg-migration test
Remove-Item Env:REHUB_TEST_BACKUP_DIR
npm run test:cloud
npm run typecheck
```

PGlite 套件使用真实 SQL 和角色权限，CloudBase SDK 传输由本地模拟器代替。备份测试使用临时副本，核对 109 条记录及外键关系。独立多会话测试需要 PostgreSQL 17 的 `initdb`、`pg_ctl`、`postgres`，以及一个可解析 `pg` 包的本地目录。

```powershell
$env:REHUB_TEST_PG_BIN = '<PostgreSQL 17 bin 目录>'
$env:REHUB_TEST_PG_DRIVER = '<含 pg 依赖的目录>'
npm --prefix scripts/pg-migration run test:concurrency
Remove-Item Env:REHUB_TEST_PG_BIN, Env:REHUB_TEST_PG_DRIVER
```

多会话测试只使用合成数据，在临时目录启动仅监听 `127.0.0.1` 的 PostgreSQL，并通过 `pg_blocking_pids` 确认独立会话之间发生锁等待。测试结束后关闭实例并清理临时数据。

## 云端验收条件

- 在 SHARED 环境核对事件函数的 `service_role`、RPC 标量和 JSON 返回格式、错误映射，以及匿名和普通用户经实际网关被拒绝。所有业务 RPC 使用 `SECURITY INVOKER`，函数体检查数据库角色，具体资源操作另校验参与者。业务表权限和 RLS 仍需在目标环境核对。[CloudBase RPC 权限](https://docs.cloudbase.net/database/postgresql/rpc) · [SDK RPC](https://docs.cloudbase.net/api-reference/webv3/postgresql/rpc)
- 在获得授权后，用独立事件函数与合成交易验证新 AppID 的真实微信上下文、双端抢单、聊天与已读交错，以及小程序轮询红点。用旧 AppID 与新 AppID 分别验证会话和订单隔离。
- 本地新建库按 `schema.sql`、`transactions.sql`、`market-batch-one.sql`、`market-batch-two.sql` 加载。若目标环境已有前一版结构，先查现存函数、约束和索引，再单独准备增量变更并评审。历史订单首图仍受原存储访问权限约束。
