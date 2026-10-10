# AIGC Provider Runtime Kit + 管理中控

[![CI](https://github.com/Hhh2178/aigc-provider-runtime-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Hhh2178/aigc-provider-runtime-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)

一套可直接落地的 **AIGC 服务商接入与运行底座**：把"配服务商 → 管模型 → 发任务 → 拿结果 → 算成本"抽成独立后台，让任意业务系统一行接入九种上游协议，而不用每接一个产品就重写一遍接入层。

> 当前版本：SDK `0.3.x`（npm 发布，零运行时依赖）· 中控 `0.1.x`（本仓库 workspace 内直接部署）。

## 你能得到什么

- **统一 Provider 管理**：服务商 CRUD、连通性探测（probe）、上游模型列表拉取与批量导入、分能力连通测试（图像生成测试需显式 `confirmCost`，防止误烧 credits）。
- **RunningHub 深度接入**：工作流/AI 应用目录、分组、多 Key 池（并发上限、默认 Key）、从文档/示例一键生成条目草案（analyze）、条目本地校验。
- **统一任务 API**：`POST /api/tasks` 提交（幂等键）、`GET /api/tasks/:id` 查询进度与产物、`POST /api/tasks/:id/cancel` 取消、终态可回调宿主（webhook）。
- **九种协议执行**：`openai / gemini / runninghub / volcengine / apimart / aicopy / modelscope / custom / grsai_draw`，全部经 mock 上游矩阵测试验证，不依赖任何真实服务商账号即可跑通。
- **生产级细节**：凭据 AES-256-GCM 加密落库（API 只见 `...last4`）、幂等入队、崩溃任务自动重排（stale reaper）、产物物化到本地存储（`CC_STORAGE_DIR`）、管理操作全量审计。
- **成本账本**：模型 / RH 目录双范围定价，任务成功自动计费（按次、按秒、上游 `consumeMoney` 优先），管理端可查分日汇总。
- **内置管理控制台**：`GET /admin` 开箱即用的无构建页面——登录、服务商、模型、任务轮询、定价与成本一页搞定。

## 架构与职责边界

| 本仓库提供 | 由你的业务系统负责 |
| --- | --- |
| Provider/模型/密钥的存储与加密、管理 API、审计 | 终端用户账号、产品 UI |
| RunningHub 目录/分组/Key 池管理与草案分析 | 业务级计费汇总与商业策略 |
| 任务提交/查询/取消 + PG 队列 + worker 执行 | 任务何时发起、对谁发起的业务决策 |
| 九协议适配、超时/取消/重试、结果归一化 | 面向最终用户的产物展示与存储策略 |
| 成本账本（明细粒度） | 面向客户的账单与结算 |
| 产物物化与文件服务 | 分发 CDN、权限模型 |

两层也可以分开用：`aigc-provider-runtime-kit` 是**可嵌入任意应用的执行 SDK**；`@aigc-kit/control-center` 是**独立部署的中控后台**，业务系统通过 HTTP 接入。

## 环境要求

- Node.js ≥ 22（ESM，依赖 `fetch` / `AbortSignal` 等 Web 标准）
- 控制中心：PostgreSQL 14+（测试可用内置的 embedded-postgres 自托管，无需预装）
- Redis：**不需要**（队列用 PG 原子领取实现）

## 快速开始（控制中心）

```bash
git clone https://github.com/Hhh2178/aigc-provider-runtime-kit.git
cd aigc-provider-runtime-kit
npm install
npm run build

CC_DATABASE_URL=postgres://user:pass@localhost:5432/control_center \
CC_SECRET_KEY=请换成至少32位的随机串 \
CC_ADMIN_PASSWORD=请设置强密码 \
CC_PORT=8787 \
node packages/control-center/dist/index.js

# 另开一个进程跑执行器
CC_DATABASE_URL=postgres://user:pass@localhost:5432/control_center \
CC_SECRET_KEY=请换成至少32位的随机串 \
node packages/control-center/dist/worker/worker.js
```

启动后访问 **`http://localhost:8787/admin`** 使用管理控制台，或直接调 API：

```bash
# 1) 管理员登录（拿到会话 cookie）
curl -c cookies.txt -X POST http://localhost:8787/api/auth/admin-login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@localhost","password":"你的密码"}'

# 2) 录入服务商并探测连通性
curl -b cookies.txt -X POST http://localhost:8787/api/admin/providers \
  -H 'content-type: application/json' \
  -d '{"name":"primary","baseUrl":"https://api.example.com/v1","protocol":"openai","enabled":true,"apiKey":"sk-..."}'

# 3) 宿主系统提交任务（配置 CC_TASK_API_TOKEN 后用 Bearer 令牌，否则用 admin 会话）
curl -X POST http://localhost:8787/api/tasks \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer 你的CC_TASK_API_TOKEN' \
  -d '{"capability":"image","providerId":"primary","modelId":"gpt-image-2","input":{"prompt":"一只在海边的橘猫"}}'

# 4) 轮询结果（status=succeeded 时 result.imageUrls / materializedImageUrls 就绪）
curl http://localhost:8787/api/tasks/<taskId> -H 'authorization: Bearer 你的CC_TASK_API_TOKEN'
```

RunningHub 任务改用目录寻址：先在管理端（或 `POST /api/admin/runninghub/analyze`）建好条目，提交时给 `{"capability":"video","providerId":"rh","runninghub":{"catalogId":"rh:workflow:999","input":{"10:video":"素材URL"}}}` 即可。

### 配置项一览

| 环境变量 | 说明 | 默认 |
| --- | --- | --- |
| `CC_DATABASE_URL` | PostgreSQL 连接串（必填） | — |
| `CC_SECRET_KEY` | 凭据加密根密钥（配库后必填，≥32 位） | — |
| `CC_PORT` | HTTP 端口 | `8787` |
| `CC_ADMIN_EMAIL` / `CC_ADMIN_PASSWORD` | 引导管理员账号 | `admin@localhost` / `control-center-admin` |
| `CC_TASK_API_TOKEN` | 宿主任务 API 令牌（`Authorization: Bearer`）；不设则任务接口要求 admin 会话 | 未设置 |
| `CC_STORAGE_DIR` | 产物物化目录（任务成功的远端产物落盘） | 关闭 |
| `CC_WORKER_CONCURRENCY` | worker 并发槽 | `4` |
| `CC_CORS_ORIGIN` | 允许的跨域来源 | 关闭 |
| `CC_TENANT_ID` | 租户标识（多租户预留） | `default` |
| `CC_SESSION_TTL_HOURS` | 会话有效期 | `72` |

全部定义见 [`packages/control-center/src/config.ts`](./packages/control-center/src/config.ts)。

## HTTP API 地图

详细出入参见 [`docs/api-reference.md`](./docs/api-reference.md)。

| 分组 | 端点 | 说明 |
| --- | --- | --- |
| 认证 | `POST /api/auth/admin-login` · `POST /api/auth/logout` · `GET /api/auth/me` | 管理员会话 |
| Provider | `GET/POST /api/admin/providers` · `POST /api/admin/providers/probe` · `POST /api/admin/providers/:id/fetch-models` · `POST /api/admin/providers/:id/import-models` | 服务商管理与探测/导入 |
| 模型 | `GET/POST /api/admin/models` · `POST /api/admin/models/:id/test` | 模型目录与连通测试 |
| RunningHub | `GET/POST /api/admin/runninghub/items` · `POST /api/admin/runninghub/analyze` · `GET/POST /api/admin/runninghub/groups` | 目录条目/分组/草案分析 |
| Key 池 | `GET/PUT /api/admin/providers/:id/runninghub/key-pool` | 多 Key 与并发上限 |
| 任务 | `POST /api/tasks` · `GET /api/tasks/:id` · `POST /api/tasks/:id/cancel` · `GET /api/admin/tasks` | 提交/查询/取消/管理列表 |
| 文件 | `GET /api/tasks/:taskId/files/:filename` | 物化产物下载（防目录穿越） |
| 定价成本 | `GET/PUT/DELETE /api/admin/pricing` · `GET /api/admin/costs/summary` | 定价与成本汇总 |
| 运维 | `GET /healthz` · `GET /admin` | 健康检查与内置控制台 |

## SDK：Package Entrypoints

作为嵌入式库使用（npm：`npm install aigc-provider-runtime-kit`，或 `npm install github:Hhh2178/aigc-provider-runtime-kit`）：

| Entrypoint | 用途 |
| --- | --- |
| `aigc-provider-runtime-kit` | 全部公开导出 |
| `aigc-provider-runtime-kit/runtime` | 统一执行 `runtime.execute(...)`、输入校验、适配器契约 |
| `aigc-provider-runtime-kit/core` | Provider 注册表与校验、参数 schema、multipart、重试、OpenAI 兼容客户端 |
| `aigc-provider-runtime-kit/runninghub` | RunningHub 提交/轮询客户端、目录描述符、输出提取、key 池租约 |

```ts
import { createProviderRegistry, createProviderRuntime, createOpenAICompatibleAdapter, createOpenAICompatibleClient } from "aigc-provider-runtime-kit/runtime";

const registry = createProviderRegistry({ providers: [...], models: [...] });
const runtime = createProviderRuntime({
  registry,
  adapters: [createOpenAICompatibleAdapter({ client: createOpenAICompatibleClient({ baseUrl: "https://api.example.com/v1", apiKey: process.env.KEY! }) })]
});
const result = await runtime.execute({ providerId: "primary", modelId: "m1", input: { prompt: "hello" } });
```

完整 API 参考：[`docs/api-reference.md`](./docs/api-reference.md)；上手指南：[`docs/getting-started.md`](./docs/getting-started.md)。

## Local Development

```bash
npm install
npm run build          # 构建 SDK + control-center
npm run type-check     # 两个 package 的 tsc --noEmit
npm test               # SDK 29 + 中控 71 个测试
npm run test:package   # npm pack + 临时目录安装 + 导入烟测
npm run harness:verify:project   # 仓库治理校验
```

测试策略（全部**不触达任何真实服务商**）：

- 单元与分发矩阵测试使用 fake fetcher 模拟上游，覆盖九种协议的提交/轮询/失败/能力门；
- 集成测试用 embedded-postgres 在本机启动**真实 PostgreSQL** 覆盖迁移、鉴权、密文、幂等领取与成本账本；可用 `CC_TEST_DATABASE_URL` 指向外部库，或 `CC_TEST_SKIP_PG=1` 关闭；
- SDK 打包验证会真实执行 `npm pack` 并在临时目录安装消费方。

## Harness

- `scripts/verify-harness.mjs`：校验治理文档、npm scripts、SDK `exports`、密钥忽略模式、CI 命令、测试文件与中控源码骨架齐全；
- `scripts/verify-package.mjs`：`npm pack` SDK 包并在临时目录安装消费方，断言 4 个导出入口可用；
- 系统知识：`docs/systems/`（中控架构见 [`docs/systems/control-center/README.md`](./docs/systems/control-center/README.md)）。

## Security

- 服务商凭据永远不落明文：AES-256-GCM `enc:v1:iv:tag:payload`（`CC_SECRET_KEY` 派生），数据库与 API 响应只见 `...last4` 预览；
- `/api/admin/*` 强制管理员会话（HttpOnly + SameSite cookie），`/api/tasks*` 走 `CC_TASK_API_TOKEN` 或管理员会话，管理写操作全部记入 `cc_audit_logs`；
- 文件服务做目录穿越防护；上传/下载均有体积上限；
- `.env`、`*.pem`、`*.key` 已在 `.gitignore`，请勿提交真实服务商凭据；
- 更多见 [`SECURITY.md`](./SECURITY.md)。

## 已知边界

- 中控以单实例多租户预留（`tenant_id` 列已就位），租户隔离的强制执行在路线图上；
- RH `standard_model` 模式、多 worker 并发压测、Docker 部署物在路线图中：[`docs/roadmap.md`](./docs/roadmap.md)；
- SDK 为 pre-1.0，公开 API 仍可能在 1.0 前调整（变更见 [`CHANGELOG.md`](./CHANGELOG.md)）。

## License

[MIT](./LICENSE)
