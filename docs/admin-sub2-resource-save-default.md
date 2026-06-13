# Admin Sub2 资源凭据默认保存策略

## 背景

生产可用性复查显示，Codex 反代的真实阻断不是前端或基础服务不可达，而是：

- Sub2 默认 OpenAI 分组没有 active 上游账号。
- 本地没有 active OpenAI refresh token 资源凭据。
- 没有 ready online production Codex shared resource。
- 最新 `/v1/responses` 端到端 smoke 仍返回 503。

管理员拿到新的 OpenAI refresh token 后，需要在同一条修复链路里完成：应用到 Sub2、同步成本地共享资源凭据、运行 smoke、再将可交付资源上线。

## 新策略

Admin 的 Sub2 反代状态页现在通过 `sub2RepairContextShouldSaveToResource` 统一决定 `Apply OpenAI Credentials` 表单是否默认勾选“保存为共享资源凭据”。

默认勾选的场景：

- 修复上下文已经定位到 Codex 共享资源 ID。
- 健康巡检定位到 `apply_openai_refresh_token_to_sub2_account`，并携带供给方邮箱，且资源类型为 `codex` 或未指定资源类型。
- `resources`、`resourceCredentials`、`productCatalog`、`salesDelivery`、`localProxySmoke`、`sub2`、`proxyRequests` 等修复上下文携带供给方邮箱，且没有明确指向非 Codex 资源。

不会默认勾选的场景：

- 上下文明确指向非 Codex 资源，例如 `claude_code`。
- 只有 Sub2 账号 ID，没有供给方邮箱或资源 ID。

## 管理价值

当前生产 `resources` / `resourceCredentials` 健康告警已经能带出 `supplierEmail=admin@zhisuan.local`、`sub2AccountId=2` 和 Codex 修复动作。管理员从告警进入 Sub2 反代状态页后，只需要粘贴有效 OpenAI refresh token，表单会默认同时保存本地资源凭据，避免只修复 Sub2 账号却仍然没有可交付 Codex 共享资源。

该策略也避免非 Codex 资源误触发 OpenAI refresh token 同步，减少后端资源类型校验失败带来的操作噪声。

## 验证

- `pnpm.cmd --filter @zyz/admin test`
- `pnpm.cmd --filter @zyz/admin typecheck`

单测覆盖了生产资源缺失上下文、已有 Codex 资源、非 Codex 资源、仅 Sub2 账号和 local proxy smoke 上下文的默认行为。
