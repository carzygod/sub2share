# 管理后台能力矩阵页面

实现日期：2026-06-12

## 背景

后端已经提供 `GET /api/admin/capabilities`，并在系统巡检中通过 `adminCapabilities` 检查用户、共享资源、余额、售出和 OpenAI/Codex 反代相关 API 路由覆盖。但此前 Admin 前端没有独立页面展示这份矩阵，管理员需要从接口或系统健康摘要间接确认后台入口完整性。

## 已实现范围

- 共享导航新增 `capabilities` / `入口能力`。
- Admin 前端新增 `入口能力` 页面，读取 `GET /api/admin/capabilities`。
- 页面展示覆盖摘要：
  - 核心范围覆盖数。
  - 声明操作数。
  - 关键操作数。
  - 已注册操作数。
  - 缺失路由数。
- 页面按能力范围展示每个操作：
  - 范围 ID。
  - 操作 ID 与名称。
  - HTTP 方法。
  - API 路径。
  - 允许角色。
  - 是否关键操作。
- 如果能力覆盖存在缺失，页面展示 `coverage.issues` 中的范围、操作、路由、说明和修复建议。
- Admin 测试新增 `capabilities` 入口断言，避免后续侧边栏误删。

## 管理价值

- 管理员可以直接在后台确认用户、共享、余额、售出和 OpenAI/Codex 反代五个核心范围是否仍被 API 路由完整覆盖。
- 能力矩阵从“系统健康里的一个检查项”变成可浏览的治理页面，便于上线验收、交接和故障排查。
- 该页面只读现有能力矩阵，不写业务数据，不触发 Sub2API 或 OpenAI/Codex 请求。

## 验收方式

- `pnpm.cmd --filter @zyz/admin run typecheck`
- `pnpm.cmd --filter @zyz/admin test`
