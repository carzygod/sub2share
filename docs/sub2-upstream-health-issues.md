# Sub2/OpenAI 上游阻断巡检样本

实现日期：2026-06-11

## 背景

`GET /api/admin/system-health` 已经可以判断 Sub2API 网关与 OpenAI 默认分组是否可调度，但此前 `Sub2/OpenAI 上游` 检查只在 summary/detail 中暴露 `blockingReasons`。管理员在统一 `巡检问题样本` 表中看不到这些上游阻断，也不能从同一张表直接跳到反代状态页继续维修。

## 已实现范围

- `Sub2/OpenAI 上游` 检查把每个 blocking reason 转换为 `detail.issues`。
- issue 字段包含：
  - `sub2BlockingReason`
  - `sub2GroupId`
  - `sub2GroupName`
  - `sub2GroupStatus`
  - `sub2AccountCount`
  - `openAiAccountCount`
  - `activeOpenAiAccountCount`
  - `gatewayReachable`
  - `sub2Status`
  - `sub2AccountId` / `sub2AccountName` / `accountStatus` / `credentialsStatus` / `schedulable`（当存在可优先修复的账号样本时）
  - `repairAction`
  - `error`
  - `actionHint`
- 管理后台 `可用性巡检` 的对象摘要会展示 Sub2 阻断字段。
- 管理后台 `可用性巡检` 的说明列会展示维修建议，操作列会为 Sub2 上游问题提供 `打开反代状态` 操作。
- 管理后台 `反代状态` 页会按当前 blocking reason 汇总展示维修建议。
- `Sub2/OpenAI 上游` 指标新增 OpenAI 账号数和 active OpenAI 账号数。
- `Sub2/OpenAI 上游` 的 `detail.samples` 会返回默认 OpenAI 分组下非 active 或不可调度的账号样本，字段包括：
  - `sub2AccountId`
  - `sub2AccountName`
  - `accountStatus`
  - `credentialsStatus`
  - `schedulable`
  - `groupIds` / `groupNames`
  - `rateLimitedAt` / `overloadUntil` / `tempUnschedulableUntil`
  - `tempUnschedulableReason`
  - `updatedAt`
  - `message`
- 管理后台 `巡检候选样本` 会展示 Sub2 账号样本，并提供 `打开反代状态` 操作。

## 阻断类型

- `sub2api_health_unreachable`：Sub2API 网关健康接口不可达。
- `openai_group_missing`：Sub2API 没有可用于 OpenAI/Codex 调度的默认分组。
- `openai_group_inactive`：默认 OpenAI 分组存在但不是 active。
- `openai_group_has_no_accounts`：默认 OpenAI 分组没有 OpenAI 账号。
- `openai_group_has_no_active_accounts`：默认 OpenAI 分组存在账号，但没有 active 账号。
- `sub2_status_query_failed`：系统无法完成 Sub2 状态查询。

## 管理员价值

- 管理员在系统巡检页可以直接看到 `/v1/responses` 真实生成失败是否来自上游调度阻断。
- 当阻断原因为 `openai_group_has_no_active_accounts` 时，管理员可以从同一行看到“刷新/测试现有账号或应用有效 refresh token，再运行端到端自检”的建议。问题行会携带首个可修复 OpenAI 账号作为 `sub2AccountId`，点击 `打开反代状态` 后凭据应用表单会预选该账号。
- 管理员可以在候选样本中直接看到具体失效账号，例如账号 ID、名称、凭据配置状态、是否可调度和 OpenAI 返回的 token invalidated/token revoked 摘要，减少进入 Sub2 状态页前的二次排查。
- 管理员在反代状态页直接粘贴 OpenAI refresh token 时，系统会默认在应用成功后测试账号；勾选 `应用后端到端自检` 后，还会继续验证本地 `/v1/models` 与 `/v1/responses` 反代链路。
- 问题样本不包含上游凭据、明文 Key 或 refresh token，只展示可排障的聚合状态。

## 验证方式

- `npm.cmd --prefix user/apps/api run typecheck`
- `npm.cmd --prefix user/apps/admin run typecheck`
- `npm.cmd --prefix user/apps/api test`
