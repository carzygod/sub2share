# 资源凭据可应用性巡检

实现日期：2026-06-10

## 背景

OpenAI/Codex Responses 的真实生成依赖 Sub2API 内存在 active 且凭据有效的 OpenAI 上游账号。系统已经支持把共享资源凭据加密保存，并能把 `openai_refresh_token` 应用到绑定的 Sub2 上游账号。为了让管理员在“可用性巡检”中直接看到修复路径，本次把资源凭据从单纯配置检查升级为数据库级可应用性巡检。

## 已实现范围

- `GET /api/admin/system-health` 的 `resourceCredentials` 检查项继续保留。
- 巡检指标新增：
  - `totalCredentials`
  - `activeOpenAiRefreshTokens`
  - `activeApplicableCredentials`
  - `activeMissingSub2Account`
  - `inactiveOpenAiRefreshTokens`
- 巡检会统计 Codex 共享资源下的 `openai_refresh_token` 凭据。
- 巡检会判断 active refresh token 是否已经绑定可应用的 `sub2AccountId`。
- 当 Sub2 状态包含 `openai_group_has_no_active_accounts` 时：
  - 若没有可应用凭据，`resourceCredentials` 标记 error。
  - 若存在可应用凭据，`resourceCredentials` 标记 warning，并提示管理员可尝试应用。
- 巡检 detail 中只返回凭据摘要和候选资源样本：
  - 资源 ID
  - 资源状态
  - Sub2 账号 ID
  - 供给方邮箱
  - 凭据类型、状态、指纹、轮换时间
- 巡检不会解密任何凭据，也不会返回密文。
- Admin `可用性巡检` 页面会在 `巡检候选样本` 表中展示这些候选资源，并提供“打开资源”操作，便于管理员跳转到共享资源详情执行“应用到 Sub2”。

## 2026-06-11 追补：巡检问题可操作化

- `resourceCredentials.detail.issues` 新增可由管理后台直接消费的维修字段：
  - `actionHint`：展示下一步维修建议。
  - `resourceId`：当存在对应候选资源时，问题行可直接打开共享资源详情。
  - `sub2Status`：当问题与 Sub2 上游调度相关时，问题行可直接打开反代状态页。
- `openai_refresh_token_sub2_account_missing` 会尽量绑定一个缺少 `sub2AccountId` 的资源样本，便于管理员先补资源绑定。
- `openai_refresh_token_apply_needed` 会尽量绑定一个可应用资源样本，便于管理员进入资源详情执行“应用到 Sub2”。
- `openai_refresh_token_candidate_missing` 会显式给出 Sub2 状态跳转和登记新凭据/直接粘贴 token 的建议。
- `detail.samples` 增加 `sampleType`：
  - `applicable`：已经具备 active refresh token 和 Sub2 账号 ID，可直接尝试应用。
  - `missing_sub2_account`：已有 active refresh token，但资源尚未绑定 Sub2 账号 ID。
- Admin `反代状态` 页的 OpenAI 上游账号表新增凭据状态、可调度状态、更新时间、限速/过载/临时阻断时间，便于管理员判断账号为什么不可调度。

## 2026-06-11 追补：Sub2 账号维修候选

- 当 `resourceCredentials` 因 `openai_refresh_token_candidate_missing` 标记 error 时，问题样本会从 Sub2/OpenAI 上游巡检结果中带出一个可维修账号候选：
  - `sub2AccountId`
  - `sub2AccountName`
  - `accountStatus`
  - `credentialsStatus`
  - `schedulable`
  - `repairAction=apply_openai_refresh_token_to_sub2_account`
- `detail.samples` 会额外追加 `sampleType=sub2_account_repair_candidate` 的候选样本，列出当前默认 OpenAI 分组下非 active 或不可调度账号。
- 管理员在 `可用性巡检` 页面可以直接看到应优先补 token 的 Sub2 账号，再点击 `打开反代状态`，在该页粘贴有效 OpenAI refresh token、测试账号并重跑端到端自检。
- 该能力不创建或修改 Sub2 账号，只把当前已存在、最可能恢复的账号以结构化字段暴露给后台，避免管理员在多个表格之间手动匹配账号 ID。

## 2026-06-11 追补：反代状态页维修预选

- 管理后台 `反代状态` 页的 `Apply OpenAI Credentials` 表单会优先选中默认 OpenAI 分组下非 active 或不可调度的 OpenAI 上游账号。
- 从 `可用性巡检` 的 `resourceCredentials` / `Sub2/OpenAI 上游` 问题或候选样本点击 `打开反代状态` 时，前端会携带样本里的 `sub2AccountId`，并优先选中该账号。
- 如果默认 OpenAI 分组没有候选账号，则回退到任意非 active 或不可调度的 OpenAI 账号；仍没有时回退到第一个 OpenAI 账号。
- 被巡检定位的账号会标记 `巡检定位`，自动建议的账号会标记 `建议修复`，使管理员从 `可用性巡检` 进入反代状态页后，可以直接粘贴有效 OpenAI refresh token 并应用到最可能恢复的账号。
- 该前端行为只改变默认选择和提示，不会自动写入凭据，也不会修改 Sub2API 账号状态。

## 2026-06-12 追补：直接应用后的闭环验证

- `POST /api/admin/sub2/accounts/:id/apply-openai-refresh-token` 新增可选字段：
  - `runAccountTest`：默认 `true`，应用凭据成功后立即测试该 Sub2 OpenAI 账号。
  - `runSmokeTest`：默认 `false`，账号测试通过后继续运行本地 OpenAI/Codex 反代端到端自检。
  - `smokeModel`：可选自检模型。
  - `proxyId`：可选 Sub2 proxy id，便于刷新 token 时绑定特定代理。
- 管理后台 `反代状态` 页的 `Apply OpenAI Credentials` 表单新增 `proxy_id`、`应用后测试账号`、`应用后端到端自检` 和 `自检模型` 控件。
- 直接粘贴 token 的维修路径现在会在同一次操作中返回凭据应用结果、账号测试结果、端到端自检结果或跳过原因，并写入审计日志 `admin.sub2.account.apply_openai_refresh_token`。
- 若凭据应用失败，端到端自检会标记跳过原因 `credential_apply_failed`；若账号测试失败，端到端自检会标记跳过原因 `sub2_account_test_failed`。

## 管理员价值

- 管理员看到 `openai_group_has_no_active_accounts` 时，可以同时知道本地是否已有可用于修复的 active refresh token。
- 如果存在 active 凭据但缺少 `sub2AccountId`，巡检会明确提示先补资源绑定。
- 如果存在可应用凭据，管理员可以进入共享资源详情，点击“应用到 Sub2”，再运行账号测试和端到端自检。
- 如果本地没有可应用凭据，管理员可以直接看到 Sub2 账号维修候选，把有效 OpenAI refresh token 应用到该账号后再自检。

## 边界

- 巡检只做只读统计，不会自动应用凭据。
- 巡检不证明 refresh token 一定有效；有效性仍由“应用到 Sub2”、账号测试和端到端自检证明。
- 若 `API_KEY_ENCRYPTION_SECRET` 缺失，巡检会提示配置风险，但不会尝试读取或解密历史凭据。

## 验证方式

- `pnpm.cmd --filter @zyz/api run typecheck`
- `pnpm.cmd --filter @zyz/admin run typecheck`
- `pnpm.cmd --filter @zyz/api test`
- `pnpm.cmd --filter @zyz/api run build`
- `pnpm.cmd --filter @zyz/admin run build`
