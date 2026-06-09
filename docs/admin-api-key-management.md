# 管理员 API Key 管理

实现日期：2026-06-10

## 背景

API Key 是用户租赁、Sub2API 上游 Key、本地 OpenAI/Codex 反代和请求日志之间的关键凭证。此前管理员只能在订单详情或租赁详情中局部查看 API Key，缺少一个全局入口来按用户、租赁、商品、资源类型、Key 前缀和状态进行排查。

## 已实现能力

- 新增管理员接口 `GET /api/admin/api-keys`。
- API Key 列表支持分页、关键字搜索、状态筛选和资源类型筛选。
- 搜索字段覆盖 API Key ID、名称、Key 前缀、用户 ID、用户邮箱、用户显示名、租赁 ID、Sub2 Key ID、endpoint、商品名称和资源类型。
- API Key 列表返回用户、租赁、商品和订单上下文。
- 管理后台新增 `API Key` 导航入口。
- 管理后台 API Key 列表展示用户、Key 名称、Key 前缀、租赁、商品、endpoint、状态、最近使用时间和创建时间。
- 管理后台支持直接启用或停用单个 API Key。
- API Key 状态更新后会刷新当前 API Key 列表；如果操作来自租赁或订单详情，也会同步刷新对应详情上下文。
- 管理后台支持按当前筛选条件导出全部 API Key CSV。

## 运维价值

- 管理员可以直接从 Key 前缀定位用户、租赁、商品和 endpoint。
- 泄露排查时可以按 Key 前缀或 endpoint 搜索，并直接停用可疑 Key。
- 售后排查时可以从用户邮箱、租赁 ID、商品名称或资源类型反查 Key 状态。
- 运营可以导出当前筛选范围内的 Key 清单，用于审计、对账和风险复盘。

## 权限边界

- `GET /api/admin/api-keys` 允许 `operator` 和 `admin` 读取。
- `PATCH /api/admin/api-keys/:id/status` 仍仅允许 `admin` 操作。
- 列表仅展示 Key 前缀和元数据，不返回完整明文 Key。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 API typecheck | 通过 |
| 本地 Admin typecheck | 通过 |
| 本地 API build | 通过 |
| 本地 Admin build | 通过 |

## 后续可扩展

- 增加从 API Key 列表一键跳转到租赁详情。
- 增加 API Key 最近请求日志抽屉，减少跨页面筛选。
- 增加批量停用能力，用于批量泄露或异常请求处理。
