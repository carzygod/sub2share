# 管理员订单反代请求排障

实现日期：2026-06-10

## 背景

管理员处理售出订单售后时，除了订单状态、钱包流水和租赁交付，还需要判断用户的 OpenAI/Codex 请求是否实际到达本地反代、是否被本地门禁拦截、Sub2API 返回了什么状态码，以及是否出现客户端断开或上游流异常。

此前这些信息只在全局 `反代请求` 页面，需要管理员复制租赁 ID 或 Key 前缀手动筛选。本次把订单关联的反代请求直接带入订单详情。

## 后端接口

- 增强接口：`GET /api/admin/orders/:id`
- 权限要求：`operator` 或 `admin`
- 响应新增：
  - `proxyRequests`：该订单所有租赁最近 50 条本地 OpenAI/Codex 反代请求日志。
  - `proxyRequestSummary`：该订单关联反代请求数量。
- 查询条件使用订单下租赁关联的 `ProxyRequestLog.rentalId`，不依赖用户手工输入搜索词。

## 管理员入口

管理后台订单详情增强：

- 详情摘要新增 `反代请求` 数量。
- 新增 `最近反代请求` 区块。
- 每条请求展示本地状态码、上游状态码、错误码、方法、路径、模型、租赁/商品、Key 前缀、耗时、请求大小、估算输入 tokens 和时间。

## 验收方式

本地验证：

- `npm --prefix user/apps/api run typecheck`
- `npm --prefix user/apps/admin run typecheck`
- `npm --prefix user/apps/api run build`
- `npm --prefix user/apps/admin run build`

功能验证建议：

1. 打开有 Codex 租赁的订单详情。
2. 使用该订单下的 API Key 调用 `/v1/models` 或 `/v1/responses`。
3. 重新打开订单详情，确认 `最近反代请求` 出现对应记录。
4. 核对 `x-proxy-request-id` 对应的请求 ID 是否能在全局 `反代请求` 页面搜索到同一记录。
