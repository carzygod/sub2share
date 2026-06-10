# 系统可用性巡检

实现日期：2026-06-10

## 背景

平台已经具备用户、订单、租赁、余额、共享资源、Sub2API 反代、用量同步、账务对账和反代请求日志等管理能力。为了让管理员可以系统性复查整体可用性，本次新增统一巡检入口，把分散在多个页面和日志里的健康信号聚合成结构化检查项。

## 后端接口

- 新增接口：`GET /api/admin/system-health`
- 新增接口：`GET /api/admin/system-health/snapshots`
- 权限要求：`operator` 或 `admin`
- 返回内容：
  - `checkedAt`：巡检时间。
  - `status`：整体状态，取值为 `ok`、`warning`、`error`。
  - `summary`：检查项总数和不同级别数量。
  - `checks`：逐项检查结果。

## 巡检范围

当前覆盖以下检查项：

- 数据库：确认 Prisma 查询正常。
- 用户状态：统计 active、disabled、banned 用户。
- 订单状态：提示 failed、refunding 等需要人工复查的订单。
- 商品目录：检查 active 商品是否存在当前下单链路可直接购买的 active 价格，包括固定价格和按量价格。
- 售出交付：扫描近期 `paid`、`provisioning`、`active` 订单，检查租赁、endpoint、Sub2 Key 和 active 本地 API Key 是否完整。
- 租赁可用性：检查 active 租赁是否已过期，以及 low_balance、limited、suspended 等受限租赁。
- API Key 可用性：检查 OpenAI/Codex 本地反代 active Key 是否能通过用户、钱包、租赁、到期时间和 Key hash 准入条件。
- 余额账户：检查钱包可用余额或冻结余额是否出现负数。
- OAuth State：检查 OAuth state 存储是否适合当前环境；生产环境内存存储或 Redis 不可达会标记 error。
- Auth Tokens：检查 access/refresh token 有效期配置，以及生产环境是否使用独立的 `JWT_REFRESH_SECRET`。
- 支付充值：检查 `PAYMENT_PROVIDER` 配置，生产环境 mock 充值标记 warning，禁用充值标记 error。
- 共享资源：检查异常资源和 online Codex 资源数量。
- 资源凭据：检查 `API_KEY_ENCRYPTION_SECRET` 是否已配置，并统计 active OpenAI refresh token 是否已绑定可应用的 Sub2 账号；当 Sub2 上游无 active OpenAI 账号且没有可应用凭据时标记 error。
- Sub2/OpenAI 上游：读取 Sub2API 网关状态和 OpenAI 分组可调度情况。
- OpenAI 反代契约：检查公开 endpoint 是否指向 `/v1`、CORS 是否暴露 `x-proxy-request-id`、本地错误类型是否符合 OpenAI 风格分类。
- OpenAI 反代运行态：统计当前 limiter store、共享作用域、Redis 可达性、活跃并发租约和 RPM/TPM 速率窗口；生产环境显式使用 memory 限流器标记 warning，Redis 不可达标记 error。
- 反代请求：统计最近 1 小时 `/v1/*` 请求、4xx、5xx、本地错误码、客户端中途断开、上游流异常和上游流空闲超时。
- 用量同步：检查 Sub2 usage 同步状态，超过 24 小时未成功同步会标记 warning，失败会标记 error。
- 用量同步调度：检查 `SUB2_USAGE_SYNC_INTERVAL_MS` 与 `SUB2_USAGE_SYNC_ON_START`，生产环境禁用定时同步会标记 error。
- Pending 用量账务：统计 `pending` usage 数量、待扣金额、待结算金额、最早发生时间和问题样本；若 pending usage 仍位于 active 租赁，标记 error。
- 账务对账：复用账务对账结果，发现一致性问题时标记 error。
- 结算提现：统计到期待释放结算和待处理提现。

## 管理员入口

管理后台新增侧边栏入口：`可用性巡检`。

页面展示：

- 整体状态。
- 检查时间。
- 检查项数量、正常数量、警告数量、错误数量。
- 每个检查项的状态、结论和关键指标。
- 巡检问题样本，会聚合展示 `detail.issues` 中的级别、检查项、类型、定位对象和说明。
- 巡检候选样本，会聚合展示 `detail.samples` 中的检查项、定位对象和摘要；资源凭据巡检会用它展示可应用到 Sub2 的候选凭据资源。

管理后台首页 `系统状态` 区块会读取最近一次 `SystemHealthSnapshot`，展示整体状态、巡检时间、来源和 ok/warning/error 摘要；如果尚无快照，则显示无巡检快照，不再使用静态正常文案。

## 设计边界

- 本功能只读，不自动修复问题。
- Sub2/OpenAI 上游状态仍依赖 Sub2API 实时返回。
- 账务对账采用当前有界扫描策略，适合后台快速巡检；全量对账仍可后续扩展为异步任务。
- 售出交付巡检默认扫描最近 200 条应交付订单，并返回最多 50 条问题样本，已取消、已退款等终态订单不要求保持可用交付。
- 商品目录巡检默认扫描最近 200 个 active 商品，并返回最多 50 条问题样本；公开商品接口会隐藏当前下单链路不支持的 active 价格，但会展示按量商品的 active 价格。
- API Key 可用性巡检只聚焦 OpenAI/Codex 本地 `/v1/*` 反代准入，不把其他资源类型的 active Key 视为错误。
- API Key 可用性巡检默认扫描最近 500 条 active OpenAI/Codex Key，并在 `detail.issues` 中返回最多 50 条样本，避免巡检响应过大。
- OpenAI 反代契约巡检是静态契约检查，不会发起真实上游请求；真实 Sub2API 调度仍由 `Sub2/OpenAI 上游` 和反代 smoke test 覆盖。
- OpenAI 反代运行态巡检只读取 limiter 状态，不会改变请求拦截行为；Redis 模式适合多实例一致限流，memory 模式只适合本地开发、测试或明确的单实例部署。
- 管理后台问题样本表默认只展示后端返回的 issue 样本，候选样本表只展示后端返回的 samples 样本，前端每类最多聚合 100 条，避免巡检页因大量问题产生过重渲染。
- 用量同步调度巡检只读环境配置，不会启动或停止后台同步任务。
- Pending 用量账务巡检只读，不自动扣费；真正的恢复扣费仍由 Sub2 usage 同步任务执行。
- OAuth State 巡检只判断 state 存储模式和 Redis 连通性，不会发起真实第三方 OAuth 登录。
- Auth Tokens 巡检只检查环境配置，不解码真实用户 token，也不会撤销既有 token。
- 资源凭据巡检只做只读统计，不解密凭据、不返回密文或明文；候选样本只展示资源 ID、Sub2 账号 ID、供给方邮箱和凭据摘要。
- 支付充值巡检只判断当前后端充值模式是否可用或存在明显风险，不等同于真实支付渠道的全链路验收。
- 巡检结果用于帮助管理员定位方向，具体修复仍通过订单、租赁、余额、资源、反代状态、反代请求、账务对账、结算和提现等页面执行。
- 客户端中途断开通常标记为 warning，用于提示长流式请求或客户端取消较多；上游流错误、异常关闭或空闲超时会标记为 error，提示 Sub2API 或上游连接链路需要复查。

## 巡检历史

- 每次管理员刷新当前巡检会写入一条 `source=manual` 快照。
- 每次管理员运行安全维护后会写入一条 `source=maintenance` 快照。
- 管理后台会展示最近 12 条巡检历史，便于判断问题是否持续存在。
- 管理后台新增独立 `巡检历史` 入口，可分页查看、按状态筛选、按快照/来源/操作者搜索，并导出 CSV。
- 管理后台首页会读取最近一条巡检快照作为经营首页风险信号，但不会触发新的巡检或写入新的快照。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 API typecheck | 通过 |
| 本地 Admin typecheck | 通过 |
| 本地 API build | 通过 |
| 本地 Admin build | 通过 |
