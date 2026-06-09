# 系统巡检历史

实现日期：2026-06-10

## 背景

`GET /api/admin/system-health` 已经可以生成当前系统可用性快照，但管理员仍需要判断问题是偶发、刚出现，还是持续存在。只看当前结果会让复查依赖人工截图或审计日志，不利于定位反代、账务、租赁和资源问题的持续时间。

## 已实现能力

- 新增数据表 `SystemHealthSnapshot`。
- 新增迁移 `user/prisma/migrations/0011_system_health_snapshots/migration.sql`。
- 管理员刷新 `GET /api/admin/system-health` 时，会写入一条 `source=manual` 的巡检快照。
- 管理员运行 `POST /api/admin/system-maintenance/run` 后，会写入一条 `source=maintenance` 的巡检快照。
- 快照保存整体 `status`、`summary`、完整 `checks`、操作者和创建时间。
- 新增管理员接口 `GET /api/admin/system-health/snapshots`。
- 巡检历史支持分页、状态筛选和按快照 ID、来源、操作者搜索。
- 管理后台 `可用性巡检` 页面展示最近 12 条巡检历史。
- 管理后台新增独立 `巡检历史` 入口，复用通用列表能力，支持分页、状态筛选、关键字搜索和 CSV 导出。

## 管理员价值

- 管理员可以判断错误或警告是否持续存在。
- 安全维护后可以立即看到维护后的巡检结果进入历史。
- 线上排障时可以基于历史状态变化判断问题发生窗口。
- 管理员可以把 filtered-all 巡检快照导出为 CSV，交给运营、技术或复盘流程继续分析。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| Prisma generate | 通过 |
| 本地 API typecheck | 通过 |
| 本地 Admin typecheck | 通过 |
| 本地 API build | 通过 |
| 本地 Admin build | 通过 |
| 管理端巡检历史入口 | 已实现 |
| 巡检历史 CSV 导出 | 已实现 |

## 注意事项

`可用性巡检` 页仍保留最近 12 条历史作为上下文概览；完整追踪请进入 `巡检历史` 页使用分页、筛选和导出。后续如需要长期趋势分析，可以继续增加按时间范围筛选、趋势图和保留策略。
