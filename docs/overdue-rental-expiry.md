# 到期租赁自动收敛

## 背景

OpenAI/Codex 反代入口会在请求时校验租赁 `endsAt`。若只返回 `rental_expired`，但不更新本地状态，后台仍可能把已到期租赁统计为 `active`，本地 API Key 也会继续显示为 `active`。

这会影响：

- 管理员看板的有效租赁数量。
- 租赁列表和售出情况的真实性。
- 用户和管理员对 API Key 状态的判断。
- 直接绕过本地 `/v1/*` 入口访问 Sub2 Key 时的风险控制。

## 已实现

新增后端任务：

```text
user/apps/api/src/jobs/expire-overdue-rentals.ts
```

能力：

- 扫描 `active`、`low_balance`、`limited`、`suspended` 且 `endsAt <= now` 的租赁。
- 将租赁状态更新为 `expired`。
- 将该租赁下本地 API Key 更新为 `inactive`。
- 尽力调用 Sub2API 禁用对应 Sub2 Key。
- 返回 `matched`、`expired`、`apiKeysDeactivated`、`sub2Disabled`、`sub2DisableFailed` 等统计。

## OpenAI/Codex 反代入口

`/v1/*` 请求命中过期租赁时，会先调用到期收敛任务，再返回 OpenAI 风格错误：

```json
{
  "error": {
    "message": "Rental has expired",
    "type": "invalid_request_error",
    "code": "rental_expired"
  }
}
```

该行为让代理入口成为租赁状态的实时兜底。

## 管理员入口

新增接口：

```text
POST /api/admin/rentals/expire-overdue
```

权限：

- `admin`

请求体：

```json
{
  "limit": 100
}
```

后台租赁列表新增维护按钮：

```text
Expire overdue rentals
```

管理员可主动批量收敛过期租赁，接口会写入审计日志：

```text
admin.rental.expire_overdue
```

## 可用性结论

该补强让租赁到期状态不再只依赖用户手动暂停/恢复或管理员逐条处理。即使没有独立定时任务，反代请求路径和后台维护路径都会把过期租赁落库为终态，从而提高管理员统计、API Key 状态和本地代理权限判断的一致性。
