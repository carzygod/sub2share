# 2026-06-13 Sub2 资源凭据默认保存策略发布记录

## 发布内容

- 提交：`5180497bc611bc8150d640b0b255fb5a4854c030`
- 变更：Admin Sub2 反代状态页新增 `sub2RepairContextShouldSaveToResource` 策略。
- 目标：当健康巡检已经定位到 Codex 供给方或资源时，管理员粘贴有效 OpenAI refresh token 后，默认同步保存本地共享资源凭据，避免只修复 Sub2 上游账号却仍没有可交付 Codex 资源。

## 本地验证

- `pnpm.cmd --filter @zyz/admin test`：17/17 通过。
- `pnpm.cmd --filter @zyz/admin typecheck`：通过。
- `git diff --check`：通过，仅有 Windows 工作区 LF/CRLF 提示。

## 生产部署

- 部署归档：`/tmp/sub2share-user-5180497.tar`
- 部署命令：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-5180497.tar --commit 5180497bc611bc8150d640b0b255fb5a4854c030`
- 服务器侧验证：
  - API tests：145/145 通过。
  - Admin tests：17/17 通过。
  - Workspace build：通过。
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - Web：200。
  - Admin：200。
- Release marker：
  - `commit=5180497bc611bc8150d640b0b255fb5a4854c030`
  - `deployed_at=20260613T025643Z`

## 发布后复查

- `GET /api/admin/system-health`：HTTP 200，总体 `status=error`。
- `deploymentRuntime.status=ok`，当前进程运行在 release `5180497bc611bc8150d640b0b255fb5a4854c030`。
- `frontendRuntime.status=ok`，Web/Admin frontend endpoints `2/2` 可达。
- `adminCapabilities.status=ok`，API 管理入口覆盖 `5/5` 核心范围，66/66 路由存在。
- `adminSurfaceCoverage.status=ok`，前端管理入口覆盖 `5/5` 核心范围，16 个列表入口、5 个关键入口。

## 剩余真实阻断

- `sub2.status=error`：`openai_group_has_no_active_accounts`，默认 OpenAI 分组 2 个账号、active 账号 0。
- `resourceCredentials.status=error`：`activeOpenAiRefreshTokens=0`、`activeApplicableCredentials=0`。
- `resources.status=warning`：没有 ready online production Codex shared resource。
- `localProxySmoke.status=error`：最新 `/v1/responses` smoke 仍为 HTTP 503 / `api_error` / `Service temporarily unavailable`，证据仍未过期。
- 数据库摘要：active OpenAI refresh token 凭据 0，ready production Codex 资源 0，active Codex 商品 0，active rental 0。

本次发布已经让管理员修复入口更闭环，但生产 Codex 反代仍需要管理员提供有效 OpenAI refresh token，并完成 Sub2 应用、资源凭据同步、端到端 smoke 和资源上线。
