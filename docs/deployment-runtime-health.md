# 部署运行态巡检

实现日期：2026-06-11

## 背景

线上发布采用目录切换方式：先构建 `user.new-*`，再替换为 `/opt/zhisuan-yizhan/user` 并重启 4100、3100、3101 服务。此前复查中发现过 release marker 已切换，但 4100 API 进程仍从 `user-replaced-*` 旧目录运行的情况。该问题会让管理员误以为新版本已生效，而真实请求仍由旧代码处理。

## 已实现范围

- 系统巡检新增 `deploymentRuntime` 检查项。
- API 运行时会推导当前 release root：
  - 当进程 cwd 为 `apps/api`、`apps/web` 或 `apps/admin` 时，release root 取上两级目录。
  - 其他情况下使用当前 cwd。
- 巡检读取 release root 下的 `.release-marker`，返回：
  - `commit`
  - `deployedAt`
  - `releaseRoot`
  - `cwd`
  - `markerPath`
- 如果进程运行在 `user-replaced-*` 目录，标记 `error`。
- 如果进程运行在 `user.new-*` staging 目录，标记 `error`。
- 生产环境缺少 `.release-marker` 时标记 `warning`。
- 新增 `user/scripts/deploy-production.sh` 作为生产发布脚本，固化以下门禁：
  - 解包 `git archive HEAD:user` 生成的 release 包到 `user.new-*`。
  - 复制当前 `.env`，强制开启 Sub2 usage 启动同步与 5 分钟周期同步。
  - 执行 `pnpm install --frozen-lockfile --prod=false`、Prisma generate/migrate、API/Admin typecheck、API 测试和全量 build。
  - 停止 4100/3100/3101 后切换 `/opt/zhisuan-yizhan/user`；端口停止会先发 `TERM`，再用 `fuser -k` 清理仍占用端口的进程。
  - 直接从 `apps/api`、`apps/web`、`apps/admin` 目录启动服务，避免 `pnpm --filter` 在目录切换后留下旧 cwd。
  - 对 `/health`、`/ready`、Web、Admin 首页执行 HTTP 复查，并读取 `/proc/<pid>/cwd` 确认三个端口均运行在当前 release；cwd 必须等于当前 release 根目录或其子目录，`user-replaced-*` 与 `user.new-*` 会被显式判为失败。
  - 如果启动后 cwd 复核发现旧 release listener，脚本会自动停止三端口并从当前 release 重启一次，再执行完整 HTTP 与 cwd 复查。

## 管理价值

- 管理员可以在 `可用性巡检` 中直接确认 API 当前运行的 Git commit。
- 发布后可以从后台确认服务进程是否真的位于 `/opt/zhisuan-yizhan/user` 当前 release，而不是旧备份目录。
- 后续如果端口被旧进程占用，巡检会给出 `running_from_replaced_release` 或 `running_from_staging_release` 问题样本，提示重启当前 release 服务。
- 发布人员可以复用同一个脚本执行构建、切换、启动和 cwd 复核，减少临时命令导致的线上漂移。

## 验收方式

- `bash -n user/scripts/deploy-production.sh`
- `bash user/scripts/deploy-production.sh --help`
- `pnpm --filter @zyz/api run typecheck`
- `pnpm --filter @zyz/api test`
- `pnpm --filter @zyz/api run build`
- 线上 `GET /api/admin/system-health` 中 `deploymentRuntime.status=ok`。
- 线上 `deploymentRuntime.metrics.commit` 与 `/opt/zhisuan-yizhan/user/.release-marker` 一致。
