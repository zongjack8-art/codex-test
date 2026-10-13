# CampusMarket API 设计

Base URL 由构建变量 `TARO_APP_API_BASE_URL` 指定。所有接口使用 HTTPS 和 JSON；成功响应统一为 `{ "data": ... }`，失败响应为 `{ "message": "错误说明" }`，并使用合适的 HTTP 状态码。除商品读取外，接口要求 `Authorization: Bearer <token>`。分页、内容审核和聊天接口可在后续版本加入。

## 认证

`POST /auth/wechat/login`：请求 `{ "code": "微信登录临时 code" }`；服务端调用微信 `code2Session`，校验身份并签发短期访问令牌。响应：

```json
{
  "data": {
    "token": "server-issued-token",
    "user": { "id": "user-1", "nickname": "校园同学", "campus": "北区校区", "avatar": "🎓" }
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
| `PATCH /products/:id` | 更新状态 | 请求 `{ "status": "available" 或 "sold" }`；只允许卖家操作 |
| `DELETE /products/:id` | 删除商品 | 只允许卖家操作；成功返回 `{ "data": null }` |

`Product` 字段见 `src/types/market.ts`。金额单位为人民币元，后端建议使用整数分存储并在边界转换；客户端当前以元显示。`images` 是 HTTPS URL 数组，最多 3 张。服务端必须重新验证标题、描述、价格、图片、分类和校区。

## 收藏

| 方法与路径 | 说明 | 响应 |
| --- | --- | --- |
| `GET /me/favorites/ids` | 收藏 ID 列表 | `string[]` |
| `GET /me/favorites` | 收藏商品列表 | `Product[]` |
| `POST /products/:id/favorite` | 切换收藏状态 | `{ "favorited": boolean }` |

正式后端建议改为幂等的 `PUT`/`DELETE` 收藏接口，避免重复请求导致状态反转；当前 Service 接口与 Mock 实现一致。

## 图片上传

`POST /uploads/images`：`multipart/form-data`，文件字段 `file`，Bearer 认证。响应 `{ "data": { "url": "https://..." } }`。服务端限制文件大小、MIME 类型、数量，重编码并移除元数据；返回可供微信小程序访问的 HTTPS 地址。
