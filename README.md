# AIGC Provider Runtime Kit

[![CI](https://github.com/Hhh2178/aigc-provider-runtime-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Hhh2178/aigc-provider-runtime-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)

A framework-neutral TypeScript runtime for applications that need to configure, validate, and execute multiple AIGC providers through one stable interface — **now shipped together with the provider/RunningHub management control-center backend it grew out of**.

> Current release line: SDK `0.3.x`，control-center `0.1.x`. Public SDK API may still evolve before `1.0`.

## Why this project exists

AIGC applications repeat the same infrastructure:

- provider and model configuration;
- model-specific parameter validation;
- provider selection and request dispatch;
- synchronous and asynchronous task handling;
- normalized image, video, audio, and text results;
- timeouts, cancellation, retries, and structured errors;
- progress events, audit hooks, and API-key concurrency control.

This repository provides those pieces at two layers, so a product can pick either:

| Layer | Package | What it gives you |
| --- | --- | --- |
| **SDK（执行内核）** | `aigc-provider-runtime-kit` (npm) | Registry, validation, unified `runtime.execute(...)`, OpenAI-compatible + RunningHub clients/adapters, key-pool leases, normalized outputs/errors/events. Zero runtime dependencies. |
| **Control Center（管理后台）** | `@aigc-kit/control-center`（本仓库 workspace） | 独立可部署的服务商/RunningHub 管理中控：Provider CRUD/连通探测/模型导入、RH 目录与 key 池管理、条目草案 analyze、加密凭据、审计、PostgreSQL 持久化、HTTP 管理 API。 |

Your product keeps control of end-user accounts, product policies, billing roll-up, and user-facing UI; the control center owns the provider/credential/RH-catalog management that previously lived inside the canvas application (`xinghuan` / 无限画布 2.0).

## What the layers own — and what your application owns

| Included here | Owned by your application |
| --- | --- |
| Provider/model contracts and registry | End-user accounts and product UI |
| Input schema validation | 队列/worker 执行框架（路线图阶段 2） |
| Unified runtime and adapter contract | Billing roll-up and product policies |
| OpenAI-compatible / RunningHub clients | Admin frontend (API-first in v0.1) |
| Provider 管理 API + 凭据加密 + 审计 + PostgreSQL | Deployment of the control-center process |
| RH 目录/分组/key 池管理 API + 条目草案分析 | 执行期 Key 池 Redis 并发窗口（阶段 2） |

## Requirements

- Node.js 22 or newer
- The SDK layer: ESM, runtime support for `fetch`, `FormData`, `Blob`, `AbortSignal`（零运行时依赖）
- The control center: PostgreSQL 14+（`CC_DATABASE_URL`）与 `CC_SECRET_KEY`；Redis 仅在阶段 2 的 worker 中引入

## Package Entrypoints

| Entrypoint | Use it for |
| --- | --- |
| `aigc-provider-runtime-kit` | All public SDK exports |
| `aigc-provider-runtime-kit/runtime` | Unified execution contracts, runtime, validation, and adapters |
| `aigc-provider-runtime-kit/core` | Registry, schemas, multipart, retry, and OpenAI-compatible client |
| `aigc-provider-runtime-kit/runninghub` | RunningHub client, descriptors, output extraction, and key pool |
| `@aigc-kit/control-center` | 中控后台装配入口 `createControlCenter(config)`（workspace 内部使用，暂不发布 npm） |

## Control center quick start

```bash
# 仓库根目录（npm workspaces）
npm install
npm run build

# 启动中控（需要 PostgreSQL）
CC_DATABASE_URL=postgres://user:pass@localhost:5432/control_center \
CC_SECRET_KEY=change-me-at-least-32-chars \
CC_PORT=8787 \
node packages/control-center/dist/index.js
```

启动后（`/healthz` 可用；打开 `http://localhost:8787/admin` 即可使用内置管理控制台——登录、服务商、模型、任务轮询与定价成本一页搞定）：

1. `POST /api/auth/admin-login` 登录（默认 `admin@localhost` / `control-center-admin`；生产务必设置 `CC_ADMIN_EMAIL` / `CC_ADMIN_PASSWORD` / `CC_SECRET_KEY`，全部环境变量见 `packages/control-center/src/config.ts`；可选 `CC_TASK_API_TOKEN`（宿主任务令牌）、`CC_STORAGE_DIR`（产物物化目录）、`CC_WORKER_CONCURRENCY`、`CC_CORS_ORIGIN`）。
2. `POST /api/admin/providers` 录入服务商 → `POST /api/admin/providers/probe` 连通测试 → `POST /api/admin/providers/:id/fetch-models` 拉取上游模型 → `POST /api/admin/providers/:id/import-models` 批量导入。
3. `POST /api/admin/models/:id/test` 分能力连通测试（chat/理解类/语音类真实调用；图像生成测试需 `confirmCost: true`，防误烧 credits）。
4. RunningHub：`POST /api/admin/runninghub/analyze` 从文档/示例生成条目草案，`POST|PATCH|DELETE /api/admin/runninghub/items(.…/test)` 维护条目与分组，`GET|PUT|DELETE /api/admin/providers/:id/runninghub/key-pool[/:keyId]` 管理 key 池。
5. 全部管理写操作落 `cc_audit_logs`；`/api/admin/*` 仅 admin 会话可访问。

## Local Development

```bash
npm install
npm run build          # 构建 SDK + control-center
npm run type-check     # 两个 package 的 tsc --noEmit
npm test               # SDK 29 + control-center 28 个测试
npm run test:package   # npm pack + 临时目录安装 + 导入烟测
npm run harness:verify:project   # 仓库治理校验
```

测试布局：SDK 在 `packages/kit/tests/`，control-center 在 `packages/control-center/tests/`（依赖真实 PG 的集成测试在未设置 `CC_TEST_DATABASE_URL` 时自动跳过）。

## Harness

- `scripts/verify-harness.mjs`：校验治理文档、npm scripts、SDK `exports`、密钥忽略模式、CI 命令、测试文件与中控源码骨架齐全。
- `scripts/verify-package.mjs`：`npm pack` SDK 包并在临时目录安装消费方，断言 4 个导出入口可用。
- 治理文档入口：`docs/governance/`；系统知识：`docs/systems/`（中控见 `docs/systems/control-center/README.md`）。

## Security

- API key/口令永远不落明文：AES-256-GCM `enc:v1:iv:tag:payload`（`CC_SECRET_KEY` 派生），数据库与 API 响应只见 `...last4` 预览。
- Admin 会话使用 HttpOnly + SameSite cookie；管理写操作全部留审计。
- `.env`、`*.pem`、`*.key` 在 `.gitignore`；请勿提交真实服务商凭据或客户配置。
- 更多：`SECURITY.md`、`docs/governance/secrets-and-access-policy.md`。

## Monorepo layout

```
packages/kit/               SDK（发布为 npm aigc-provider-runtime-kit，零依赖）
packages/control-center/    中控后台（阶段 1：管理面已可用）
docs/                       治理、系统知识、路线图、台账
```
