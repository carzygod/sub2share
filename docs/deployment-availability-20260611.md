# 线上部署可用性巡检与同步记录 2026-06-11

## 巡检对象

- 服务器：`192.168.31.26`
- 业务 API：`http://192.168.31.26:4100`
- 用户端 Web：`http://192.168.31.26:3100`
- 管理员端 Admin：`http://192.168.31.26:3101`
- Sub2API：`http://192.168.31.26:8080`

## 初始发现

- `22`、`80`、`3000`、`3100`、`3101`、`4100`、`8080` 等端口可达，`443` 未监听。
- Sub2API 进程位于 `/opt/sub2api`，`/health` 返回 `{"status":"ok"}`，`/v1/models` 在未带 Key 时返回 `401`，符合网关鉴权预期。
- 当前业务代码部署在 `/opt/zhisuan-yizhan/user`，不是 Git 工作区。
- 部署版本落后于 GitHub `main@aeeb18c`：
  - API 缺少 `/live`、`/ready`、`/api/admin/capabilities`。
  - Admin 构建产物未正确使用 `VITE_API_BASE`，直连 `3101` 时会请求相对 `/api/...`，导致管理端无法稳定调用 `4100` API。

## 修复动作

- 从本地 `main@aeeb18c` 生成 `user/` 部署包。
- 保留线上 `/opt/zhisuan-yizhan/user/.env`，构建时注入 `VITE_API_BASE=http://192.168.31.26:4100`。
- 创建备份：
  - `/opt/zhisuan-yizhan/user-backup-20260611T0833Z-aeeb18c`
  - `/opt/zhisuan-yizhan/user-replaced-20260611T0833Z-aeeb18c`
- 在新版本目录执行：
  - `pnpm install --frozen-lockfile --prod=false`
  - `pnpm db:generate`
  - `pnpm exec prisma migrate deploy`
  - `pnpm typecheck`
  - `pnpm --filter @zyz/api test`
  - `pnpm build`
- Prisma 已成功应用迁移 `0003` 到 `0014`。
- 停止旧 `4100`、`3100`、`3101` 进程后，切换新目录并重启 API/Web/Admin。
- 清理失败部署留下的临时目录和 `/tmp` 部署包。

## 验证结果

- `GET /health`：`200`，API 基础健康正常。
- `GET /live`：`200`，新版本存活探针可用。
- `GET /ready`：`200`，依赖检查通过：
  - database：`ok`
  - sub2api：`ok`
  - oauthStateStore：Redis shared `ok`
  - openAiProxyLimiter：Redis shared `ok`
- `GET /api/admin/capabilities`：未登录返回 `401`，证明路由已存在且受后台鉴权保护，不再是旧版本 `404`。
- `GET /` on `3101`：`200`，Admin 加载新资产 `index-CI9BnnPG.js`。
- `GET /` on `3100`：`200`，Web 加载新资产 `index-DizoTZ4a.js`。
- Admin/Web 构建产物均包含 `http://192.168.31.26:4100` API base。

## 当前未完成证明

真实 `/v1/responses` 端到端生成仍需有效 Sub2/OpenAI 上游账号和可用租赁 Key 证明。本次只证明：

- Sub2API 网关进程健康。
- 本地 API 的 `/ready` 依赖检查通过。
- 管理员入口的新能力覆盖端点已上线。
- Admin/Web 能正确指向业务 API。
