# 前端生产静态服务常驻修复

实现日期：2026-06-12

## 背景

生产部署脚本原先使用 `pnpm exec vite preview` 启动 Web 和 Admin：

- Web：`3100`
- Admin：`3101`

部署时的即时 HTTP 检查可以通过，但复查发现两个前端端口随后停止监听，只剩旧的 `pnpm` 父进程残留。API `4100` 仍然可用，但 Web/Admin 入口不可访问，属于系统可用性问题。

## 修复内容

- 新增 `user/scripts/serve-static.mjs`：
  - 使用 Node 内置 `http` 和 `fs` 服务构建后的 `dist` 目录。
  - 支持 SPA fallback 到 `index.html`。
  - 对带 hash 的静态资源返回长期缓存。
  - 对 `index.html` 返回 `no-cache`。
  - 不依赖 Vite preview 常驻行为。
- 更新 `user/scripts/deploy-production.sh`：
  - Web 启动为 `node scripts/serve-static.mjs apps/web/dist 3100`。
  - Admin 启动为 `node scripts/serve-static.mjs apps/admin/dist 3101`。
  - `stop_ports()` 会额外清理旧的 `vite preview` / `pnpm @zyz/web` / `pnpm @zyz/admin` 残留进程。

## 验证方式

本地验证：

- `node --check user/scripts/serve-static.mjs`
- 使用 `user/apps/admin/dist` 启动临时静态服务，访问 `/` 返回 `200` 和 `text/html; charset=utf-8`

线上验证：

1. 远端执行 `bash -n deploy-production.sh`。
2. 部署 release。
3. 复查：
   - `http://192.168.31.26:4100/health` 返回 `200`
   - `http://192.168.31.26:4100/ready` 返回 `200`
   - `http://192.168.31.26:3100/` 返回 `200`
   - `http://192.168.31.26:3101/` 返回 `200`
4. 用 `ss -ltnp` 确认 4100、3100、3101 都在监听。
5. 用 `/proc/<pid>/cwd` 确认三者都运行在 `/opt/zhisuan-yizhan/user` 或其子目录。
