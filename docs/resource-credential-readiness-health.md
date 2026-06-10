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
- Admin `可用性巡检` 页面会在 `巡检候选样本` 表中展示这些候选资源，便于管理员跳转到共享资源详情执行“应用到 Sub2”。

## 管理员价值

- 管理员看到 `openai_group_has_no_active_accounts` 时，可以同时知道本地是否已有可用于修复的 active refresh token。
- 如果存在 active 凭据但缺少 `sub2AccountId`，巡检会明确提示先补资源绑定。
- 如果存在可应用凭据，管理员可以进入共享资源详情，点击“应用到 Sub2”，再运行账号测试和端到端自检。

## 边界

- 巡检只做只读统计，不会自动应用凭据。
- 巡检不证明 refresh token 一定有效；有效性仍由“应用到 Sub2”、账号测试和端到端自检证明。
- 若 `API_KEY_ENCRYPTION_SECRET` 缺失，巡检会提示配置风险，但不会尝试读取或解密历史凭据。
