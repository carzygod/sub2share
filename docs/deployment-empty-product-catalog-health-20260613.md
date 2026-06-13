# 2026-06-13 空商品目录健康告警发布记录

## 发布内容

- 提交：`0d65bcb728528c77aaa3b550d46a2f13498f8caa`
- 变更：`productCatalog` 健康巡检在 active 商品数量为 0 时返回 `empty_active_product_catalog` warning。
- 目标：避免公开商品目录为空时仍显示“可购买性正常”，让管理员能在系统健康和首页关键巡检中看到真实售前阻断。

## 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：22/22 通过。
- `pnpm.cmd --filter @zyz/api typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test -- --runInBand`：146/146 通过。
- `git diff --check`：通过，仅有 Windows 工作区 LF/CRLF 提示。

## 生产部署

- 部署归档：`/tmp/sub2share-user-0d65bcb.tar`
- 部署命令：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-0d65bcb.tar --commit 0d65bcb728528c77aaa3b550d46a2f13498f8caa`
- 服务器侧验证：
  - API tests：146/146 通过。
  - Admin tests：17/17 通过。
  - Workspace build：通过。
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - Web：200。
  - Admin：200。
- Release marker：
  - `commit=0d65bcb728528c77aaa3b550d46a2f13498f8caa`
  - `deployed_at=20260613T030550Z`

## 发布后复查

- `GET /api/admin/system-health`：HTTP 200，总体 `status=error`。
- `deploymentRuntime.status=ok`，当前进程运行在 release `0d65bcb728528c77aaa3b550d46a2f13498f8caa`。
- `productCatalog.status=warning`，summary 为 `1 个商品目录可购买性问题`。
- `productCatalog.metrics.emptyActiveProductCatalog=1`。
- `productCatalog.primaryIssue.type=empty_active_product_catalog`。
- `productCatalog.primaryIssue.productId=null`，`productName=null`，`priceId=null`，不伪造商品定位。
- 首页 `latestSystemHealth` 顺序复查后刷新为 24 ok、2 warning、3 error、29 total checks；`productCatalog` warning 进入 critical checks。

## 剩余真实阻断

- Sub2 默认 OpenAI 分组仍没有 active OpenAI account，账号 #2 仍是 `token_invalidated`。
- 本地 active OpenAI refresh token resource credential 仍为 0。
- ready production Codex shared resource 仍为 0。
- 最新 `/v1/responses` smoke 仍为 HTTP 503 / `api_error` / `Service temporarily unavailable`。
- 当前 active 商品为 0，active Codex 商品为 0；本次发布已经让这一售前问题可见。
