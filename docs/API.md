# CampusMarket HTTP API 设计（可选适配层）

微信小程序正式模式使用 CloudBase，部署说明见 [CloudBase 部署步骤](CLOUDBASE.md)。本页保留原有 HTTP Service 的接口约定，供未来切换后端使用；当前仓库不包含这些 HTTP 接口的服务端实现。

Base URL 由构建变量 `TARO_APP_API_BASE_URL` 指定。所有接口使用 HTTPS 和 JSON；成功响应统一为 `{ "data": ... }`，失败响应为 `{ "message": "错误说明" }`，并使用合适的 HTTP 状态码。除商品读取外，接口要求 `Authorization: Bearer <token>`。此 HTTP 后端仍未实现；CloudBase 聊天使用下文对应的 `market` action。

## 认证

`POST /auth/wechat/login`：请求 `{ "code": "微信登录临时 code" }`；服务端调用微信 `code2Session`，校验身份并签发短期访问令牌。响应：

```json
{
  "data": {
    "token": "server-issued-token",
    "user": { "id": "user-1", "nickname": "校园同学", "school": "天津师范大学", "campus": "校内", "avatar": "同" }
  }
}
```

客户端不发送或存储微信 AppSecret。生产环境应补充令牌刷新与登出失效接口。

## 商品

| 方法与路径 | 说明 | 请求/响应 |
| --- | --- | --- |
| `GET /products` | 查询在售商品 | 可选 `keyword`、`category`、`sort=newest/priceAsc/priceDesc`；返回 `Product[]` |
| `GET /products/:id` | 商品详情 | 返回 `Product`，不存在返回 404 |
| `POST /products` | 发布商品 | 请求 `ProductInput`；返回新建 `Product` |
| `GET /me/products` | 我的发布 | 返回当前用户 `Product[]`，包括已售出 |
| `PATCH /products/:id` | 编辑商品或更新状态 | 状态为 `selling`、`sold` 或 `offline`；只允许卖家操作 |
| `DELETE /products/:id` | 删除商品 | 只允许卖家操作；成功返回 `{ "data": null }` |

用户资料接口：`GET /me` 返回当前用户；`PATCH /me` 接收昵称、头像、常用校内范围和简介并返回更新后的用户。学校由服务端固定为天津师范大学，不能由客户端修改。HTTP 服务端必须自行验证 Bearer 令牌及资源所有权。

`Product` 字段见 `src/types/market.ts`。当前 CloudBase 实现用人民币元和最多两位小数，图片保存为 `cloud://` 文件 ID；本页所述可选 HTTP 后端可自行改用整数分和 HTTPS 图片地址，但须在 Service 边界转换。商品图片最多 3 张。服务端必须重新验证标题、描述、价格、图片、分类和面交范围。

## 收藏

| 方法与路径 | 说明 | 响应 |
| --- | --- | --- |
| `GET /me/favorites/ids` | 收藏 ID 列表 | `string[]` |
| `GET /me/favorites` | 收藏商品列表 | `Product[]` |
| `POST /products/:id/favorite` | 切换收藏状态 | `{ "favorited": boolean }` |

正式后端建议改为幂等的 `PUT`/`DELETE` 收藏接口，避免重复请求导致状态反转；当前 Service 接口与 Mock 实现一致。

## 站内消息

`src/services/chat.ts` 在 Cloud 模式调用 `market` 的 `startConversation`、`listConversations`、`getConversation`、`listMessages`、`sendMessage`、`markConversationRead`、`getUnreadMessageCount`。若将来实现 HTTP 适配层，需提供以下路径，且服务端必须核验令牌中的真实用户及会话参与资格：

| 方法与路径 | 对应功能 |
| --- | --- |
| `POST /me/conversations` | 用 `productId` 创建或复用买家会话 |
| `GET /me/conversations` | 当前用户的会话列表 |
| `GET /me/conversations/unread-count` | 当前用户未读总数 |
| `GET /me/conversations/:id` | 会话和商品摘要 |
| `GET /me/conversations/:id/messages` | 会话消息 |
| `POST /me/conversations/:id/messages` | 发送 1–500 字文字，提交 `{ content }` |
| `POST /me/conversations/:id/read` | 只清空当前用户一侧未读数 |

HTTP 请求中的买家、卖家、发送者、收件人和未读数字段不能决定真实归属。商品删除后仍保留已有会话和商品快照；不提供站内支付。

## 图片上传

`POST /uploads/images`：`multipart/form-data`，文件字段 `file`，Bearer 认证。响应 `{ "data": { "url": "https://..." } }`。服务端限制文件大小、MIME 类型、数量，重编码并移除元数据；返回可供微信小程序访问的 HTTPS 地址。
