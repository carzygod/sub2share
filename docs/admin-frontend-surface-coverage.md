# 管理后台前端入口覆盖

## 背景

后端已经通过 `adminCapabilities` 矩阵检查用户、共享资源、余额、售出和 OpenAI/Codex 反代相关 API 路由是否注册。但管理员入口的完整性还取决于 Admin 前端是否真的提供这些页面入口。如果侧边栏入口被误删，API 能力仍存在，管理员却需要手动猜接口或 URL。

## 已实现范围

- 新增 `apps/admin/src/app/admin-surfaces.ts`，集中声明管理后台入口：
  - 必需范围：`users`、`sharing`、`wallets`、`sales`、`openaiProxy`。
  - 侧边栏导航项。
  - 列表型管理页面。
  - 目标关键入口标记：用户管理、共享资源、余额管理、售出情况、反代状态。
- Admin 侧边栏不再维护一份硬编码按钮清单，而是由 `adminNavigationItems` 渲染。
- 新增 `inspectAdminSurfaceCoverage()`：
  - 检查所有必需范围都有入口。
  - 检查所有列表型管理页面都能从侧边栏进入。
  - 检查侧边栏 view 不重复。
- Admin 测试新增 `tests/admin-surfaces.test.ts`，覆盖：
  - 必需管理范围。
  - 目标关键入口。
  - 所有列表型页面可达。
- `apps/admin/package.json` 的 `test` 脚本从占位输出改为真实执行 Node test。
- `scripts/deploy-production.sh` 发布门禁新增 `pnpm --filter @zyz/admin test`。

## 管理员价值

- “用户情况、共享情况、余额情况、售出情况、反代状态”这些核心入口现在有前端自动化覆盖。
- 后续修改侧边栏或新增列表管理页时，如果忘记接入导航，Admin 测试会失败。
- 生产部署不再只验证 API tests，也会验证 Admin 入口覆盖清单。

## 验证方式

- `pnpm.cmd --filter @zyz/admin test`
- `pnpm.cmd --filter @zyz/admin run typecheck`
- `pnpm.cmd --filter @zyz/admin run build`
- `pnpm.cmd --filter @zyz/api test`
