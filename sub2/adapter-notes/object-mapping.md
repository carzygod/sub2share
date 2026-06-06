# Sub2API 对象映射

| 智算驿站对象 | Sub2API 对象 | 说明 |
| --- | --- | --- |
| 买家用户 | User | 可按买家或租赁实例创建 |
| 租赁实例 | API Key / Group | 每个租赁实例绑定独立 Key |
| 套餐限额 | Limit / Rate config | 并发、RPM、TPM、请求量、消费上限 |
| 供给方资源 | Upstream Account | 进入账号池参与调度 |
| 用量记录 | Usage / Request log | Billing Worker 的同步来源 |
| 资源状态 | Account status | 用于供给评级和派单权重 |

## Adapter 约定

业务系统只调用 `Sub2ApiClient`，不在业务模块内直接拼 Sub2API URL。

首期需要的网关能力：

| 能力 | 用途 |
| --- | --- |
| 创建网关用户 | 买家租赁开通 |
| 创建 API Key | 返回给买家配置工具 |
| 设置限额 | 套餐并发与请求限制 |
| 启用/禁用 Key | 到期、欠费、退款、风控 |
| 拉取用量 | 计费、分润、对账 |
| 获取账号状态 | 供给池监控 |

