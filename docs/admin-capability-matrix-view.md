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
- 每个能力操作使用后端返回的 `target` 展示“入口”按钮，可打开对应 Admin 管理页面：
  - 用户能力打开 `用户管理`。
  - 共享资源与供给方能力打开 `共享资源` 或 `供给方`。
  - 余额能力打开 `余额管理`、`余额流水` 或 `账务对账`。
  - 售出能力打开 `售出情况`、`订单管理`、`租赁通道`、`API Key`、`用量记录` 或 `商品配置`。
  - Sub2API OpenAI/Codex 反代能力打开 `反代状态` 或 `反代请求`。
  - 治理能力打开 `总览`、`可用性巡检`、`巡检历史`、`入口能力` 或 `审计日志`。
- 如果能力覆盖存在缺失，页面展示 `coverage.issues` 中的范围、操作、路由、说明和修复建议。
- Admin 测试新增 `capabilities` 入口断言，避免后续侧边栏误删。
- API 测试新增能力操作 `target` 断言，避免后端声明的核心能力项退回只能查看不能进入。
- 页面覆盖摘要新增 `可达入口`，展示 `operationsWithTargets/totalOperations`。

## 管理价值

- 管理员可以直接在后台确认用户、共享、余额、售出和 OpenAI/Codex 反代五个核心范围是否仍被 API 路由完整覆盖。
- 能力矩阵从“系统健康里的一个检查项”变成可浏览、可进入对应管理页面的治理入口，便于上线验收、交接和故障排查。
- 操作按钮只负责打开对应管理页面，不直接执行 POST/PATCH/DELETE 等写操作，不触发 Sub2API 或 OpenAI/Codex 请求。
- 入口目标由 `/api/admin/capabilities` 返回，前端不再维护重复映射表，减少后续能力项新增或改名时的漂移。

## 验收方式

- `pnpm.cmd --filter @zyz/admin run typecheck`
- `pnpm.cmd --filter @zyz/admin test`
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`

## 2026-06-13 扩展：租赁共享资源归因入口

- 能力矩阵新增售出范围操作 `rentals.assignSupplierResource`。
- 该操作对应 `PATCH /api/admin/rentals/:id/supplier-resource`，用于管理员为租赁绑定或清空共享资源归因。
- 页面中的入口按钮打开 `租赁通道`，管理员在租赁列表或详情中执行归因修复。
- 覆盖摘要中的声明操作、已注册操作和可达入口均从 65 更新为 66。
