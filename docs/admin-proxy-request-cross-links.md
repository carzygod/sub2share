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

## 验证

- `pnpm.cmd --filter @zyz/api run typecheck`
- `pnpm.cmd --filter @zyz/admin run typecheck`
- `pnpm.cmd --filter @zyz/api test`
- `pnpm.cmd --filter @zyz/admin test`
- `pnpm.cmd build`
