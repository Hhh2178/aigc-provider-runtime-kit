# Roadmap

## Current Line: 0.3.x SDK hardening + Control-center phase 1（管理面）

Goal: harden the SDK, and turn the repository into the standalone provider/RunningHub management
control center extracted from the production canvas application. Phase 1 delivers the management
surface so other AIGC products can connect their provider configuration to this backend instead of
a hosted admin app.

Completed (2026-10-09):

- Monorepo restructure: `packages/kit`（npm 发布包，零依赖）+ `packages/control-center`（私有 backend 包）。
- SDK 0.3.0 hardening:
  - protocol enum aligned with production（补 `aicopy`、`grsai_draw`）与 16 种能力标签对齐；
  - 上游响应体上限（`readResponseBodyText/readResponseBodyBytes`，multipart/OpenAI 客户端接入，默认 64 MiB）；
  - RunningHub 轮询支持指数退避（默认保持 fixed 兼容）与无扩展名 URL 处理选项（`unclassifiedOutputs`）；
  - 事件 hook 失败上抛 `hooks.onHookError`；registry 深冻结且不污染调用方对象；
  - select 选项数值/字符串一致化；未知输入字段以 `result.warnings` 警示透传。
- Control-center phase 1（`@aigc-kit/control-center` 0.1.0，管理面）：
  - PostgreSQL-only 持久化 + 内嵌迁移（`cc_providers/cc_models/cc_admin_users/cc_sessions/cc_audit_logs`，
    多租户预留 `tenant_id`）；
  - 凭据 AES-256-GCM `enc:v1:` 加密（格式与旧库兼容）、`...last4` 预览；
  - Provider 管理 API（CRUD/排序/probe/fetch-models/import-models）；
  - Model 管理 API（CRUD/排序/分能力连通测试，生成类测试需 `confirmCost` 防误烧 credits）；
  - RunningHub 管理 API（条目/分组 CRUD、启用校验、本地校验式 test、analyze 草案分析）；
  - Key 池管理 API（全量替换保留旧密文、默认 key 唯一化、单个删除）；
  - 管理员会话（scrypt + HttpOnly cookie + PG 会话表）与全量审计；
  - 无框架 HTTP 层（node:http + 极简 Router），管理路由统一 `/api/admin/*` 网关。
- Harness/CI/package 校验适配 monorepo 布局（harness 校验两个包的源码骨架与导出面，
  pack 烟测仅针对 `packages/kit`）。

## Next: 0.4.x phase 2（能跑任务）

- 任务框架移植：任务表 + 提交/状态查询 API + Redis 能力队列 + worker（并发槽、用户并发窗、
  RunningHub key 窗、deferred requeue、stale reaper、取消同步）。
- 协议适配器移植：apimart / aicopy / grsai_draw / modelscope / volcengine / gemini 全量对齐生产实现，
  统一到 SDK adapter 包（消除源项目 api/worker 双份适配器的复制债）。
- 执行期产物物化（下载到宿主存储）与 task-runtime 投影事件。
- 宿主接入形态定型：HTTP API 与 SDK 两种消费方式。

Completed (2026-10-09, phase 2 slice A):
- 任务框架落地：cc_tasks/cc_task_events 迁移、PG SKIP LOCKED 原子领取队列、幂等键、心跳 patch、
  stale reaper、任务事件流（task.created/claimed/heartbeat/succeeded/failed/cancelled/requeued）。
- 任务 API：POST /api/tasks、GET /api/tasks/:id、POST /api/tasks/:id/cancel、GET /api/admin/tasks；
  机器令牌 CC_TASK_API_TOKEN 鉴权（未配置时回落 admin 会话）。
- worker：npm run start:worker -w @aigc-kit/control-center（并发槽、任务超时 AbortSignal、协议分发）。
- 执行器：openai 系（chat/image/提交加轮询的 video/audio）+ RunningHub catalog 提交轮询
  （复用 kit 的 createRunningHubClient、app/workflow 双模式、心跳投影）；apimart/aicopy/grsai/
  volcengine/gemini 返回明确的 adapter_not_ported 失败类别，随 0.4.x 后续切片移植。
- 提交解析层（task-submit）：providerId+modelId / modelRecordId / runninghub.catalogId 三种寻址，
  参数经 kit runtime validateProviderExecutionInput 校验，RH 必填槽校验与 nodeInfoList 映射。

Completed (2026-10-09, phase 2 slice B):
- apimart 协议全量接入：图片（images/generations 提交 + tasks/{task_id} 自适应轮询 + estimated_time 超时）与
  视频（requestMapping/valueTypes/templates/fixedBody 载荷构建 + 提交 + resultVideoPath 轮询 + finalResult 二次查询），
  轮询带 502/503/504 瞬断重试与心跳回写；
- grsai_draw 图片接入：submit/poll 双端点（nano-banana 变体）、SSE `data:` 容错、405 时 GET 回退、
  网关抖动重试、成功但缺图的显式报错；
- modelscope 图片异步接入：提交头/轮询头（X-ModelScope-*）+ task_status 轮询；chat/audio 仍走 openai 系；
- 提交门控放行 apimart 与 grsai_draw；aicopy/gemini/volcengine 仍为 adapter_not_ported（切片 B2）；
- 新增 9 个适配器单测（载荷映射、任务/结果提取、轮询成功/失败、GRSAI 直出/轮询/SSE/报错）。
- PG 集成测试落地（tests/integration-pg.test.mjs，设 CC_TEST_DATABASE_URL 才运行：迁移、管理员引导、
  密文往返、任务 幂等→claim→patch→complete→事件流 全链路，跑完自动清理数据）。

## Later candidate work

- 成本账本与用量统计（修复源项目 RH 目录任务恒 unpriced 的问题；providerUsage 入账）。
- Admin 前端 UI（React：Provider/RH/key 池/连通测试/仪表盘）。
- LLM Pool（内部 Agent 路由池：版本化发布、熔断、模拟）——需先解除与画布 agent-orchestrator 的耦合。
- 多租户 enforcement（表结构已预留 `tenant_id`）。
- 部署物：Dockerfile + docker-compose（PG 一键）与 ops 文档。
- 环境配置加载器、OpenTelemetry/Sentry 桥接示例、key-pool 加权分发/冷却窗口。
- Express/Fastify 宿主适配器示例（不进核心依赖）。

## Deferred Until Explicitly Needed

- ComfyUI 自建实例接入（comfyui-connector 域）。
- 浏览器端 SDK bundle。
- file/SQLite 存储模式（已弃用，不再随行）。

## Compatibility Policy Before 1.0

Breaking changes are allowed when they improve the public contract, but they must be documented in `CHANGELOG.md` and covered by tests.
