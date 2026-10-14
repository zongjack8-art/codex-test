# 天津师范大学 CloudBase 数据结构

目标环境：`campusmarket-dev-d7e8qkifecb7d51`。需在控制台手动创建 `users`、`products`、`favorites`、`reports`、`conversations`、`messages` 六个集合。校园归属以 `cloudfunctions/market/campus.json` 为唯一配置，云函数写入时固定 `school=天津师范大学`，不相信客户端学校字段。金额以人民币元存储，最多两位小数；时间为 Unix 毫秒时间戳。

六个集合均使用 `cloudbase/rules/` 中相应的规则，禁止客户端直接读写。`market` 云函数使用服务端 SDK 读写，并从 `getWXContext().OPENID` 取得身份。这里用明确的 `sellerId`、`userId`、`reporterId` 字段；不依赖客户端传入或前端伪造 `_openid`。云数据库 `_id` 用于文档唯一性。

## users

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 云函数取得的 OPENID，作为用户唯一 ID |
| `nickname` | string | 2–32 字符；首次登录为“校园同学” |
| `avatar` | string | 默认“同”或 `avatars/<openid>/` 下的云文件 ID |
| `school` | string | 固定“天津师范大学”，客户端不能更改 |
| `campus` | string | 用户填写的通用校内范围，初始“校内”；不代表经过校园身份认证 |
| `bio` | string | 选填简介，最多 160 字符 |
| `createdAt`, `updatedAt` | number | 首次建档时间、最近资料更新时间 |

第一次调用 `login` 会自动创建用户；后续登录读取现有资料。旧版本中不一致的学校和虚构校区会在登录时归一化。`updateProfile` 只更新当前 OPENID 的文档。

## products

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 云数据库自动生成 |
| `sellerId` | string | 云函数从 OPENID 设置，客户端不可指定 |
| `school` | string | 固定“天津师范大学” |
| `title` | string | 2–60 字符 |
| `description` | string | 5–1000 字符 |
| `price`, `originalPrice` | number / null | 0.01–100000 元，最多两位小数；原价可为 null |
| `category` | string | `books`、`digital`、`daily`、`sports`、`fashion`、`other` |
| `condition` | string | 新旧程度，2–20 字符 |
| `images` | string[] | 1–3 个经云函数校验路径、大小和文件头后保存的 `images/` 云文件 ID |
| `location` | string | 校内面交范围，2–80 字符；前端兼容现有 `campus` 字段 |
| `status` | string | `selling`、`sold`、`offline` |
| `createdAt`, `updatedAt` | number | 创建和最近修改时间 |

公共列表只显示本校 `selling` 商品；卖家的“我的发布”展示自己的全部状态。状态流转固定为 `selling → sold/offline`、`offline → selling`；`sold` 为终态，只能删除。编辑仅允许 `selling/offline`。更新状态、编辑和删除均先校验 `sellerId`。旧商品缺少 `status` 或使用 `active` 时，个人列表按在售显示，状态操作按在售处理；缺少 `location`、`createdAt` 时前端使用安全的展示回退，无需清空现有商品。创建限制为每个微信身份每天最多 20 件。删除会清理相关收藏与不再被引用的商品图，但保留聊天会话和消息；若云存储删除失败，写入 `reports` 待处理。

## favorites

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | `SHA-256(userId:productId)`，阻止同一用户重复收藏 |
| `userId` | string | 云函数从 OPENID 设置 |
| `productId` | string | 商品 `_id` |
| `createdAt` | number | 收藏时间 |

`setFavorite` 是幂等状态设置。收藏不能由客户端指定其他用户的 `userId`，仅允许收藏本校在售商品。

## reports

一个集合保留两种记录，不另建审核系统：

- `type=product`：用户举报接口 `createReport` 的预留数据。字段为 `reporterId`（云函数 OPENID）、`productId`、`reason`（`prohibited` / `misleading` / `fraud` / `other`）、`description`（最多 500 字符）、`school`、`status=pending`、`createdAt`、`updatedAt`。当前没有举报页面或管理后台；同一用户对同一商品的待处理举报不重复创建，每天最多 10 次。
- `type=image_cleanup`：图片清理失败的内部待办。字段为 `productId`、`fileIDs`、`reason`、`school`、`status=pending`、`createdAt`、`updatedAt`。管理员需定期检查日志并手动处理。

不要允许客户端读取或直接写入 `reports`。

## conversations

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | `conv_` 加 `SHA-256(buyerId:productId)`；默认 `_id` 唯一索引防止重复会话 |
| `productId` | string | 对应商品 ID；商品删除后仍保留 |
| `buyerId`, `sellerId` | string | 云函数从当前 OPENID 和商品卖家确定；不接受客户端指定 |
| `participantIds` | string[] | 买卖双方 ID，仅用于记录；授权时仍核对 `buyerId` / `sellerId` |
| `productSnapshot` | object | 创建时保存标题、价格、首图和状态，商品删除后仍能显示上下文 |
| `lastMessage`, `lastMessageAt` | string / number | 列表摘要，最近消息最多保留前 80 字 |
| `buyerUnreadCount`, `sellerUnreadCount` | number | 双方独立的未读计数；发送时原子加一，进入会话仅清空自己一侧 |
| `status` | string | 第一版为 `active`，预留会话管理 |
| `createdAt`, `updatedAt` | number | Unix 毫秒时间戳 |

一个买家对同一商品只建立一个会话；卖家不能与自己建立会话。列表每个角色最多读取最近 50 条会话。商品售出、下架或删除时，不删除原有会话和消息；读取时优先展示实时商品状态，商品删除则展示快照和“商品已删除”。

## messages

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 云数据库自动生成 |
| `conversationId` | string | 所属会话 |
| `senderId`, `receiverId` | string | 云函数按 OPENID 与会话参与者确定；客户端字段无效 |
| `type` | string | 第一版固定 `text` |
| `content` | string | 去首尾空白，1–500 字 |
| `createdAt` | number | Unix 毫秒时间戳 |

仅会话买卖双方可通过 `market` 云函数读取或发送消息。每人每会话每分钟最多发送 20 条；聊天页每次读取最近 100 条，15 秒低频刷新。第一版没有聊天图片、文件、已读回执或支付。

## 索引

在云开发控制台“数据库 → 集合 → 索引管理”建立以下组合索引。`_id` 的默认索引无需重复建。控制台中的升/降序选择与下表一致；查询量较小时先创建至少前五项，后续依据实际查询错误和性能补齐。

| 集合 | 字段顺序与方向 | 支持的查询 |
| --- | --- | --- |
| `products` | `school` 升序、`status` 升序、`createdAt` 降序 | 首页、最新排序 |
| `products` | `school` 升序、`status` 升序、`category` 升序、`createdAt` 降序 | 分类最新 |
| `products` | `school` 升序、`status` 升序、`price` 升序 | 低价/高价排序；高价若控制台提示另建降序索引 |
| `products` | `sellerId` 升序 | 我的发布；按可信 OPENID 分批读取后排序，兼容缺少较新字段的旧商品 |
| `favorites` | `userId` 升序、`createdAt` 降序 | 我的收藏 |
| `favorites` | `productId` 升序 | 删除商品时清理收藏 |
| `reports` | `type` 升序、`reporterId` 升序、`productId` 升序、`status` 升序 | 防重复举报 |
| `reports` | `type` 升序、`reporterId` 升序、`createdAt` 降序 | 每日举报次数 |
| `conversations` | `buyerId` 升序、`lastMessageAt` 降序 | 当前买家的最近会话 |
| `conversations` | `sellerId` 升序、`lastMessageAt` 降序 | 当前卖家的最近会话 |
| `messages` | `conversationId` 升序、`createdAt` 降序 | 会话内最近消息 |
| `messages` | `conversationId` 升序、`senderId` 升序、`createdAt` 降序 | 每人每分钟发送次数限制 |

`conversations._id` 已编码买家和商品，唯一性由数据库默认 `_id` 索引保证，无需另建“买家 + 商品”唯一索引。实际控制台如对某个组合查询提示缺索引，按提示补建，并记录在本表。聊天未读总数分批读取双方会话计数，最多扫描每侧 1000 条；运营规模超过此上限前需改为专用聚合统计。

关键词搜索目前对标题和描述做转义后的正则匹配；数据量增加后需引入专用全文索引或搜索服务。商品公共列表上限 50 件、收藏展示 50 件；我的发布按 100 件一批读取当前用户商品。公共列表在大规模运营前需分页。

## 云存储

- `incoming/<openid>/...jpg`：小程序先上传的临时文件，最大 5 MB；云函数校验路径、大小和文件头后删除临时文件。
- `images/<openid>/...jpg|png|webp`：云函数写入的商品正式图片，扩展名取实际识别格式。
- `avatars/<openid>/...jpg|png|webp`：云函数写入的头像。

当前云函数没有图片重编码或元数据清除；文件头检查不能替代完整解码验证。`cloudbase/rules/storage.json` 仅允许客户端向 `incoming/` 上传；正式目录不允许客户端写入。编辑、删除和失败回滚会清理当前卖家目录下的无引用图片。未完成确认的临时上传应设置生命周期清理。
