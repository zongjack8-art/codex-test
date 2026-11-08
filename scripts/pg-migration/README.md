# 青拾 ReHub PostgreSQL 第二阶段

本目录包含数据库设计和本地演练工具。页面、Taro 构建、旧小程序和现有 `market` 接口仍沿用原实现。SQL 文件位于独立目录，等候单独评审后再进入 CloudBase 迁移流程。

## 数据模型

十个原集合映射到十张 `public.rehub_*` 业务表。金额用精确 `numeric` 校验人民币元及最多两位小数，时间保留 Unix 毫秒，业务文档 ID 保留为 `text`。评价的扩展 JSON `$oid` 转成字符串 ID，原对象仍保存在历史文档中。字段、约束和索引的完整定义在 [schema.sql](schema.sql)。

| 源集合 | 目标表 | 关系及主要约束 |
| --- | --- | --- |
| `users` | `rehub_users` | 内部用户 ID 独立于 OPENID。保留昵称、头像、学校、校区、简介和时间 |
| `admins` | `rehub_admins` | 绑定到精确的 AppID 与 OPENID 组合，同一身份只有一条管理员记录 |
| `products` | `rehub_products` | 关联卖家和商品引用。保留图片、价格、分类、审核字段和状态，商品下架或软删除后仍可保留历史 |
| `orders` | `rehub_orders` | 商品和卖家组合外键，买家外键。每个买家对同一商品只有一笔活跃订单，同一商品最多一笔已确认订单 |
| `conversations` | `rehub_conversations` | 关联买卖双方及稳定商品引用。每个买家与商品仅一条会话，保留商品快照、最后消息和双方未读数 |
| `messages` | `rehub_messages` | 复合外键约束发送方与接收方正好是该会话的双方。只接受非空文本 |
| `favorites` | `rehub_favorites` | 关联用户和商品，限制每个组合只收藏一次 |
| `recentViews` | `rehub_recent_views` | 关联用户和商品，每个组合保留一个最近浏览时间 |
| `reports` | `rehub_reports` | 商品举报关联举报人、商品和处理人。待处理商品举报去重。图片清理待办区分商品、头像和废弃上传 |
| `reviews` | `rehub_reviews` | 复合外键匹配已完成订单的商品与买卖双方，每笔订单只能评价一次，评分为 1–5 |

三张辅助表用于身份、历史引用和对账。

- `rehub_wechat_identities` 以 `(app_id, open_id)` 为主键。迁移从旧 AppID `wxdb3e3d718940eae6` 和旧 OPENID 生成稳定内部 ID，所有历史引用指向这些内部 ID。新 AppID `wxd07e4ed740dcd392` 没有导入的身份。以后只有服务端可信微信身份验证通过，才可单独评审账号绑定。管理员授权仍按具体微信身份核对。
- `rehub_product_refs` 保留商品引用。备份中有 1 个商品已缺失的会话及其 2 条消息，用同一商品 ID 和会话快照保留历史。15 条真实商品之外没有补造商品记录。
- `rehub_legacy_documents` 保存 109 条原始文档的 JSON 内容，用于逐条核对和回放。仅迁移所有者可读取，应用运行角色也没有读取权限。原始备份仍独立保留。

商品索引覆盖学校、状态、分类、价格和卖家列表。订单、会话、消息和评价的索引覆盖角色列表、未读数和按时间查询。`active` 和缺失的商品状态映射为 `selling`，`removed` 映射为 `offline`，旧订单缺失未读字段按 `false` 处理。原值及字段是否缺失仍可在历史文档核对。

## 事务和安全边界

[transactions.sql](transactions.sql) 提供本地验证用的四个 `SECURITY INVOKER` RPC。订单创建、确认、完成和取消按相同顺序锁定商品行，再处理订单。确认与商品进入 `reserved`、关闭其余待确认订单同事务提交。延迟约束核验提交时的商品与订单状态。备份已有 2 笔待确认订单对应下架商品，保留原状并允许取消，阻止对下架商品新建或确认订单。旧版无 `reserved_at` 的已确认订单按原有兼容逻辑处理。

发送消息和标记已读串行更新同一会话行。发消息与更新摘要、增加收件方未读数同事务提交。标记已读只清当前参与方计数。历史计数直接保留，消息存档没有足够信息重新计算历史已读状态。

业务表启用 RLS，客户端角色没有直读写权限。RPC 在函数体核对 `current_user = 'service_role'`，再检查具体业务归属。后续由事件云函数从可信微信上下文解析 AppID、OPENID 和内部用户 ID，RPC 的 `p_actor_id` 只能由该服务端传入。调用路径为 `@cloudbase/js-sdk` Node.js 端 `app.rdb()`，普通读取走表查询，事务写入走单次 `.rpc()`。已部署探针仍待新小程序的运行时验证。

[CloudBase SDK RPC](https://docs.cloudbase.net/api-reference/webv3/postgresql/rpc) · [CloudBase RPC 权限模型](https://docs.cloudbase.net/database/postgresql/rpc)

## 本地演练

在仓库根目录执行。需要 Node.js 20.19 或更高版本。将示例路径换成本机备份目录。

```powershell
npm --prefix scripts/pg-migration ci --ignore-scripts --no-audit --no-fund
npm --prefix scripts/pg-migration run simulate -- 'D:\青拾rehub'
$env:REHUB_TEST_BACKUP_DIR = 'D:\青拾rehub'
npm --prefix scripts/pg-migration test
Remove-Item Env:REHUB_TEST_BACKUP_DIR
```

脚本把 10 个文件逐一复制到系统临时目录，核对 SHA-256 后解析副本，支持数组、单对象和逐行 JSON。PGlite 使用进程内 PostgreSQL。脚本导入两次，逐表核对业务字段和原始 JSON，最后清理临时副本并再次核对原始文件哈希。测试没有配置备份目录时，使用合成数据覆盖事务和约束。输出只包含集合计数或脱敏错误码。

`buildImportSql()` 生成一条原子的 `DO` 语句，锁定目标表，拒绝向已有数据的目标混入另一份快照。完全相同的回放通过校验且不写入。源或目标有冲突时整次失败并保留目标原状。该语句在本地只存在于内存。内部 Base64 用于安全引用 JSON，仍包含敏感备份内容，禁止将语句放入 Git 或诊断日志。

## 后续云端评审

1. 等新 AppID 认证和关联确认后，用独立事件探针验证可信 AppID、OPENID 和 PostgreSQL 网关调用。账号绑定与业务上线需各自验收。
2. 获准后检查目标 schema、平台角色、迁移 API 的事务及请求大小限制，再应用 DDL。导入走授权的 PostgreSQL 管控面，验证完整快照后再决定是否执行。现有导入函数无云端连接选项。若单条语句超过平台限制，先评审受限暂存和原子切入方案。
3. 云端联调需补验证 `anon` 和 `authenticated` 的真实网关拒绝、事件运行时的 `service_role`、两个并发连接抢单，以及消息发送与已读交错。PGlite 覆盖约束、顺序和失败回滚，单实例测试未验证 CloudBase 多会话行为。
4. 在后续业务接入中实现身份解析、原 API 适配和其余读写操作，核验旧图片 `fileID` 的实际可读性。图片引用已保留，文件对象尚未复制。确认测试和权限隔离后，再评审业务流量切换。
