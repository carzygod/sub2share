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
- 当同一上下文携带 `repairAction=apply_openai_refresh_token_to_sub2_account` 且存在 Sub2 账号时：
  - 创建共享资源表单默认勾选 `创建后应用到 Sub2`。
  - 对生产 Codex 资源修复路径默认勾选 `应用后端到端自检`。
  - 如果巡检上下文携带 smoke 模型，自动填入 `自检模型`；没有模型时仍由后端使用默认 smoke 模型。
- `sub2`、`resourceCredentials`、`localProxySmoke` 仍保持反代维修优先，继续打开 `反代状态` 并预填目标 Sub2/OpenAI 账号。

## 2026-06-12 扩展：共享资源创建修复上下文

- Admin `共享资源` 创建表单现在会在由巡检问题打开并带有修复上下文时展示只读诊断条。
- 诊断条展示：
  - 来源检查项与生产资源范围。
  - 推荐修复动作。
  - 供给方邮箱。
  - 资源类型与资源范围。
  - 目标 Sub2 账号。
  - 创建后是否会应用初始凭据到 Sub2。
  - 应用后是否会运行端到端 smoke。
  - 失败请求路径、HTTP 状态和错误码。
- 该展示复用 `resourceCreateDefaultsContextItems()` 纯 helper，并由 Admin 单元测试锁定。
- 展示只读上下文，不改变创建资源、保存凭据、应用到 Sub2 或 smoke test 的执行条件。

## 2026-06-13 扩展：凭据应用确认保留商品上下文

- 从 `productCatalog` 风险进入共享资源修复入口时，商品名、商品 ID 和价格 ID 会由 `resourceCreateDefaultsProductText()` 统一格式化。
- 创建表单诊断条继续展示 `Product` 项。
- 当管理员勾选 `创建后应用到 Sub2` 并提交创建共享资源时，确认弹窗会额外展示 `关联商品`。
- 如果修复上下文没有商品字段，普通共享资源创建确认不展示该行。
- 该能力只增强高风险提交前的上下文确认，不改变资源创建、凭据保存、Sub2 应用或端到端 smoke 的执行条件。

## 2026-06-13 扩展：Sub2 修复问题继承商品价格上下文

- 系统健康会从 `productCatalog` 的 Codex ready delivery 风险中提取 `productId`、`productName` 和 `priceId`。
- 对 `apply_openai_refresh_token_to_sub2_account` 修复动作，`resources`、`resourceCredentials`、`sub2` 和 `localProxySmoke` 等巡检问题会在缺少商品字段时继承同一商品价格上下文。
- 已存在的商品字段不会被覆盖，非 Codex 资源类型不会被强行注入。
- 这样管理员从任意相关巡检项打开共享资源修复时，都能看到同一商品价格定位。

## 价值

- “共享资源缺失”与“上游账号失效”在首页进入各自更贴近的管理入口，减少管理员在反代状态和共享资源之间来回切换。
- 管理员可以从当前线上 `No online production Codex shared resource` warning 直接进入共享资源创建/筛选路径。
- 管理员粘贴有效 OpenAI refresh token 后，可以在同一个创建提交中完成“保存凭据 -> 应用到 Sub2 -> 账号测试 -> 端到端 smoke”的闭环，减少只创建资源但忘记验证 `/v1/responses` 的空窗。
- 管理员在创建前可以直接确认这次表单默认值来自哪条巡检问题、绑定哪个 Sub2 账号、是否会自动应用凭据和运行 smoke，降低误把巡检上下文当成普通资源创建的风险。
- 管理员在最终确认应用凭据前也能看到受影响商品，降低多个 Codex 商品并存时误修复的风险。
- 管理员不必只从 `productCatalog` 入口进入，`resources` 或 `resourceCredentials` 等更高优先级问题同样保留商品价格定位。
- 该改动只影响 Admin 导航和默认筛选，不会自动写入 refresh token、不会修改 Sub2 账号，也不会触发真实 OpenAI/Codex smoke test。

## 验证

- `pnpm.cmd --filter @zyz/admin test`
- `pnpm.cmd --filter @zyz/admin run typecheck`
