# 管理员反代请求横向钻取

实现日期：2026-06-12

## 背景

全局 `反代请求` 列表已经可以按 request id、上游 request id、用户、租赁、Key、模型、路径和错误码筛选 OpenAI/Codex 代理日志。此前列表行主要用于读取和复制请求 ID，管理员从一次失败请求继续定位用户、售出订单、租赁交付、API Key、商品或用量记录时，仍需要手工复制关联 ID 再切换页面搜索。

## 已实现范围

- `GET /api/admin/proxy-requests` 的租赁关联信息新增 `orderId` 与 `productId`。
- 管理后台 `反代请求` 列表新增 `操作` 列。
- 每条反代请求可按已有关联 ID 打开：
  - 用户管理。
  - 订单管理并进入订单详情。
  - 租赁管理并进入租赁详情。
  - API Key 管理。
  - 商品配置。
  - 用量记录列表。
- 用量入口优先使用 `upstreamRequestId`，没有上游 ID 时回退使用本地 `requestId`。

## 管理价值

- 管理员从一次 OpenAI/Codex 失败请求即可继续排查用户、售出、租赁、Key、商品和用量。
- 系统健康页、订单详情、租赁详情和全局反代请求列表之间的排障路径更短。
- 复用既有列表筛选、详情加载和权限边界，不新增绕过后台入口的隐藏操作。

## 2026-06-13 扩展：上游失败日志直达反代状态修复

- `反代请求` 列表行新增条件动作：`反代状态`。
- 该动作只在日志指向上游或代理可用性问题时显示：
  - 上游 HTTP 状态码 `>=400`。
  - 客户端最终状态码 `>=500`。
  - `errorCode` 以 `upstream_` 开头。
  - `errorCode` 为 `upstream_timeout`、`upstream_unavailable`。
  - `errorCode` 为 `upstream_stream_error`、`upstream_stream_closed`、`upstream_stream_idle_timeout`。
- 点击后会打开 `反代状态` 页，并带入 request id、日志 id、上游 request id、路径、状态码、错误码和模型。
- `/v1/responses` 失败会在修复上下文中标记 `responsesOk=false`，便于管理员应用 OpenAI refresh token 后直接运行端到端 smoke。
- 本地准入拒绝，例如 `missing_api_key`，不会展示该动作，避免把用户侧或本地 Key 问题误判为 Sub2/OpenAI 上游凭据问题。

这样管理员从首页阻断卡片进入失败日志后，可以在同一行继续进入 Sub2/OpenAI 凭据修复，不需要再回到完整巡检页面复制失败证据。

## 2026-06-13 扩展：失败日志携带租赁 Sub2 交付上下文

- `GET /api/admin/proxy-requests` 的租赁关联信息新增 `sub2UserId`、`sub2KeyId` 和 `endpointUrl`。
- `反代请求` 搜索现在支持直接按 Sub2 User ID、Sub2 Key ID 或 endpoint URL 定位日志。
- `反代请求` 列表的“租赁 / Key”列展示 Sub2 Key 或 endpoint 低敏线索。
- CSV 导出新增 `sub2UserId`、`sub2KeyId` 和 `endpointUrl` 列。
- 上游失败日志打开 `反代状态` 时，会把租赁 ID、资源类型、Sub2 用户、Sub2 Key 和 endpoint 带入 `修复定位`。
- `反代状态 -> 修复定位` 新增 `租赁通道` 与 `Sub2 Key` 两行，便于管理员确认本次失败对应的售出交付对象。

这样管理员可以从一条 `/v1/responses` 失败日志直接确认“本地 request id / 上游 request id / 租赁 / Sub2 Key / endpoint”，再进入 OpenAI refresh token 修复和 smoke 验收。

## 验证

- `pnpm.cmd --filter @zyz/api run typecheck`
- `pnpm.cmd --filter @zyz/admin run typecheck`
- `pnpm.cmd --filter @zyz/api test`
- `pnpm.cmd --filter @zyz/admin test`
- `pnpm.cmd build`
