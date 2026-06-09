# 用户租赁状态机保护

实现日期：2026-06-09

## 背景

用户端存在 `POST /api/rentals/:id/suspend` 和 `POST /api/rentals/:id/resume`。在反代售卖场景中，这两个接口会直接影响 `/v1/*` 本地代理能否放行 API Key。

此前 `resume` 对租赁状态没有严格限制，用户可能把 `closed`、`refunded`、`expired` 等终态租赁重新置为 `active`。这会绕过管理员售后处置、退款状态和套餐生命周期。

## 新增规则

### 暂停

用户只能暂停非终态租赁：

- 允许：`active`、`low_balance`、`limited`、`suspended`
- 拒绝：`expired`、`refunded`、`closed`

若租赁已经到期：

- 本地租赁标记为 `expired`。
- 本地 API Key 标记为 `inactive`。
- 尽力禁用 Sub2 Key。
- 返回 `rental_expired`。

### 恢复

用户只能从以下状态恢复：

- `suspended`
- `low_balance`
- `limited`

恢复前必须满足：

- 租赁未过期。
- 租赁不是 `closed`、`refunded`、`expired`。
- 钱包可用余额大于 `OPENAI_PROXY_MIN_WALLET_BALANCE`。
- `remainingSpend` 未耗尽。
- 已同步 usage 数量未达到 `requestLimit`。

若租赁已是 `active`，直接返回当前租赁。

## 管理员边界

管理员后台的租赁状态接口仍可进行人工处置，但用户自助接口不再能绕过终态和限额约束。

## 涉及文件

- `user/apps/api/src/modules/rentals/routes.ts`

## 验收方式

本地验证：

- `tsc -p apps/api/tsconfig.json --noEmit`
- `npm --prefix apps/api run build`

线上验收建议：

1. 创建 active 租赁并暂停，确认状态变为 `suspended`。
2. 余额充足且限额未耗尽时恢复，确认状态变为 `active`。
3. 将租赁标记为 `closed` 后调用用户恢复接口，预期返回 `rental_not_resumable`。
4. 将租赁到期时间设为过去后调用恢复或暂停，预期返回 `rental_expired`，本地 Key 变为 `inactive`。
5. 将 `remainingSpend` 置为 `0` 后调用恢复，预期返回 `spend_limit_exhausted`。

## 当前限制

该保护约束的是用户自助入口。管理员若强制将租赁恢复为 `active`，仍需结合业务规则和审计记录确认操作合理性。
