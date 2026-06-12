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
- 订单状态：提示 failed、refunding 等需要人工复查的订单，并返回最近问题样本；failed 订单会区分可重试开通候选和需要人工复查的阻塞原因。
- 商品目录：检查 active 商品是否存在当前下单链路可直接购买的 active 价格，包括固定价格和按量价格。
- 售出交付：扫描近期 `paid`、`provisioning`、`active` 订单，检查租赁、endpoint、Sub2 Key 和 active 本地 API Key 是否完整。
- 租赁可用性：检查 active 租赁是否已过期，以及 low_balance、limited、suspended 等受限租赁。
- API Key 可用性：检查 OpenAI/Codex 本地反代 active Key 是否能通过用户、钱包、租赁、到期时间和 Key hash 准入条件。
- 余额账户：检查钱包可用余额或冻结余额是否出现负数；出现负数时返回最近钱包问题样本，包含 `walletId`、`walletAccountId`、`userId`、`userEmail`、`availableBalance`、`frozenBalance` 和 `updatedAt`，便于管理员直接打开余额账户或用户详情。
- OAuth State：检查 OAuth state 存储是否适合当前环境；生产环境内存存储或 Redis 不可达会标记 error。
- Auth Tokens：检查 access/refresh token 有效期配置，以及生产环境是否使用独立的 `JWT_REFRESH_SECRET`。
- 部署运行态：检查 API 当前进程 cwd、release root 和 `.release-marker`；当进程仍运行在 `user-replaced-*` 旧 release 或 `user.new-*` staging 目录时标记 error。
- 前端入口：检查 Web/Admin 静态入口是否可访问，并确认返回 HTML。
- 管理员后端能力覆盖：检查用户、共享资源、余额、售出和 OpenAI/Codex 反代相关管理员 API 路由是否按能力矩阵注册。
- 管理前端入口：检查 Admin 侧边栏是否覆盖用户、共享资源、余额、售出和 OpenAI/Codex 反代核心范围，所有列表型管理页面是否可达，以及 view 是否重复。
- CORS 白名单：检查生产环境 API CORS 是否收敛到明确 origin，是否误用 `*`，是否允许本地 OpenAI/Codex 反代的完整方法集合，以及是否继续暴露本地和上游 request id 诊断响应头。
- 支付充值：检查 `PAYMENT_PROVIDER` 配置，生产环境 mock 充值标记 warning，禁用充值标记 error，并返回最近 5 条充值流水候选样本。
- 共享资源：检查异常资源、Codex 资源总数和 online Codex 资源数量；当没有 online Codex 共享资源或存在异常资源时返回问题样本和候选资源样本。
- 资源凭据：检查 `API_KEY_ENCRYPTION_SECRET` 是否已配置，并统计 active OpenAI refresh token 是否已绑定可应用的 Sub2 账号；当 Sub2 上游无 active OpenAI 账号且没有可应用凭据时标记 error。
- Sub2/OpenAI 上游：读取 Sub2API 网关状态和 OpenAI 分组可调度情况；若存在阻断原因，会返回结构化问题样本，包含 blocking reason、默认分组、OpenAI 账号数、active 账号数、网关可达性和维修建议。
- OpenAI 反代契约：检查公开 endpoint 是否指向 `/v1`、CORS 是否暴露本地/上游 request id、本地错误类型是否符合 OpenAI 风格分类。
- OpenAI 反代运行态：统计当前 limiter store、共享作用域、Redis 可达性、活跃并发租约和 RPM/TPM 速率窗口；生产环境显式使用 memory 限流器标记 warning，Redis 不可达标记 error。
- 本地反代自检：读取最近审计日志中的 OpenAI/Codex 端到端 smoke test 结果，包括直接 smoke、资源凭据应用 smoke 和 Sub2 直接应用 refresh token smoke；证据包含主代理请求日志和可选上游 request id；最近失败标记 error，超过 24 小时或缺少证据标记 warning，不会在巡检时主动发起真实 OpenAI 请求。
- 反代请求：统计最近 1 小时 `/v1/*` 请求、4xx、5xx、本地/上游错误码、客户端中途断开、上游流异常和上游流空闲超时，并返回最近异常反代请求样本；上游 HTTP `>=400` 会以 `upstream_http_<status>` 进入错误码，样本会携带请求模型。
- 用量同步：检查 Sub2 usage 同步状态，超过 24 小时未成功同步会标记 warning，失败会标记 error，并展示最近导入、恢复、跳过和未匹配数量。
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
- 巡检问题样本，会聚合展示 `detail.issues` 中的级别、检查项、类型、定位对象、说明和可用操作；可按 issue 中的资源、共享资源列表、用户、订单、租赁、Key、模型、余额、用量、商品、结算、提现、Sub2 上游阻断或反代请求定位字段直接打开对应管理入口。共享资源列表跳转会复用 `resourceType` 和 `resourceStatus` 作为筛选条件。
- 巡检候选样本，会聚合展示 `detail.samples` 中的检查项、定位对象和摘要；资源凭据和共享资源巡检会用它展示可操作资源，并支持直接打开共享资源详情。

管理后台首页 `系统状态` 区块会读取最近一次 `SystemHealthSnapshot`，展示整体状态、巡检时间、来源和 ok/warning/error 摘要；如果尚无快照，则显示无巡检快照，不再使用静态正常文案。

## 设计边界

- 本功能只读，不自动修复问题。
- Sub2/OpenAI 上游状态仍依赖 Sub2API 实时返回；巡检问题样本只展示阻断原因和聚合计数，不返回上游凭据或明文 Key。
- 账务对账采用当前有界扫描策略，适合后台快速巡检；全量对账仍可后续扩展为异步任务。
- 售出交付巡检默认扫描最近 200 条应交付订单，并返回最多 50 条问题样本，已取消、已退款等终态订单不要求保持可用交付。
- 商品目录巡检默认扫描最近 200 个 active 商品，并返回最多 50 条问题样本；公开商品接口会隐藏当前下单链路不支持的 active 价格，但会展示按量商品的 active 价格。
- API Key 可用性巡检只聚焦 OpenAI/Codex 本地 `/v1/*` 反代准入，不把其他资源类型的 active Key 视为错误。
- API Key 可用性巡检默认扫描最近 500 条 active OpenAI/Codex Key，并在 `detail.issues` 中返回最多 50 条样本，避免巡检响应过大。
- OpenAI 反代契约巡检是静态契约检查，不会发起真实上游请求；真实 Sub2API 调度仍由 `Sub2/OpenAI 上游` 和反代 smoke test 覆盖。
- OpenAI 反代运行态巡检只读取 limiter 状态，不会改变请求拦截行为；Redis 模式适合多实例一致限流，memory 模式只适合本地开发、测试或明确的单实例部署。
- 本地反代自检巡检只读取 `AuditLog` 中最近 smoke 证据，不会自动创建临时 Key、订单、租赁或真实请求；实时验收仍通过 `反代状态 -> 端到端自检` 执行。
- 管理后台问题样本表默认只展示后端返回的 issue 样本，候选样本表只展示后端返回的 samples 样本，前端每类最多聚合 100 条，避免巡检页因大量问题产生过重渲染。
- 巡检问题样本的操作按钮只使用后端返回的定位字段做列表筛选、详情打开或跳转到反代状态页，不会绕过对应管理页面的权限、分页和脱敏边界。
- 订单状态巡检默认返回最近 50 条 failed/refunding 订单问题样本，只做定位和重试可行性提示，不自动执行订单重试、退款或账务调整。
- 反代请求巡检默认只返回最近 20 条异常样本，且只包含 request id、上游 request id、日志 id、租赁、Key 元数据、模型、HTTP 状态、错误码、路径、耗时和时间，不返回请求体或明文 Key；上游 HTTP 错误样本可通过 `upstream_http_<status>` 区分。
- 用量同步调度巡检只读环境配置，不会启动或停止后台同步任务。
- Pending 用量账务巡检只读，不自动扣费；真正的恢复扣费仍由 Sub2 usage 同步任务执行。
- OAuth State 巡检只判断 state 存储模式和 Redis 连通性，不会发起真实第三方 OAuth 登录。
- Auth Tokens 巡检只检查环境配置，不解码真实用户 token，也不会撤销既有 token。
- 部署运行态巡检只读取当前进程目录和 release marker，不会主动重启服务；若发现旧 release 或 staging 目录，仍需管理员重新从当前 release 启动服务。
- 管理前端入口巡检只读取共享 Admin surface 清单，不主动加载浏览器或点击页面；真实静态入口可达性由 `frontendRuntime` 检查覆盖。
- CORS 白名单巡检只检查配置、允许方法和暴露头，不主动发起跨域请求；真实浏览器 preflight 仍由 Fastify CORS 中间件执行，并由 API 测试覆盖 `/v1/responses/:id` 的 `PATCH` 预检。
- 资源凭据巡检只做只读统计，不解密凭据、不返回密文或明文；候选样本只展示资源 ID、Sub2 账号 ID、供给方邮箱和凭据摘要。
- 共享资源巡检只做只读统计，不自动上线、下线或测试资源；异常资源和非 online Codex 资源样本只展示资源 ID、类型、状态、Sub2 账号 ID、供给方邮箱和更新时间。
- 支付充值巡检只判断当前后端充值模式是否可用或存在明显风险，不等同于真实支付渠道的全链路验收。
- 支付充值候选样本只返回充值流水元数据、用户/钱包定位字段和金额摘要，不返回任何支付渠道敏感凭据；真实支付回调验签仍需后续真实支付 provider 接入。
- 巡检结果用于帮助管理员定位方向，具体修复仍通过订单、租赁、余额、资源、反代状态、反代请求、账务对账、结算和提现等页面执行。
- 客户端中途断开通常标记为 warning，用于提示长流式请求或客户端取消较多；上游流错误、异常关闭或空闲超时会标记为 error，提示 Sub2API 或上游连接链路需要复查。

## 巡检历史

- 每次管理员刷新当前巡检会写入一条 `source=manual` 快照。
- 每次管理员运行安全维护后会写入一条 `source=maintenance` 快照。
- 管理后台会展示最近 12 条巡检历史，便于判断问题是否持续存在。
- 管理后台新增独立 `巡检历史` 入口，可分页查看、按状态筛选、按快照/来源/操作者搜索，并导出 CSV。
- 管理后台首页会读取最近一条巡检快照作为经营首页风险信号，但不会触发新的巡检或写入新的快照。

## 2026-06-12 Update: Production Resource Scope

`GET /api/admin/system-health` now treats supplier resource availability as a production resource check:

- Internal health-check supplier resources are excluded from `resources` status counts.
- The current internal supplier resource marker is `sub2AccountId=admin-disabled-smoke-resource`.
- `resources.metrics.ignoredInternalResources` reports ignored internal supplier resources for operator visibility.
- `codex_online_resource_missing` now points operators to create or repair production Codex resources instead of opening the internal disabled smoke resource.
- When no concrete production Codex resource exists and exactly one supplier is tied to an active user, `codex_online_resource_missing` includes that supplier email so the admin create-resource form can be prefilled.
- `resourceCredentials` only counts OpenAI refresh token credentials attached to production Codex resources as repair candidates.
- `resources.metrics.issueSamples` reports structured resource health issues; `resources.metrics.resourceSamples` reports concrete resource rows returned as repair candidates.

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 API typecheck | 通过 |
| 本地 Admin typecheck | 通过 |
| 本地 API build | 通过 |
| 本地 Admin build | 通过 |

## 2026-06-12 Update: OpenAI Proxy Runtime Contract

`openAiProxyContract` 巡检从静态接口契约扩展为“接口契约 + 运行契约”：

- 继续检查公开 endpoint 是否指向 `/v1`、`/v1/*` 路由覆盖、GET/HEAD/POST/PUT/PATCH/DELETE 方法、核心 OpenAI/Codex 路径、CORS 本地/上游 request id 暴露和 OpenAI 风格错误类型。
- 新增运行指标：
  - `requestBodyMode=raw-buffer`
  - `parsesAllContentTypesAsBuffer=true`
  - `forwardsOriginalBodyBytes=true`
  - `bodylessMethods=GET,HEAD`
  - `bodyLimitBytes`
  - `upstreamTimeoutMs`
  - `streamIdleTimeoutMs`
  - `upstreamAcceptEncoding=identity`
  - `stripsInboundAuthorization=true`
  - `reinjectsLocalBearerToSub2=true`
  - `stripsInboundAcceptEncoding=true`
  - `forwardsRequestId=true`
  - `capturesUpstreamRequestId=true`
  - `upstreamRequestIdHeaders=x-request-id,openai-request-id,x-openai-request-id,request-id`
  - `abortsUpstreamOnClientClose=true`
  - `logsStreamCompletion=true`
  - `logsStreamErrors=true`
  - `hasStreamIdleTimeout=true`
- 如果 `bodyLimitBytes`、`upstreamTimeoutMs` 或 `streamIdleTimeoutMs` 不是正整数，巡检会标记 `error`。

该检查仍然不会主动发起真实上游请求；真实 Sub2API/OpenAI 可调度性仍由 `Sub2/OpenAI 上游`、`本地反代自检` 和 `反代请求` 日志共同证明。

## 2026-06-12 Update: OpenAI Proxy CORS Methods

API CORS 配置现在显式复用本地 `/v1/*` 反代路由方法：

- `GET`
- `HEAD`
- `POST`
- `PUT`
- `PATCH`
- `DELETE`

`corsPolicy.metrics.allowedMethods` 会展示该方法集合。该检查用于帮助管理员确认浏览器端 OpenAI/Codex 兼容客户端的 OPTIONS preflight 与本地反代路由一致，避免 `/v1/responses/:id` 等非 POST 请求在进入本地鉴权、余额、租赁和 Sub2API 转发前被 CORS 拦截。

## 2026-06-12 Update: Production Mock Recharge Gate

`payments` / `支付充值` 巡检现在把生产 mock 充值从“配置风险”拆成“入口是否真的开放”和“近期是否已经产生账务影响”：

- 新增环境变量 `ALLOW_PRODUCTION_MOCK_RECHARGE`，默认 `false`。
- 生产环境 `PAYMENT_PROVIDER=mock` 且未显式允许 mock 充值时，用户充值接口会返回 `503 recharge_unavailable`。
- `payments.metrics` 返回 `allowProductionMockRecharge`、`rechargeEndpointEnabled` 和 `productionMockRechargeBlocked`。
- 生产默认阻断 mock 充值且没有近期充值流水时，巡检标记为 `ok`。
- 生产显式允许 mock 充值时，巡检标记为 `warning`，issue type 为 `production_mock_recharge`。
- 生产已阻断 mock 充值但仍发现最近充值流水时，巡检标记为 `warning`，issue type 为 `production_mock_recharge_recent_ledger`，并继续提供充值流水样本和后台跳转字段。

该检查仍然不等同于真实支付全链路验收；它只证明 mock 充值是否被生产默认阻断，以及历史或近期 mock 充值是否仍需要管理员复核。
