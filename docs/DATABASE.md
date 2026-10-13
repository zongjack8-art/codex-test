# CloudBase 数据结构

使用微信云开发“文档型数据库”。在目标 envId 的控制台手动创建以下四个集合；本仓库不能代替控制台创建。所有集合的客户端安全规则均为 `read: false, write: false`，对应文件位于 `cloudbase/rules/`。页面只通过 `market` 云函数访问数据，云函数使用服务端 SDK 权限。时间字段为 Unix 毫秒时间戳，价格单位为人民币元，限定两位小数。

## users

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 微信上下文 OPENID，唯一身份，云函数生成 |
| `nickname` | string | 2–32 字符 |
| `avatar` | string | 默认头像或 `avatars/` 云文件 ID |
| `school` | string | 2–60 字符 |
| `campus` | string | 2–60 字符 |
| `createdAt`, `updatedAt` | number | 毫秒时间戳 |

首次 `login` 会自动创建默认资料。客户端提交的 ID 不参与建档。

## products

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 云数据库自动生成 |
| `sellerId` | string | 当前云函数上下文 OPENID，客户端不可指定 |
| `title` | string | 2–60 字符 |
| `description` | string | 5–1000 字符 |
| `price`, `originalPrice` | number / null | 0.01–100000 元，最多两位小数；原价可为 null |
| `category` | string | `books` / `digital` / `daily` / `sports` / `fashion` / `other` |
| `condition` | string | 新旧程度，2–20 字符 |
| `images` | string[] | 1–3 个由云函数重编码生成的 `images/` 文件 ID |
| `location` | string | 交易地点，2–80 字符；前端映射至现有 `campus` 字段 |
| `status` | string | `selling` / `sold` / `offline` |
| `createdAt`, `updatedAt` | number | 毫秒时间戳 |

建议创建组合索引：`status + createdAt`（降序）、`status + category + createdAt`（降序）、`sellerId + createdAt`（降序）、`status + price`。搜索使用标题和描述的正则查询；数据量增长后应迁移到专用全文索引或搜索服务。列表目前最多返回 50 件，我的发布最多 100 件，收藏最多展示 50 件；后续需增加分页。

## favorites

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | `SHA-256(userId:productId)`，从结构上防止重复收藏 |
| `userId` | string | 当前云函数上下文 OPENID |
| `productId` | string | 商品 `_id` |
| `createdAt` | number | 毫秒时间戳 |

建议创建 `userId + createdAt`（降序）和 `productId` 索引。`setFavorite` 是幂等写操作，商品删除时云函数清理相应收藏。

## reports

预留用户举报用途；当前云函数仅在图片清理失败时写入内部记录：`type=image_cleanup`、`status=pending`、`productId`、`fileIDs`、`reason`、`createdAt`。管理员应定期检查并重试这些记录。请勿将内部记录开放给客户端读取。

## 云存储目录

- `incoming/<openid>/...`：客户端临时上传，仅同一微信身份可写，最大 5 MB。
- `images/<openid>/...jpg`：云函数验证并重编码后的商品图。
- `avatars/<openid>/...jpg`：云函数验证并重编码后的头像。

存储自定义规则位于 `cloudbase/rules/storage.json`。云函数会在完成验证后清理临时文件；商品删除或编辑移除图片时清理正式图片。失败会写入 `reports` 待人工处理。建议另设临时目录生命周期清理策略。
