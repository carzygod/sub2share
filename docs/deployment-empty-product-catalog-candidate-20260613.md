# 2026-06-13 空商品目录候选商品定位发布记录

## 发布版本

- Commit：`823e51836a0a1733f154cef2fc62cafc0bb2bea2`
- 主题：`productCatalog` 空目录 warning 指向可修复的 draft/offline 候选商品。
- 服务器：`192.168.31.26`
- 发布目录：`/opt/zhisuan-yizhan/user`
- Release marker：`deployed_at=20260613T032348Z`

## 部署验证

部署脚本：`/opt/zhisuan-yizhan/user/scripts/deploy-production.sh`

脚本内验证通过：

- Prisma generate：通过。
- Prisma migrate deploy：无待执行迁移。
- API typecheck：通过。
- Admin typecheck：通过。
- API tests：146/146 通过。
- Admin tests：17/17 通过。
- Workspace build：通过。
- 本机探针：
  - `http://127.0.0.1:4100/health -> 200`
  - `http://127.0.0.1:4100/ready -> 200`
  - `http://127.0.0.1:3100/ -> 200`
  - `http://127.0.0.1:3101/ -> 200`

运行态验证：

- `zyz-api.service`：active
- `zyz-admin.service`：active
- `zyz-web.service`：active
- `sub2api.service`：active
- 部署运行态巡检：`ok`
- 当前 API 进程运行在 release `823e51836a0a1733f154cef2fc62cafc0bb2bea2`
- `runningFromReplacedRelease=false`
- `runningFromStagingRelease=false`

## 线上健康复查

`GET /api/admin/system-health` 返回：

- 总体状态：`error`
- 汇总：`29` 项检查，`24 ok / 2 warning / 3 error`
- 当前非 ok 项：
  - `productCatalog.warning`
  - `resources.warning`
  - `resourceCredentials.error`
  - `sub2.error`
  - `localProxySmoke.error`

商品目录候选定位已经生效：

- `productCatalog.status=warning`
- `summary=1 个商品目录可购买性问题`
- `metrics.matched=0`
- `metrics.totalProducts=2`
- `metrics.emptyActiveProductCatalog=1`
- `primaryIssue.type=empty_active_product_catalog`
- `primaryIssue.productId=00000000-0000-0000-0000-000000000101`
- `primaryIssue.productName=Codex 标准租赁`
- `primaryIssue.productStatus=offline`
- `primaryIssue.priceId=d231fcef-2dc6-4317-b44e-a93cad3ab0ea`
- `primaryIssue.resourceType=codex`

管理员首页预览已经透传候选字段：

- `latestSystemHealth.deliveryBlocker.checkId=productCatalog`
- `latestSystemHealth.deliveryBlocker.productName=Codex 标准租赁`
- `latestSystemHealth.deliveryBlocker.productStatus=offline`
- `latestSystemHealth.deliveryBlocker.priceId=d231fcef-2dc6-4317-b44e-a93cad3ab0ea`
- `criticalChecks` 包含 `productCatalog:warning`
- `criticalChecks.productCatalog.primaryIssue.productStatus=offline`

管理员入口覆盖仍为正常：

- API：`5/5` 核心范围，`66/66` 路由，`66/66` 入口。
- 前端：`5/5` 核心范围，`16` 个列表入口，`5` 个关键入口。

## 剩余阻断

当前阻断不是本次部署失败，而是生产真实上游凭据不可用：

- `sub2.error`：`openai_group_has_no_active_accounts`
- 候选 Sub2 账号：`#2`
- 上游错误码：`token_invalidated`
- `resourceCredentials.error`：无 active `openai_refresh_token`
- `resources.warning`：无 online Codex 共享资源
- `localProxySmoke.error`：`/v1/responses` 返回 `HTTP 503 / api_error / Service temporarily unavailable`

生产数据摘要：

- 用户：`11`
- 商品：`4`
- active 商品：`0`
- active 价格：`1`
- 订单：`22`
- active 租赁：`0`
- online Codex 资源：`0`
- active OpenAI refresh token 凭据：`0`

## 结论

本轮发布完成后，空商品目录巡检不再只给目录级 warning，而是能在系统健康和管理员首页直接定位到现有候选商品。系统内核、反代契约和管理员入口覆盖继续保持通过状态；真实 Codex/OpenAI 生成仍被有效 OpenAI refresh token、active Sub2 上游账号和 online Codex 共享资源缺失阻断。
