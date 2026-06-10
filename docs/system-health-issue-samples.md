# 系统巡检问题样本展示

实现日期：2026-06-10

## 背景

`GET /api/admin/system-health` 已经为部分检查项返回 `detail.issues`，例如 OpenAI/Codex API Key 准入、OpenAI 反代契约和售出交付阻断。此前管理后台只展示检查项状态、结论和指标，管理员需要直接调用 API 才能看到具体问题样本。

## 已实现范围

- 管理后台 `可用性巡检` 页面新增 `巡检问题样本` 表。
- 页面会从每个检查项的 `detail.issues` 中抽取最多 100 条样本。
- 问题样本展示字段：
  - 级别：`error`、`warning` 或检查项状态。
  - 检查项：检查项名称和 ID。
  - 类型：后端返回的 `type`。
  - 对象：自动拼接 `productId`、`priceId`、`orderId`、`rentalId`、`apiKeyId`、`userId`、`bindingId`、`refId`、`expected`、`actual` 等定位字段。
  - 说明：后端返回的 `message`，没有 message 时回退为紧凑 JSON。

## 管理价值

- 售出交付巡检发现缺租赁、缺 endpoint、缺 Sub2 Key、缺 active 本地 API Key 时，管理员可以直接看到受影响订单和租赁。
- API Key 可用性巡检发现钱包、租赁、Key hash、到期等准入问题时，管理员可以直接定位 Key、租赁和用户。
- OpenAI 反代契约巡检发现 endpoint、CORS 或错误类型问题时，管理员可以在同一页看到具体契约问题。
- Pending 用量账务巡检发现待恢复扣费 usage 时，管理员可以直接看到 usage、租赁、用户、待扣金额、待结算金额和积压时长。

## 验收方式

- `npm.cmd --prefix user/apps/admin run typecheck`
- `npm.cmd --prefix user/apps/admin run build`
