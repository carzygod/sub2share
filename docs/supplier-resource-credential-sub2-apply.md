# 共享资源凭据应用到 Sub2 上游账号

实现日期：2026-06-10

## 背景

此前系统已经具备两项相邻能力：

- 管理员可以把 OpenAI refresh token 直接提交到 Sub2API，用于修复指定 OpenAI 上游账号。
- 管理员可以把共享资源接入凭据加密保存到 `SupplierResourceCredential`。

但这两项能力尚未形成闭环。管理员如果已经在共享资源中保存了 refresh token，仍需要重新粘贴一次明文 token 才能应用到 Sub2 上游账号。新能力把“加密保存”和“上游账号修复”串起来，减少明文凭据在人工流程中重复流转。

## 已实现范围

- 新增后端接口：`POST /api/admin/resources/:id/apply-credential-to-sub2`。
- 接口权限：`admin`。
- 接口读取共享资源绑定的 `sub2AccountId`，并要求该值为数字型 Sub2 账号 ID。
- 接口读取该资源已保存的 `SupplierResourceCredential`：
  - 凭据必须存在。
  - 凭据状态必须是 `active`。
  - 凭据类型必须是 `openai_refresh_token`。
  - `API_KEY_ENCRYPTION_SECRET` 必须已配置。
- 后端只在请求处理中临时解密 refresh token，然后调用既有 `sub2Client.applyOpenAiRefreshToken()`：
  1. 调用 Sub2API `/api/v1/admin/openai/refresh-token` 换取 OAuth credentials。
  2. 调用 Sub2API `/api/v1/admin/accounts/:id/apply-oauth-credentials` 写入指定账号。
- 凭据应用成功后，后端会立即调用 Sub2 账号测试接口，并把测试结果沉淀到共享资源：
  - 更新 `lastCheckedAt`。
  - 根据测试结果把 pending/testing/abnormal/online 等状态收敛到更合适的状态。
- 返回结果只包含资源 ID、Sub2 账号 ID、凭据摘要、应用结果摘要、测试结果、可选端到端自检结果和更新后的资源摘要。
- 审计动作：`admin.resource.credential_apply_sub2`。
- 审计日志不记录 refresh token、密文或 Sub2 OAuth credentials。
- Admin 共享资源详情页新增“应用到 Sub2”入口，可填写可选 `client_id`、`proxy_id`，并可勾选“应用后端到端自检”。
- `GET /api/admin/system-health` 的 `resourceCredentials` 巡检会展示可应用凭据数量、缺少 Sub2 账号绑定的凭据数量和候选样本。

## 管理员使用路径

1. 在“共享资源”中创建或打开一个 Codex/OpenAI 资源。
2. 填写该资源绑定的 `Sub2 账号 ID`。
3. 在“接入凭据”区域保存 `openai_refresh_token` 类型凭据。
4. 如需把维修动作和最终可用性证据放在同一次操作中，勾选“应用后端到端自检”，必要时填写自检模型。
5. 点击“应用到 Sub2”。
6. 查看提交后的提示，确认应用结果、应用后账号测试结果和可选端到端自检结果。
7. 如果未在本次操作中勾选端到端自检，仍可切换到“Sub2”页面运行端到端自检，确认 `/v1/responses` 是否恢复真实生成。

也可以先打开“可用性巡检”，查看 `资源凭据` 检查项。如果 Sub2 上游无 active 账号但本地存在可应用凭据，巡检会给出 warning；如果没有可应用凭据，则会给出 error，提示必须先登记凭据或绑定 Sub2 账号。

## 安全边界

- 后台响应、CSV 导出和审计日志都不回显 refresh token 明文。
- 该动作只支持 `openai_refresh_token`，不会误把 API Key 或 custom 凭据当成 OAuth refresh token 应用。
- 如果本地加密密钥丢失或更换导致无法解密，接口会返回 `resource_credential_decrypt_failed`，不会输出密文内容。
- 成功应用凭据会触发一次账号测试；如果管理员同时请求端到端自检，则只有账号测试通过后才会继续执行本地 OpenAI/Codex 反代 smoke test。
- 端到端自检会创建临时 Sub2 Key 和本地 smoke 租赁，并在结束后清理；响应和审计只返回 key id、key 前缀、HTTP 摘要、日志数量和清理状态，不返回明文 Key。

## 验收方式

- 后端类型检查通过。
- Admin 类型检查通过。
- API 测试通过。
- API/Admin 构建通过。
- 代码扫描确认 `encryptedValue`、refresh token 和 OAuth credentials 不进入响应或审计。
- 使用有效凭据时，勾选“应用后端到端自检”后返回 `smokeTest`；若凭据应用失败或账号测试失败，则返回 `smokeTestSkippedReason`。
