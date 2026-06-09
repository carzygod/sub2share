# 管理员租赁限额调整

实现日期：2026-06-09

## 背景

管理员可以管理订单、租赁和 API Key 状态，但售出后的租赁限额此前只能查看，不能直接修正。运营处理售后、补偿、升级、降级或风控时，需要能调整已售租赁的并发、请求量和消费额度。

## 已实现范围

- 新增后台接口 `PATCH /api/admin/rentals/:id/limits`。
- 仅 `admin` 角色可调整租赁限额。
- 支持调整：
  - `maxConcurrency`
  - `rpmLimit`
  - `tpmLimit`
  - `requestLimit`
  - `spendLimit`
  - `remainingSpend`
- 空值可清除可选限制字段。
- 租赁没有 `RentalLimit` 记录时会自动创建。
- 调整动作写入审计日志 `admin.rental.limits`。
- 管理后台“租赁通道”列表新增限额编辑表单。
- 订单详情“租赁限制”补充展示消费上限。

## 生效范围

- 本地 `/v1/*` 反代入口会立即读取新的 `maxConcurrency`、`rpmLimit`、`tpmLimit`、`requestLimit` 和 `remainingSpend`。
- 用量同步会继续按新的 `spendLimit` / `remainingSpend` 扣减剩余额度。
- 已存在 Sub2 Key 的上游 quota 是否能原地更新取决于 Sub2API 更新 Key 契约；当前如需确保上游 quota 也按新额度生效，应执行 Key 轮换。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 API typecheck | 通过 |
| 本地 Admin typecheck | 通过 |
| 本地 API build | 通过 |
| 本地 Admin build | 通过 |
