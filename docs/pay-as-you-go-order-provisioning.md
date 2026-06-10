# 按量商品开通链路

实现日期：2026-06-10

## 背景

数据模型已经支持 `Product.billingMode=pay_as_you_go` 和可空的 `ProductPrice.fixedPrice`，但用户下单链路此前只接受固定价格套餐。这样会导致 OpenAI/Codex 反代只能通过预付费套餐售卖，无法开通零预付、后续按用量扣费的商品。

## 已实现范围

- `POST /api/orders` 支持 `pay_as_you_go` 商品使用 `fixedPrice=null` 的 active 价格档位开通租赁。
- 按量开通时：
  - 订单 `totalAmount=0`、`paidAmount=0`。
  - 不创建预付费 `consume` 钱包流水。
  - 仍创建订单、订单项、租赁、租赁限额、Sub2 Key、本地 API Key 和 Sub2Binding。
  - 如果 Sub2 开通失败，不写入零金额退款流水。
- 非 `pay_as_you_go` 商品仍必须配置 `fixedPrice`，否则管理员创建或更新价格时会被拒绝。
- `GET /api/products` 会展示：
  - 有 active 固定价格的普通商品价格。
  - `pay_as_you_go` 商品的 active 价格，即使 `fixedPrice=null`。
- 用户端按量价格展示为 `按量计费`，按钮文案为 `开通按量`。
- 管理后台价格表单允许固定价格留空，用于按量商品；普通商品留空会被后端拒绝。

## 管理价值

- OpenAI/Codex 本地反代可以作为按量商品售出，和后续 Sub2 usage 同步、钱包扣费、供给方分润链路衔接。
- 管理员不需要用 `$0.00` 伪装按量商品，价格为空即表达按量开通。
- 固定价商品仍受保护，避免误配置成无法直接收费的售卖档位。

## 后续边界

按量开通后，真实使用仍会经过本地 `/v1/*` 反代钱包余额闸门、用量同步和账务对账。生产环境还需要真实支付渠道来支撑用户充值。

