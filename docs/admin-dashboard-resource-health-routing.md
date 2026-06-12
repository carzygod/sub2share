# 管理员首页共享资源巡检入口优化

实现日期：2026-06-12

## 背景

当前线上阻断同时包含 Sub2/OpenAI 上游无 active 账号、无可应用资源凭据，以及没有线上 Codex 共享资源。`resources` 巡检项会携带 `repairAction=apply_openai_refresh_token_to_sub2_account` 和 `sub2AccountId`，但它的直接业务含义是“需要补齐生产共享资源”。此前管理员从首页点击该项时会先进入 `反代状态`，导致处理共享资源缺口时还要再切换到 `共享资源` 页面。

## 新增能力

- Admin 首页对 `resources` 关键巡检项增加资源入口优先级。
- 当 `resources.primaryIssue` 或 `resources.primarySample` 携带 `supplierEmail`、`resourceType`、`resourceStatus`、`resourceScope` 或 `sub2AccountId` 时：
  - 首页按钮显示 `打开共享资源`。
  - 点击后进入 `共享资源` 列表。
  - 自动带入资源筛选条件。
  - 自动填充创建共享资源时可复用的供应方邮箱、资源类型和 Sub2 账号默认值。
- `sub2`、`resourceCredentials`、`localProxySmoke` 仍保持反代维修优先，继续打开 `反代状态` 并预填目标 Sub2/OpenAI 账号。

## 价值

- “共享资源缺失”与“上游账号失效”在首页进入各自更贴近的管理入口，减少管理员在反代状态和共享资源之间来回切换。
- 管理员可以从当前线上 `No online production Codex shared resource` warning 直接进入共享资源创建/筛选路径。
- 该改动只影响 Admin 导航和默认筛选，不会自动写入 refresh token、不会修改 Sub2 账号，也不会触发真实 OpenAI/Codex smoke test。

## 验证

- `pnpm.cmd --filter @zyz/admin test`
- `pnpm.cmd --filter @zyz/admin run typecheck`
