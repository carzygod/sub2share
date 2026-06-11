# Sub2 直接应用 Token 后同步共享资源

## 背景

管理员在“反代状态”页可以直接把 OpenAI refresh token 应用到 Sub2 OpenAI 账号。此前这条路径只修复 Sub2 上游账号，不会自动沉淀为平台侧共享资源和资源凭据；如果管理员没有再到共享资源页登记，系统健康仍可能显示没有生产 Codex 共享资源或没有可应用的资源凭据。

## 新增能力

`POST /api/admin/sub2/accounts/:id/apply-openai-refresh-token` 新增可选字段：

- `saveToResource`：是否在 Sub2 应用成功后同步保存为共享资源凭据，默认 `false`。
- `resourceId`：目标共享资源 ID，可选。填写后会更新该 Codex 资源的 `sub2AccountId` 和加密凭据。
- `supplierEmail`：供给方邮箱。未填写 `resourceId` 且启用保存时必填，系统会为该供给方新建 Codex 共享资源。

保存规则：

- 只有 Sub2 应用成功时才保存本地资源凭据。
- 保存前会校验加密密钥、目标资源类型或供给方用户是否存在。
- 已有资源会更新 `sub2AccountId`、状态、`lastCheckedAt` 和凭据。
- 新建资源默认 `resourceType=codex`、`level=L0`、`maxConcurrency=1`，并绑定当前 Sub2 账号。
- 如果账号测试通过，资源可进入 `online`；测试失败则进入 `abnormal`；未运行账号测试时保持 `testing`。
- 保存动作会写入 `admin.sub2.account.save_refresh_token_resource` 审计日志。

## 管理端变化

Admin “反代状态”页的 Apply OpenAI Credentials 表单新增：

- `保存为共享资源凭据`
- `目标资源 ID`
- `供给方邮箱，新建资源时必填`

管理员可在同一入口完成：

1. 粘贴有效 OpenAI refresh token。
2. 应用到 Sub2 OpenAI 账号。
3. 运行账号测试。
4. 可选运行 `/v1/responses` 端到端烟测。
5. 显式保存或新建平台共享资源凭据。

## 安全边界

- 默认不保存 token。
- 启用保存时必须经过二次确认。
- 本地只保存加密后的凭据和 fingerprint。
- API 响应和审计日志不会返回 refresh token 明文或密文。
