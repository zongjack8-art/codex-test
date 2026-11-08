# 第三阶段第一批 Market PostgreSQL 适配

本批保留 `index.main` 和 `{ ok, data }` / `{ ok, error }` 契约。项目 AppID、Taro 配置和 19 个页面沿用现有文件。默认 `market` 走原有文档数据库实现，旧版全部 action 可用。只有事件函数环境变量 `REHUB_MARKET_BACKEND=postgresql` 才启用本批，PG 模式遇到尚未适配的 action 返回 `INVALID_ACTION`。

## 本地实现

| 范围 | Action | PostgreSQL 路径 |
| --- | --- | --- |
| 登录与资料 | `login`、`updateProfile` | 以微信上下文的 `(APPID, OPENID)` 查找身份。第一次登录在同一事务建用户和身份，资料写入按内部用户 ID 锁定 |
| 商品 | `listProducts`、`getProduct`、`getMyProducts`、`createProduct`、`updateProduct`、`setProductStatus`、`deleteProduct` | SDK 读表。搜索、发布限额、预留状态检查和修改走受限 RPC。删除保留历史商品引用，同时清除收藏 |
| 收藏 | `getFavoriteIds`、`getFavorites`、`setFavorite` | SDK 读表。收藏和取消通过事务完成，同一用户与商品不重复，保留数量上限 |
| 浏览 | `recordProductView`、`listRecentViews`、`clearRecentViews` | 同一用户和商品去重，置顶访问与修剪在一个事务里执行。清理仅作用于当前身份和学校 |
| 图片辅助 | `finalizeImage`、`discardImages` | 原生微信存储接口完成临时图片校验和转存。正式文件的释放写入已有清理待办，待独立清理流程复查引用后处理 |

公开商品列表仍为前 50 条，支持标题和描述字面关键词、分类、价格下界含上界不含、价格与时间排序。该 action 仍没有客户端分页参数。「我的发布」在后端使用 100 条一页读取所有结果。相同排序值使用商品 ID 作为固定次序。返回列表不包含卖家内部 ID，详情保留原字段形状并返回内部 ID 和 `viewerIsSeller`。

`pg-store.js` 封装官方 `@cloudbase/js-sdk` v3 的 `app.rdb()` 查询与命名参数 RPC。`pg-market.js` 在初始化访问层前核对可信小程序身份，忽略请求中的身份字段。RPC 使用 `SECURITY INVOKER` 并检查数据库有效角色。用户输入经现有校验器处理，数据库事务复查商品所有权和状态。服务端响应只返回内部 ID 或已允许的业务字段，错误日志不回显 SDK 原始异常。CloudBase 事件函数使用当前环境的运行时凭证。[SDK 初始化](https://docs.cloudbase.net/api-reference/webv3/initialization) · [RPC 权限模型](https://docs.cloudbase.net/database/postgresql/rpc)

## 本地验证

```powershell
$env:REHUB_TEST_BACKUP_DIR = 'D:\青拾rehub'
npm --prefix scripts/pg-migration test
Remove-Item Env:REHUB_TEST_BACKUP_DIR
npm run test:cloud
npm run typecheck
```

测试运行 PostgreSQL 17，加载第二阶段的 `schema.sql`、`transactions.sql` 以及本批 `market-batch-one.sql`。使用 `service_role` 执行真实 SQL，模拟 CloudBase SDK 传输和微信存储。未配置 `REHUB_TEST_BACKUP_DIR` 时跳过真实备份副本的迁移回归，其余测试使用合成数据。

## 云端待验收

- 新 AppID `wxd07e4ed740dcd392` 完成认证和环境关联后，先实测独立探针的可信微信上下文及网关调用。PG 试验函数只在经确认的环境设置 AppID 白名单 `REHUB_MARKET_PG_APP_IDS`，允许多个时以逗号分隔。
- 获得云端操作授权后，验证 SHARED 实例中的 DDL、`service_role`、SDK 返回格式、RPC 错误映射、跨会话锁及权限拒绝。先用合成数据联调，再单独评审历史导入和业务切换。
- 核对原生 `wx.cloud.uploadFile`、云函数存储接口与当前桶的兼容性，设置经验证的文件 ID 前缀 `REHUB_MARKET_PG_STORAGE_PREFIX`。新文件的路径使用内部用户 ID。已有图片和头像可以按原记录保留，旧桶读取与正式对象清理待实测。
- 下一批优先接入订单和聊天 action，复用第二阶段的事务约束。随后接入举报、评价、管理员及带引用复查的正式图片清理。完成前保留原函数与原环境作为回退路径。
