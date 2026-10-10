# API Reference

## Package Entrypoints

| Entrypoint | Purpose |
| --- | --- |
| `aigc-provider-runtime-kit` | Combined runtime exports |
| `aigc-provider-runtime-kit/core` | Provider, model, schema, and request body helpers |
| `aigc-provider-runtime-kit/runninghub` | RunningHub catalog, descriptor, client, and key-pool helpers |
| `aigc-provider-runtime-kit/runtime` | Explicit combined runtime exports |

## Core Helpers

### `defaultParameterSchemaForModel(capability, modelId, protocol?)`

Returns a practical default parameter schema for image, video, audio, or chat models.

### `parseModelParameterSchema(value)`

Accepts an object or JSON string and returns a safe model parameter schema. Invalid input returns an empty object.

### `mergeModelParameterSchema(capability, modelId, protocol, value)`

Combines default model parameters with user or admin supplied overrides.

### `uiMetadataFromSchema(schemaValue, capability, inputCapabilitiesValue?)`

Converts a parameter schema into UI-friendly metadata such as aspect ratios, default size, duration options, reference support, and input capability flags.

### `durationOptionsFromRange(range?)`

Expands a duration range into sorted duration options.

### `isMultipartRequestBodyMode(value)`

Checks whether a provider request mode should be treated as multipart form data.

### `buildProviderMultipartRequestBody(payload, fileFieldNamesValue)`

Builds a `FormData` request body from scalar fields and file URL or data URL fields.

### `validateProviderDefinition(value)` and `validateProviderModelDefinition(value, providerIds?)`

Return structured validation results with field paths, issue codes, and messages for provider or model configuration.

### `createProviderRegistry(input)`

Creates an immutable provider/model registry after validating URLs, protocols, capabilities, duplicate IDs, and provider references. Invalid input throws `ProviderRegistryValidationError` with an `issues` array.

### `withRetry(operation, options?)`

Runs an asynchronous operation with bounded exponential backoff, optional jitter, cancellation, custom retry decisions, and retry callbacks.

### `createOpenAICompatibleClient(options)`

Creates a dependency-free JSON client for OpenAI-compatible APIs. It exposes `request(path, body)`, `createChatCompletion(body)`, and `createImage(body)`. Request timeout, cancellation, custom headers, and opt-in retry policy are supported.

Failures use `OpenAICompatibleError`; `isOpenAICompatibleError(value)` safely narrows unknown errors.

## RunningHub Helpers

### `normalizeRunningHubInputSlots(fields)`

Converts RunningHub field definitions into reusable host-app input slot definitions.

### `buildRunningHubExecutionDescriptor(item)`

Builds a host-app execution descriptor for RunningHub App or Workflow entries.

### `normalizeRunningHubCatalogItem(source)`

Normalizes a source catalog record into a complete RunningHub catalog item.

### `createRunningHubClient(options)`

Creates a minimal RunningHub submit/poll client. Host applications should wrap this client with their own permission, quota, credential, and audit layers.

Client options include `requestTimeoutMs` for individual HTTP requests and `taskTimeoutMs` for the complete polling lifecycle. Both have bounded defaults. `runTask` also accepts a per-task `timeoutMs` and an `AbortSignal` through `signal`.

### `RunningHubError` and `isRunningHubError(value)`

RunningHub failures use a typed error with `code`, `stage`, optional HTTP `status`, and a `retryable` hint. Codes distinguish invalid configuration/input, cancellation, request or response failures, upstream rejection, task failure/timeout, unknown status, and missing output.

### `extractRunningHubOutputUrls(value)`

Extracts image, video, and audio URLs from nested RunningHub result payloads.

### `acquireRunningHubKey(input)` and `releaseRunningHubKey(input)`

Provide key-pool concurrency helpers against a Redis-like runtime interface.

`acquireRunningHubKey` accepts an optional `leaseSeconds` value between 30 seconds and 24 hours. Successful acquisitions refresh the counter lease.

### `orderRunningHubKeys(keys, preferredKeyId?)`

Orders enabled keys by preferred key, default key, then other enabled keys.

## Unified Runtime

### `createProviderRuntime(options)`

Creates the unified execution entrypoint. It resolves enabled provider/model records, validates model input, selects the first supporting adapter, propagates cancellation and timeout signals, emits lifecycle events, and normalizes provider/model identity in the result.

### `ProviderAdapter`

Adapters implement `supports(provider, model)` and `execute(context)`. Adapter context includes provider/model definitions, validated input, cancellation signal, timeout, metadata, and a progress emitter.

### `createOpenAICompatibleAdapter(options)`

Adapts the OpenAI-compatible client to unified runtime results. Chat text, image URLs/base64 data, and token usage are normalized automatically. Video/audio endpoints can be supplied through `endpoints`.

### `createRunningHubAdapter(options)`

Adapts a RunningHub client to the unified runtime. It supports a custom `resolveRunInput` function or model `advancedConfig.runninghub` with target IDs and an input `fieldMap`.

### `validateProviderExecutionInput(model, input)`

Validates required fields, scalar/array types, allowed options, numeric ranges, list maximums, and declared input capabilities.

### `ProviderRuntimeError` and `isProviderRuntimeError(value)`

Distinguish missing/disabled configuration, provider-model mismatch, invalid input, missing adapters, adapter failures, and aborted/timed-out executions.

### Runtime events

An optional `hooks.onEvent` handler receives started, validated, adapter-selected, progress, success, and failure events. Hook failures are isolated and never change execution behavior; `hooks.onHookError` receives them for observability.

## Control Center HTTP API

中控后台（`@aigc-kit/control-center`）的 HTTP 面。通用约定：管理端点挂 `/api/admin/*`（需要管理员会话 cookie），任务端点挂 `/api/tasks*`（`CC_TASK_API_TOKEN` 的 `Authorization: Bearer` 或管理员会话），成功响应统一 `{ ok, success, ...payload }`，错误响应 `{ ok:false, error, message }`。

### 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/admin-login` | `{ email, password }` → 会话 cookie + 用户信息 |
| POST | `/api/auth/logout` | 注销当前会话 |
| GET | `/api/auth/me` | 当前登录状态 |

### Provider 管理

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/providers` | 服务商列表（公开视图：`hasApiKey`/`apiKeyPreview`，无密文） |
| POST | `/api/admin/providers` | 创建服务商（`apiKey` 自动加密落库） |
| PATCH/DELETE | `/api/admin/providers/:id` | 更新/删除（`clearApiKey:true` 清除密钥） |
| POST | `/api/admin/providers/reorder` | `{ orderedIds }` 展示排序 |
| POST | `/api/admin/providers/probe` · `/api/admin/providers/:id/probe` | 连通性探测（拉取 `/models`，不落库/落库） |
| POST | `/api/admin/providers/:id/fetch-models` | 拉取上游模型列表（含能力归类与标签推断） |
| POST | `/api/admin/providers/:id/import-models` | `{ models:[{modelId, capability?, ...}] }` 批量导入（幂等合并） |

### 模型管理

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/models?providerId=&capability=` | 模型列表 |
| POST | `/api/admin/models` | 创建模型记录 |
| PATCH/DELETE | `/api/admin/models/:id` | 更新/删除 |
| POST | `/api/admin/models/reorder` | `{ providerId, capability, orderedIds }` |
| POST | `/api/admin/models/:id/test` | `{ kind, autoApply?, confirmCost? }` 连通测试；`kind` 支持 `chat/image_understanding/tts/voice_clone/image_generation/...`；**生成类必须 `confirmCost:true`** |

### RunningHub 管理

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/admin/runninghub/items` | 目录条目列表/新建 |
| PATCH/DELETE | `/api/admin/runninghub/items/:catalogId` | 更新/删除条目（启用前校验必填输入槽） |
| POST | `/api/admin/runninghub/items/:catalogId/test` | 本地校验式条目测试（不调上游） |
| POST | `/api/admin/runninghub/analyze` | `{ docUrl?, requestExample?, responseExample?, kind? }` 生成条目草案（输入槽/参数/输出/执行规则） |
| GET/POST | `/api/admin/runninghub/groups` · PATCH/DELETE `/api/admin/runninghub/groups/:groupId` | 分组管理 |
| GET/PUT | `/api/admin/providers/:id/runninghub/key-pool` · DELETE `.../key-pool/:keyId` | Key 池（全量替换时保留未变更的密文；唯一默认 Key） |

### 任务

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/tasks` | 提交任务。`capability` 为 `chat/image/video/audio`；寻址三选一：`providerId`+`modelId`、`modelRecordId`、RunningHub 的 `providerId`+`runninghub.catalogId`。可选 `input`（按模型参数 schema 校验）、`idempotencyKey`、`timeoutMs`、`callbackUrl` |
| GET | `/api/tasks/:taskId?events=1` | 状态投影（`displayStatus/runtimeStage/providerState/urls/text/message`）与事件流 |
| POST | `/api/tasks/:taskId/cancel` | 取消（终态任务返回提示） |
| GET | `/api/admin/tasks?status=&capability=&limit=` | 管理列表 |
| GET | `/api/tasks/:taskId/files/:filename` | 物化产物下载（`CC_STORAGE_DIR` 开启时；防目录穿越） |

任务结果字段：`imageUrls / videoUrls / audioUrls / text`（远端），`materialized*Urls`（本地物化地址），`cost { amount, currency, billedSource }`（成功计费），`upstreamTaskId`、`adapter` 等诊断字段。

### 定价与成本

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/pricing?providerId=` | 定价列表（`scope=model\|rh_target`） |
| PUT | `/api/admin/pricing` | `{ scope, providerId, modelRecordId? \| runTargetId?, kind: per_request\|per_second, unitPrice, perSecondPrice, currency, enabled }` |
| DELETE | `/api/admin/pricing/:pricingId` | 删除定价 |
| GET | `/api/admin/costs/summary?since=&until=&limit=` | 分日/服务商/RH 目标汇总与总额 |

计费优先级：上游 `providerUsage.consumeMoney` → 按次（`generationCount` 计量）→ 按秒（缺时长记 0 不瞎估）；失败任务不计费。`rh_target` 定价让没有模型记录的 RunningHub 目录任务同样可计价。

### 运维

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/healthz` | 健康检查 |
| GET | `/admin` | 内置管理控制台（无构建静态页） |

## Stability

SDK 为 `0.3.x` pre-1.0 API；control-center 为 `0.1.x`。统一运行时已可用于生产集成，但 1.0 前仍允许破坏性改进（变更记录见 `CHANGELOG.md`）。
