# 系统可用性巡检

实现日期：2026-06-10

## 背景

平台已经具备用户、订单、租赁、余额、共享资源、Sub2API 反代、用量同步、账务对账和反代请求日志等管理能力。为了让管理员可以系统性复查整体可用性，本次新增统一巡检入口，把分散在多个页面和日志里的健康信号聚合成结构化检查项。

## 后端接口

- 新增接口：`GET /api/admin/system-health`
- 新增接口：`GET /api/admin/system-health/snapshots`
- 权限要求：`operator` 或 `admin`
- 返回内容：
  - `checkedAt`：巡检时间。
  - `status`：整体状态，取值为 `ok`、`warning`、`error`。
  - `summary`：检查项总数和不同级别数量。
  - `checks`：逐项检查结果。

## 巡检范围

当前覆盖以下检查项：

- 数据库：确认 Prisma 查询正常。
- 用户状态：统计 active、disabled、banned 用户。
- 订单状态：提示 failed、refunding 等需要人工复查的订单。
- 租赁可用性：检查 active 租赁是否已过期，以及 low_balance、limited、suspended 等受限租赁。
- API Key 可用性：检查 OpenAI/Codex 本地反代 active Key 是否能通过用户、钱包、租赁、到期时间和 Key hash 准入条件。
- 余额账户：检查钱包可用余额或冻结余额是否出现负数。
- 共享资源：检查异常资源和 online Codex 资源数量。
- Sub2/OpenAI 上游：读取 Sub2API 网关状态和 OpenAI 分组可调度情况。
- 反代请求：统计最近 1 小时 `/v1/*` 请求、4xx、5xx、本地错误码、客户端中途断开和上游流异常。
- 用量同步：检查 Sub2 usage 同步状态，超过 24 小时未成功同步会标记 warning，失败会标记 error。
- 账务对账：复用账务对账结果，发现一致性问题时标记 error。
- 结算提现：统计到期待释放结算和待处理提现。

## 管理员入口

管理后台新增侧边栏入口：`可用性巡检`。

页面展示：

- 整体状态。
- 检查时间。
- 检查项数量、正常数量、警告数量、错误数量。
- 每个检查项的状态、结论和关键指标。

## 设计边界

- 本功能只读，不自动修复问题。
- Sub2/OpenAI 上游状态仍依赖 Sub2API 实时返回。
- 账务对账采用当前有界扫描策略，适合后台快速巡检；全量对账仍可后续扩展为异步任务。
- API Key 可用性巡检只聚焦 OpenAI/Codex 本地 `/v1/*` 反代准入，不把其他资源类型的 active Key 视为错误。
- API Key 可用性巡检默认扫描最近 500 条 active OpenAI/Codex Key，并在 `detail.issues` 中返回最多 50 条样本，避免巡检响应过大。
- 巡检结果用于帮助管理员定位方向，具体修复仍通过订单、租赁、余额、资源、反代状态、反代请求、账务对账、结算和提现等页面执行。
- 客户端中途断开通常标记为 warning，用于提示长流式请求或客户端取消较多；上游流异常会标记为 error，提示 Sub2API 或上游连接链路需要复查。

## 巡检历史

- 每次管理员刷新当前巡检会写入一条 `source=manual` 快照。
- 每次管理员运行安全维护后会写入一条 `source=maintenance` 快照。
- 管理后台会展示最近 12 条巡检历史，便于判断问题是否持续存在。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 API typecheck | 通过 |
| 本地 Admin typecheck | 通过 |
| 本地 API build | 通过 |
| 本地 Admin build | 通过 |
