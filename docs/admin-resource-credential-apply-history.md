# 管理员资源凭据应用历史

## 背景

OpenAI/Codex 反代恢复依赖有效的 Sub2 OpenAI 上游账号。管理员将共享资源中保存的 `openai_refresh_token` 应用到 Sub2 后，需要在同一资源视角确认以下结果：

- 凭据是否成功写入 Sub2 账号。
- Sub2 账号测试是否通过。
- 可选的 `/v1/responses` 端到端烟测是否通过。
- 如果失败，失败的代理请求、HTTP 状态和 requestId 是什么。

此前这些证据主要写入审计日志和系统健康报告，管理员需要跳转审计页或反代状态页二次定位。

## 功能

- `GET /api/admin/resources/:id` 现在返回最近 5 条该资源的 `admin.resource.credential_apply_sub2` 审计摘要。
- 返回字段名为 `credentialApplyLogs`。
- 该字段只包含审计摘要，不包含 refresh token 明文或密文。
- Admin 共享资源详情新增“最近凭据应用”区块。
- 每条记录展示：
  - 应用时间和操作者。
  - Sub2 账号 ID。
  - 应用结果、`refreshed` / `applied` 状态或错误。
  - 账号测试结果和 HTTP 状态。
  - 端到端烟测结果、模型和 `/v1/responses` 错误。
  - 关联代理请求路径、HTTP 状态、错误码和 requestId。

## 管理价值

- 管理员修复 `openai_group_has_no_active_accounts` 时，可以在资源详情页完成“保存凭据 -> 应用到 Sub2 -> 查看测试结果 -> 定位失败请求”的闭环。
- 资源详情页能直接回答该资源最近是否真正参与过 Sub2 修复。
- 失败时可直接拿到代理 requestId，继续在代理请求日志或系统健康页追踪。

## 安全边界

- 后端查询的是 `AuditLog.after` 中已经脱敏的应用结果。
- 审计摘要仅包含 credential type、fingerprint、状态和测试结果。
- 前端不会显示、缓存或导出 OpenAI refresh token。
