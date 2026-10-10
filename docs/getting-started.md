# Getting Started

本指南帮助你把 `aigc-provider-runtime-kit` 接入自己的产品：既可以直接嵌入 SDK 执行内核，也可以部署本仓库的管理中控后台。

## 选择接入方式

| 你的场景 | 推荐 |
| --- | --- |
| 已有自己的后端/数据库，只想复用"配置校验 + 统一执行" | 直接安装 npm SDK（见下方 SDK 示例） |
| 想要"服务商管理 + RunningHub 目录 + 任务队列 + 成本账本 + 管理控制台"整套后台 | 部署本仓库的 control-center（见中控快速开始） |
| 两者都要 | 中控负责管理和执行，SDK 用于业务侧的本地校验/schema 渲染 |

## Install（SDK）

```bash
npm install aigc-provider-runtime-kit
# 或直接从 GitHub
npm install github:Hhh2178/aigc-provider-runtime-kit
```

本地开发本仓库：

```bash
npm ci
npm run build
npm test
```

## SDK 示例：模型参数 Schema

```ts
import { defaultParameterSchemaForModel, uiMetadataFromSchema } from "aigc-provider-runtime-kit/core";

const schema = defaultParameterSchemaForModel("image", "gpt-image-2", "openai");
const ui = uiMetadataFromSchema(schema, "image");
```

适合驱动你自己的表单、画布节点或管理配置界面。

## SDK 示例：RunningHub 执行描述符

```ts
import { buildRunningHubExecutionDescriptor } from "aigc-provider-runtime-kit/runninghub";

const descriptor = buildRunningHubExecutionDescriptor({
  kind: "workflow",
  workflowId: "workflow-id",
  taskCapability: "video",
  fields: []
});
```

描述符只描述"怎么提交、怎么轮询、怎么解读产物"，不拥有你的数据库、队列或权限模型。

## SDK 示例：统一执行

```ts
import { createProviderRuntime, createProviderRegistry, createOpenAICompatibleAdapter, createOpenAICompatibleClient } from "aigc-provider-runtime-kit/runtime";

const registry = createProviderRegistry({
  providers: [{ id: "primary", name: "Primary", baseUrl: "https://api.example.com/v1", protocol: "openai", enabled: true }],
  models: [{ id: "img", providerId: "primary", modelId: "gpt-image-2", displayName: "Image", capability: "image", enabled: true }]
});

const runtime = createProviderRuntime({
  registry,
  adapters: [createOpenAICompatibleAdapter({ client: createOpenAICompatibleClient({ baseUrl: "https://api.example.com/v1", apiKey: process.env.PROVIDER_API_KEY! }) })]
});

const result = await runtime.execute({ providerId: "primary", modelId: "img", input: { prompt: "一只海边的橘猫" } });
```

## 中控快速开始

```bash
git clone https://github.com/Hhh2178/aigc-provider-runtime-kit.git
cd aigc-provider-runtime-kit
npm install && npm run build

CC_DATABASE_URL=postgres://user:pass@localhost:5432/control_center \
CC_SECRET_KEY=请换成至少32位的随机串 \
node packages/control-center/dist/index.js

# 另一个进程
CC_DATABASE_URL=... CC_SECRET_KEY=... node packages/control-center/dist/worker/worker.js
```

打开 `http://localhost:8787/admin` 用管理控制台录入服务商；宿主系统用 `CC_TASK_API_TOKEN` 调用 `POST /api/tasks` 提交任务，`GET /api/tasks/:id` 拿结果。完整流程与环境变量见根目录 README 与 `docs/api-reference.md`。

## 接入建议

1. 服务商凭据只存在中控（或你自己的服务端数据库），绝不下放到前端；
2. 任务提交带 `idempotencyKey`，避免网络重试造成重复扣费；
3. 配置 `CC_TASK_API_TOKEN` 并在网关层做来源限制；
4. 开启 `CC_STORAGE_DIR` 让产物落盘，配合 `GET /api/tasks/:id/files/:filename` 分发；
5. 为你的业务边界写集成测试——本仓库的测试不触达真实服务商，你的账号相关逻辑需要你自己的 mock/沙箱。

## 边界说明

- SDK 不存凭据、不做计费汇总、不提供终端用户权限模型；
- 控制中心不提供终端用户账号体系（只有管理员），面向"接入方应用"而不是 C 端；
- 队列用 PostgreSQL 实现，未引入 Redis。
