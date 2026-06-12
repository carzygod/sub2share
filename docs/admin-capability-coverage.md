# 管理员入口能力覆盖检查

## 背景

系统目标要求管理员能够完整管理用户情况、共享情况、余额情况、售出情况，并能复查基于 Sub2API 的 OpenAI/Codex 反代链路。过去这些能力分散在后台路由、前端页面和文档中，缺少一个机器可读的覆盖依据。

## 实现

- 新增 `user/apps/api/src/modules/admin/capabilities.ts`。
- 能力矩阵按管理范围声明：
  - `users`：用户列表、详情、创建、资料、状态、角色管理。
  - `sharing`：供给方、共享资源、资源状态、Sub2 账号测试、凭据加密保存与应用。
  - `wallets`：钱包列表、详情、流水、余额调整、账务对账。
  - `sales`：售出订单、订单详情、取消、退款、重试交付、租赁通道、API Key、用量同步。
  - `openaiProxy`：反代请求、Sub2 状态、绑定巡检/修复、账号刷新/测试、端到端冒烟测试。
  - `governance`：仪表盘、系统健康、维护、审计、商品、结算和提现。
- 新增 `GET /api/admin/capabilities`，返回能力矩阵和当前 Fastify 路由覆盖结果。
- `GET /api/admin/system-health` 新增 `adminCapabilities` 检查项，会用 Fastify `hasRoute()` 核对矩阵声明的端点是否已注册。
- Admin 前端新增 `入口能力` 页面，直接读取并展示 `GET /api/admin/capabilities` 的覆盖摘要、能力范围、操作列表和缺失路由问题。
- 独立说明见 `docs/admin-capability-matrix-view.md`。

## 健康判定

`adminCapabilities` 检查项为 `ok` 的条件：

- 五个必需范围 `users`、`sharing`、`wallets`、`sales`、`openaiProxy` 都在矩阵中声明。
- 矩阵声明的每个后台操作都存在匹配的 Fastify 路由。
- 缺失路由会返回 `operation_route_missing` error，并带上 `method`、`path`、`operationId` 和修复建议。

## 验证

新增测试：

- `admin capability matrix covers the required management areas`
- `admin capability coverage reports missing declared routes`
- `registered admin routes cover the declared capability matrix`
- `admin navigation exposes the objective-critical entry points` 覆盖 `capabilities` 入口。

这些测试确保能力矩阵覆盖核心管理范围，并且实际注册的后台路由与矩阵保持一致。
