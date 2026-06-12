# 管理员 Sub2 修复上下文预填

## 背景

系统健康报告已经能识别 `openai_group_has_no_active_accounts`，并在问题行里给出优先修复的 Sub2 OpenAI 账号、供给方邮箱和可能的共享资源信息。管理员点击“打开反代状态”后，如果这些字段没有继续带到 Apply OpenAI Credentials 表单，仍然需要手动复制账号、资源或供给方信息。

## 功能

- 系统健康 issue 行点击“打开反代状态”时，会携带：
  - `sub2AccountId`
  - `repairAction`
  - `resourceId`
  - `supplierEmail`
  - `resourceType`
  - `resourceStatus`
  - `resourceScope`
  - 请求定位字段
- 系统健康 sample 行也会读取并携带同类字段。
- 管理员首页关键巡检项点击“打开反代状态”时，也会把 `primaryIssue` / `primarySample` 中的 `sub2AccountName`、`accountStatus`、`credentialsStatus`、`repairAction`、资源字段和请求字段带入修复上下文。
- 首页和完整巡检页也会把 smoke 诊断字段带入修复上下文：
  - `actionHint`
  - `model`
  - `modelsOk`
  - `responsesOk`
  - `localProxyOk`
  - `proxyRequestPath`
  - `proxyRequestStatusCode`
  - `proxyRequestErrorCode`
  - `smokeTestSkippedReason`
  - `ageMinutes`
- 当某条 Sub2 修复问题缺少 `supplierEmail`，但系统内恰好只有一个 active 供给方时，健康报告会把该供给方邮箱作为修复候选补入问题上下文。
- Admin “反代状态”页会使用该上下文：
  - 在页面中展示“修复定位”诊断块，显示来源检查项、推荐维修动作、维修建议、目标账号、账号/凭据状态、资源、供给方、请求定位、Smoke 分段结果和失败请求。
  - 自动预选 Sub2 OpenAI 账号。
  - 自动预填目标共享资源 ID。
  - 自动预填供给方邮箱。
  - 当存在资源 ID 或供给方邮箱时，默认勾选“保存为共享资源凭据”。
  - 当上下文来自 `localProxySmoke`、`responsesOk=false`、`localProxyOk=false` 或携带失败请求字段时，默认勾选“应用后端到端自检”。
  - 当上下文携带 smoke 模型时，自动预填“自检模型”。
- 表单会随修复上下文变化重新挂载，避免上一次问题行的默认值残留。
- “修复定位”只展示脱敏定位信息，不展示或缓存 OpenAI refresh token。
- Admin 单元测试锁定修复上下文摘要会保留来源、维修动作、维修建议、目标账号、账号/凭据状态、资源、供给方、请求定位、Smoke 分段结果和失败请求字段，并锁定失败 smoke 上下文会默认启用端到端自检。

## 管理价值

- 管理员从可用性巡检进入修复页后，可以直接粘贴有效 OpenAI refresh token。
- 管理员从首页或完整巡检页进入反代状态页后，可以先确认当前目标账号、资源和推荐维修动作，再应用凭据。
- 管理员可以直接在反代状态页确认 `/v1/responses`、HTTP 503、`upstream_http_503` 等 smoke 失败证据，不必切回完整巡检页查找。
- 管理员从 smoke 失败上下文应用新 refresh token 时，表单默认带上同一个模型并在提交后立即运行端到端验证，降低“已更新凭据但未验证真实 Codex 反代”的风险。
- 如果健康报告已经定位到供给方或共享资源，保存资源凭据时无需再次查找。
- 对当前 `openai_group_has_no_active_accounts` 阻断，修复路径从“定位账号 -> 打开反代页 -> 手填资源同步信息”缩短为“打开反代页 -> 粘贴 token -> 确认应用和保存”。
