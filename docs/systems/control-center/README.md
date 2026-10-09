# Control Center（服务商与 RH 管理中控后台）

The control center is the provider/RunningHub management backend extracted out of the production canvas
application (`xinghuan` / 无限画布 2.0) and rebuilt on top of the runtime kit packages. It turns the kit's
execution core into a runnable backend that other AIGC products can connect to.

## Current capability set (phase 1, "管理面")

- **Provider 管理 API**（`/api/admin/providers*`）：CRUD、排序、连通性探测（probe）、上游模型列表拉取
  （fetch-models）、批量导入（import-models），协议覆盖 9 种：`openai / gemini / runninghub / volcengine /
  apimart / aicopy / modelscope / custom / grsai_draw`。
- **Model 管理 API**（`/api/admin/models*`）：参数 schema、输入能力、能力标签（16 种）、分能力连通测试
  （chat / 图像理解 / 语音类真实调用；图像生成测试在 `confirmCost: true` 下启用，避免误烧 credits）。
- **RunningHub 管理 API**（`/api/admin/runninghub/*`）：App/Workflow 条目与分组 CRUD、条目启用校验、
  本地校验式条目测试（test）、从文档/示例自动生成结构化草案（analyze）、按 provider 的 key 池管理
  （`/api/admin/providers/:id/runninghub/key-pool`）。
- **凭据加密**：AES-256-GCM `enc:v1:iv:tag:payload` 存储（`CC_SECRET_KEY` 派生），API 响应只回 `...last4` 预览。
- **鉴权与审计**：管理员登录（scrypt 口令 + `cc_session` HttpOnly cookie + PG 会话表），全部管理写操作
  落 `cc_audit_logs`。
- **持久化**：PostgreSQL only（多租户从表结构层级预留 `tenant_id`），迁移内嵌于 `src/migrations.ts` 并由
  `db.ts` 自动迁移。

## Architecture map

```
src/config.ts            环境配置（CC_*）
src/crypto.ts            SecretCodec（AES-256-GCM enc:v1:）
src/db.ts + src/migrations.ts   PG 池 + 迁移
src/util.ts              safeText/safeSlug/parseUpstreamJson 等清洗工具
src/http.ts              极简 Router/JSON 响应/Cookie（无框架依赖）
src/domain/              纯领域逻辑（可直接单测）
  protocol-catalog.ts    协议枚举、models 端点、能力推断
  model-normalize.ts     模型记录归一化 + 目录排序
  provider-secrets.ts    密钥池/密钥投影（public 视图）
  provider-probe.ts      连通性探测
  provider-test.ts       分能力模型测试
  import-models.ts       上游模型批量导入合并
  runninghub/catalog.ts  RH 条目/分组/schema 归一化
  runninghub/analyze.ts  RH 草案分析
  runninghub/service.ts  RH 条目/分组服务（仓储之上）
src/repository/          providers / auth / audit（PG）
src/routes/              meta / auth / providers / models / runninghub
src/index.ts             createControlCenter(config)：装配 + HTTP 服务
```

## Invariants

- `/api/admin/*` 的所有处理器在进入前已由 `index.ts` 的网关强制 admin 会话；其余路由不经鉴权。
- 管理面全部 JSON 响应统一 `{ ok, success, ...payload }` 信封；错误不向外泄露内部密文。
- 密钥只加密存储：数据库中不出现明文；decrypt 仅在调用上游时进行。
- provider/RH 目录数据保持与源项目相同的字段语义（`rhApps/rhWorkflows/rhGroups/rhKeyPool` 存 provider 行内 JSONB），
  便于后续从旧库迁移；但表名/schema 为本项目全新中立命名（`cc_*`）。

## 任务执行（阶段 2 已交付）

- `POST /api/tasks` 三寻址提交 → PG SKIP LOCKED 队列 → `npm run start:worker` 执行 → `GET /api/tasks/:id` 查询/取消；
  终态可回调 `payload.callbackUrl`（best-effort）。
- 九种协议全覆盖（openai/gemini/runninghub/volcengine/apimart/aicopy/modelscope/custom/grsai_draw），
  能力门按协议显式（如 gemini 仅 chat、grsai 仅 image）。执行测试全部 mock 上游，不触达真实服务商。

## 管理与运营（阶段 3 已交付）

- 内置控制台 `GET /admin`：无构建静态页面（登录/服务商/模型/任务/定价与成本），数据调用仍走受保护 API。
- 产物物化：`CC_STORAGE_DIR` 开启后任务成功即下载远端产物并返回 `materialized*Urls`，
  `GET /api/tasks/:taskId/files/:filename` 提供防穿越文件服务（与任务 API 同一令牌/会话网关）。
- 成本账本：`cc_model_pricing`（model/rh_target）+ `cc_task_cost_items`；worker 成功路径自动计费
  （per_request / per_second / 上游 consumeMoney 优先），管理 API：`/api/admin/pricing*`、
  `/api/admin/costs/summary`。rh_target 范围让 RH 目录任务可计价。
- 测试：单元 71 + embedded-postgres 真库集成（`CC_TEST_SKIP_PG=1` 可关闭）。

## Deferred（见 `docs/roadmap.md`）

产物物化到宿主存储、成本账本与用量统计、LLM Pool、多租户 enforcement、Admin 前端 UI、Docker 部署物。
