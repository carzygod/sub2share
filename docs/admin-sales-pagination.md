# 管理后台售出情况分页筛选

实现日期：2026-06-10

## 背景

`售出情况` 页面此前通过 `/api/admin/sales` 读取最近 100 条订单，并展示全局订单与用量汇总。随着售出订单增长，这会让管理员只能看到最近快照，无法基于状态、订单、用户或租赁做完整排查与导出。

本次改造将售出情况升级为正式运营列表。

## 已实现范围

- `/api/admin/sales` 接入统一列表参数：
  - `q`
  - `status`
  - `page`
  - `pageSize`
- 响应新增统一分页字段：
  - `items`
  - `total`
  - `page`
  - `pageSize`
  - `totalPages`
- 响应继续保留 `orders` 字段，兼容既有售出页面渲染逻辑。
- 搜索范围覆盖：
  - 订单 ID
  - 支付引用
  - 用户 ID
  - 用户邮箱
  - 用户显示名
  - 商品名称
  - 租赁 ID
  - Sub2 Key ID
  - 租赁 endpoint
- 汇总卡跟随当前筛选条件：
  - 订单数
  - 订单金额
  - 已付金额
  - 相关租赁用量收入
  - 相关供给方收入
- 响应新增 `breakdown` 分布摘要，覆盖订单状态、资源类型、商品排行和租赁交付状态。
- Admin `售出情况` 页面接入筛选、分页和 `导出全部筛选`。
- Admin `售出情况` 页面新增分布表，帮助管理员判断售出结构和交付状态。
- 售出订单详情、取消和退款操作继续复用订单详情与售后接口。

## 验收方式

本地验证：

- `npm --prefix user/apps/api run typecheck`
- `npm --prefix user/apps/admin run typecheck`
- `npm --prefix user/apps/api run build`
- `npm --prefix user/apps/admin run build`

线上验证建议：

1. 进入 Admin `售出情况`。
2. 使用订单状态筛选，例如 `active` 或 `refunded`。
3. 确认表格分页总数、汇总卡和订单列表一致。
4. 搜索用户邮箱、商品名称或租赁 ID，确认结果收敛。
5. 点击 `导出全部筛选`，确认 CSV 行数等于当前筛选后的 `total`。
