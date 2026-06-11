# 支付充值配置巡检

实现日期：2026-06-10

## 背景

钱包充值此前固定执行 mock recharge，虽然适合本地演示和内部验收，但生产环境如果继续使用 mock 充值，会让余额、售出和对账数据失去真实收款依据。`user/.env.example` 已包含 `PAYMENT_PROVIDER=mock`，本次将该配置正式纳入后端解析和系统巡检。

## 已实现范围

- 后端环境配置新增 `PAYMENT_PROVIDER`，当前支持：
  - `mock`：允许 `/api/wallet/recharge` 执行 mock 充值。
  - `disabled`：用户充值接口返回 `503 recharge_unavailable`。
- `/api/wallet/recharge` 不再无条件执行 mock 充值，只有 `PAYMENT_PROVIDER=mock` 时才会写入充值流水。
- `GET /api/admin/system-health` 新增检查项：`payments` / `支付充值`。
- 巡检规则：
  - `PAYMENT_PROVIDER=disabled`：标记 `error`，表示用户无法充值。
  - `NODE_ENV=production` 且 `PAYMENT_PROVIDER=mock`：标记 `warning`，提示生产环境仍在使用 mock 充值。
  - 其他情况：标记 `ok`。
- 巡检指标返回 provider、运行环境、最小充值金额和充值入口是否启用。
- 当充值配置产生 issue 时，`detail.issues` 会返回：
  - `refId=PAYMENT_PROVIDER`
  - `actionHint`
  - `message`
  便于管理员在 `可用性巡检` 的问题样本中直接看到需要复查的环境配置和处理边界。

## 管理价值

- 管理员可以在 `可用性巡检` 页面直接看到余额充值链路是否处于真实可用或风险状态。
- 生产环境 mock 充值不再隐藏在代码实现里，而会成为后台可见的 warning。
- 如果需要临时关闭充值，可以设置 `PAYMENT_PROVIDER=disabled`，系统巡检会明确显示该阻断。
- 生产环境继续使用 mock 充值时，巡检会明确提示该模式不能作为公开计费依据；需要真实对外收费时，应先接入真实支付单、支付渠道回调和幂等校验。

## 后续边界

真实支付仍需要接入外部支付渠道、支付单、回调签名校验和回调幂等。本次补强先解决配置显式化、误用防护和管理员可见性问题。
