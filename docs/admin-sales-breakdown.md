# 管理后台售出分布摘要

实现日期：2026-06-10

## 背景

`售出情况` 已经支持分页、筛选、导出和订单售后处理，但管理员仍需要从订单列表中人工判断售出结构。例如：哪些订单状态占比高、哪个资源类型售出最多、哪个商品贡献金额最高，以及租赁交付是否集中在异常状态。

## 已实现范围

- `/api/admin/sales` 响应新增 `breakdown` 字段，并跟随当前 `q/status` 等筛选条件统计，不受 `page/pageSize` 分页影响。
- 新增 `breakdown.byStatus`：
  - 订单状态
  - 订单数
  - 应付金额
  - 已付金额
- 新增 `breakdown.byResourceType`：
  - 资源类型
  - 订单项数
  - 商品数量
  - 关联租赁数
  - 订单项金额
- 新增 `breakdown.byProduct`：
  - 商品 ID
  - 商品名称
  - 资源类型
  - 订单项数
  - 商品数量
  - 订单项金额
  - 默认按金额降序返回前 12 个商品。
- 新增 `breakdown.byRentalStatus`：
  - 租赁状态
  - 租赁数
- Admin `售出情况` 页面新增四个分布表：订单状态分布、资源类型分布、商品排行、租赁交付状态。

## 管理员价值

- 管理员可以快速判断销售收入、售出商品和租赁交付是否集中在某类状态或资源上。
- 售后和运营复盘不再只能逐条浏览订单列表。
- 该能力补强“售出情况”管理入口，让销售结构、商品表现和交付状态在同一页面可见。

## 验收方式

```bash
npm --prefix user/apps/api run typecheck
npm --prefix user/apps/admin run typecheck
npm --prefix user/apps/api run build
npm --prefix user/apps/admin run build
```
