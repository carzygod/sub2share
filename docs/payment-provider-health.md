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
- 巡检指标返回 provider、运行环境、最小充值金额、充值入口是否启用，以及最近充值流水影响：
  - `rechargeWindowHours`
  - `rechargeWindowStartedAt`
  - `recentRechargeTransactions`
  - `recentRechargeAmount`
  - `latestRechargeAt`
  - `recentRechargeSamples`
- 巡检详情会返回最近 5 条充值流水候选样本：
  - `walletTransactionId`
  - `walletId`
  - `userId`
  - `userEmail`
  - `amount`
  - `balanceAfter`
  - `currency`
  - `refType`
  - `refId`
  - `createdAt`
- 当充值配置产生 issue 时，`detail.issues` 会返回：
  - `refId=PAYMENT_PROVIDER`
  - `walletList=true`
  - `walletTransactionList=true`
  - `walletTransactionType=recharge`
  - `salesList=true`
  - `actionHint`
  - `message`
  便于管理员在 `可用性巡检` 的问题样本中直接看到需要复查的环境配置和处理边界。
- 管理后台 `可用性巡检 -> 巡检问题样本` 会识别 `walletList`、`walletTransactionList`、`walletTransactionType` 和 `salesList`，提供 `打开余额列表`、`打开余额流水` 与 `打开售出情况` 操作；余额流水跳转会自动筛选 `recharge` 类型，便于管理员从支付配置 warning 直接复查充值流水和售出收入。
- 管理后台 `可用性巡检 -> 巡检候选样本` 会展示最近充值流水样本，并提供 `打开用户`、`打开余额`、`打开余额流水` 和 `打开售出情况` 操作。
- 管理后台首页 `系统状态 -> 关键巡检项` 会保留支付问题里的 `walletTransactionList`、`walletTransactionType`、`walletTransactionId`、`walletLookup`、`walletList` 和 `salesList`。点击 `payments` 时优先打开对应充值余额流水；没有流水定位时再回退到余额管理或售出情况。

## 管理价值

- 管理员可以在 `可用性巡检` 页面直接看到余额充值链路是否处于真实可用或风险状态。
- 支付配置风险可以直接跳转到余额管理、余额流水和售出情况，减少从巡检发现到账务复核之间的手动导航。
- 管理员在首页看到支付 warning 时也可以直达充值流水，不必先进入完整巡检页再二次选择复核入口。
- 生产环境 mock 充值不再隐藏在代码实现里，而会成为后台可见的 warning。
- 生产环境 mock 充值如果已经写入最近充值流水，巡检会直接展示最近 24 小时的充值笔数、金额和最后充值时间，提醒管理员复核余额与售出收入是否可作为真实收款依据。
- 生产环境 mock 充值如果已经写入最近充值流水，管理员可以直接在候选样本里看到具体用户、钱包、金额、余额和引用对象。
- 如果需要临时关闭充值，可以设置 `PAYMENT_PROVIDER=disabled`，系统巡检会明确显示该阻断。
- 生产环境继续使用 mock 充值时，巡检会明确提示该模式不能作为公开计费依据；需要真实对外收费时，应先接入真实支付单、支付渠道回调和幂等校验。

## 后续边界

真实支付仍需要接入外部支付渠道、支付单、回调签名校验和回调幂等。本次补强先解决配置显式化、误用防护和管理员可见性问题。

## 2026-06-12 Update: 生产 mock 充值安全闸

生产环境不再仅因为 `PAYMENT_PROVIDER=mock` 就开放用户充值写账。后端新增 `ALLOW_PRODUCTION_MOCK_RECHARGE`：

- 默认值为 `false`。
- `NODE_ENV=production`、`PAYMENT_PROVIDER=mock` 且 `ALLOW_PRODUCTION_MOCK_RECHARGE=false` 时，`POST /api/wallet/recharge` 返回 `503 recharge_unavailable`，不会写入 mock 充值流水。
- 开发、测试或非生产环境仍可用 `PAYMENT_PROVIDER=mock` 执行 mock 充值。
- 如果确实需要在生产环境临时开放 mock 充值，必须显式设置 `ALLOW_PRODUCTION_MOCK_RECHARGE=true`。

`GET /api/admin/system-health` 的 `payments.metrics` 新增：

- `allowProductionMockRecharge`
- `rechargeEndpointEnabled`
- `productionMockRechargeBlocked`

巡检语义同步调整：

- 生产 mock 充值被默认阻断且最近 24 小时没有充值流水时，`payments.status=ok`，summary 为 `生产 mock 充值已禁用`。
- 生产显式允许 mock 充值时，`payments.status=warning`，issue 仍为 `production_mock_recharge`。
- 生产 mock 充值已被阻断，但最近窗口内仍存在充值流水时，`payments.status=warning`，issue 为 `production_mock_recharge_recent_ledger`，提醒管理员复核余额、充值流水和售出收入影响。
- `PAYMENT_PROVIDER=disabled` 仍保持 `error`，表示充值入口整体不可用。

这使线上默认配置从“能写 mock 入账但后台提示风险”提升为“默认阻断 mock 入账并在后台证明阻断状态”。真实公开收费仍需后续接入真实支付 provider、支付单、回调验签和幂等入账。
