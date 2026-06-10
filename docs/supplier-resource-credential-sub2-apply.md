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
- 返回结果只包含资源 ID、Sub2 账号 ID、凭据摘要和应用结果摘要。
- 审计动作：`admin.resource.credential_apply_sub2`。
- 审计日志不记录 refresh token、密文或 Sub2 OAuth credentials。
- Admin 共享资源详情页新增“应用到 Sub2”入口，可填写可选 `client_id` 和 `proxy_id`。

## 管理员使用路径

1. 在“共享资源”中创建或打开一个 Codex/OpenAI 资源。
2. 填写该资源绑定的 `Sub2 账号 ID`。
3. 在“接入凭据”区域保存 `openai_refresh_token` 类型凭据。
4. 点击“应用到 Sub2”。
5. 切换到“Sub2”页面运行账号测试或端到端自检，确认 `/v1/responses` 是否恢复真实生成。

## 安全边界

- 后台响应、CSV 导出和审计日志都不回显 refresh token 明文。
- 该动作只支持 `openai_refresh_token`，不会误把 API Key 或 custom 凭据当成 OAuth refresh token 应用。
- 如果本地加密密钥丢失或更换导致无法解密，接口会返回 `resource_credential_decrypt_failed`，不会输出密文内容。
- 成功应用凭据不等于真实生成已恢复；仍需通过账号测试和端到端自检验证 Sub2API 上游账号状态。

## 验收方式

- 后端类型检查通过。
- Admin 类型检查通过。
- API 测试通过。
- API/Admin 构建通过。
- 代码扫描确认 `encryptedValue`、refresh token 和 OAuth credentials 不进入响应或审计。
