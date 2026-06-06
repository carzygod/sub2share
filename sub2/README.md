# 智算驿站 Sub2API 内核

`app/sub2` 存放 Sub2API 网关内核、部署配置、补丁记录和适配说明。

| 路径 | 说明 |
| --- | --- |
| `upstream/sub2api` | Sub2API 上游源码浅克隆 |
| `deploy` | 智算驿站自己的部署编排 |
| `patches` | 对 Sub2API 的补丁记录 |
| `adapter-notes` | 业务系统与 Sub2API 的对象映射说明 |
| `scripts` | 同步、备份、启动脚本 |

当前原则：优先保持 Sub2API 上游可更新，业务逻辑放在 `app/user`，通过 Adapter 集成。

