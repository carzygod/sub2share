# sub2share

这是 **智算驿站** 的代码仓库根目录，聚焦于「闲置 API 额度租赁」平台的双侧系统建设。

## 仓库结构

```text
app/
├─ sub2/     # 与 Sub2API 相关的服务适配与对接能力
└─ user/     # 用户侧平台（前后端）与管理员后台
   ├─ apps/
   │  ├─ web    # B2C 用户站（官网入口 + 账号管理）
   │  ├─ admin  # 平台运营后台
   │  └─ api    # 业务 API 服务
   ├─ packages/ # 公共前端/共享代码
   ├─ prisma/   # 数据模型与迁移
   ├─ docker/
   └─ scripts/
```

## 核心能力

1. 用户可通过 Google / X OAuth 登录与租赁控制台进行交易管理。
2. 供应商可提交可出租的闲置额度资源并配置供应策略。
3. 订单系统支撑闲置额度的出租、租用与账务分账流程。
4. Sub2API 侧承担上游接口透传与调用编排（中转分发链路）。

## 环境与依赖

- Node.js >= 18
- pnpm（推荐）
- PostgreSQL（用于平台主库）
- Docker / Docker Compose（用于本地联调）

## 快速启动

### 1. 安装依赖

```bash
cd app/user
pnpm install
```

### 2. 本地启动

```bash
pnpm --filter @zyz/web dev
pnpm --filter @zyz/admin dev
pnpm --filter @zyz/api dev
```

### 3. 生产构建

```bash
pnpm --filter @zyz/web build
pnpm --filter @zyz/admin build
pnpm --filter @zyz/api build
```

## 环境变量

仓库中保留 `.env.example` 示例文件，请基于该示例创建各环境变量文件：

- `app/user/.env.example`
- `app/user/.env.production`（按需）
- `app/sub2/.env.example`（按需）

### OAuth 提示

- 平台用户登录仅保留 Google 与 X。
- 生产环境请在云服务商控制台绑定已备案/可达的正式域名，并同步设置回调地址。

## 建议开发流程

1. 先在 `app/user` 完成业务模型与鉴权链路开发。
2. 将资源上架、租赁、支付与账单对账逻辑跑通。
3. 联调 `sub2` 的链路能力与限流/扣费策略。
4. 在 staging 完整演练「登录→下单→分配→结算」闭环后发布生产。

## 目录归档与版本管理

- 代码仓库建议按 `feat/`, `fix/`, `chore/`, `docs/` 前缀进行分支管理。
- 每次发布前先核对 `dist`、`node_modules`、本地运行日志不进入提交记录。

## 贡献约定

- 变更需附带背景与验收要点。
- 对 `user` 与 `sub2` 的改动保持边界清晰，便于独立部署。
- 避免提交敏感凭据、第三方 Secret、真实客户数据与私钥文件。

## 许可证

请在上游文档中按项目实际合规要求补充 LICENSE/合规条款。
