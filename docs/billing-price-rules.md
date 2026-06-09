# 用量计费价格规则

实现日期：2026-06-09

## 背景

Sub2 usage 同步原本使用全局 `DEFAULT_DISCOUNT_RATE` 计算买家扣费，无法体现管理员在商品价格中配置的 `discountRate` 和 `tierMultiplier`。这会导致不同套餐虽然展示了不同计费参数，但实际 usage 入账仍按同一全局倍率扣费。

## 已实现范围

- usage 入账时根据租赁所属订单项 `priceId` 查找 `ProductPrice`。
- 买家用量扣费改为：

```text
buyerCharge = apiEquivalentCost * ProductPrice.discountRate * ProductPrice.tierMultiplier
```

- 找不到订单项价格或价格记录已不存在时，才回退到：

```text
buyerCharge = apiEquivalentCost * DEFAULT_DISCOUNT_RATE
```

- 供应商收益仍按 `buyerCharge * SupplierResource.shareRate` 计算。
- 钱包流水 note 会标记计费来源：
  - `sub2 usage billing product_price:<tierCode>`
  - `sub2 usage billing default_discount_rate`

## 影响

- 管理员在后台配置的套餐折扣率和倍率会影响后续 usage 扣费、售出收入和供应商结算。
- 历史已入账 usage 不会回溯重算，避免影响已产生的钱包流水和结算记录。
- 订单项缺失 `priceId` 的早期或异常数据仍能通过全局默认折扣率兜底。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 API typecheck | 通过 |
| 本地 API build | 通过 |
