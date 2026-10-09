# 2026-10-09 Delist control-center phase 1 (management surface)

## Intent

按既定剥离方案第二阶段落地：把本仓库从"纯 SDK"扩容为"SDK + 服务商/RunningHub 管理中控后台"。
阶段 1 目标是管理面可用：Provider/Model/RH 目录/Key 池/草案分析/凭据加密/审计/PG 持久化，并对齐
源项目（无限画布）的字段语义与行为。该决策（本仓库就地扩容为中控）由仓库所有者于本轮明确批准，
`AGENTS.md` 关于"新增数据库依赖需先暂停"的停问条款由该批准解除。

## Changed

| Area | Files | Purpose |
| --- | --- | --- |
| Monorepo restructure | `package.json`、`packages/kit/**`、`packages/control-center/**` | npm workspaces：SDK（发布名不变）+ 中控私有包；SDK 导出面不变，dist 由 `dist/packages/*` 变为 `dist/*` |
| SDK hardening | `packages/kit/src/{core,runtime,runninghub}/*` | 协议枚举补 aicopy/grsai_draw、能力标签补 audio_cover/audio_extend、响应体上限、RH 轮询指数退避选项、`unclassifiedOutputs`、`onHookError`、registry 深冻结、select 数值一致化、未知字段 warnings |
| 中控领域层 | `packages/control-center/src/{crypto,util,config,db,migrations}.ts`、`src/domain/**` | AES-256-GCM `enc:v1:`、协议/能力目录、模型归一化、批量导入、probe、分能力模型测试（生成类需 confirmCost）、RH catalog/analyze/service（与源项目行为对齐） |
| 中控仓储 | `src/repository/{providers,auth,audit}.ts` | PG-only 仓储（兼容 `enc:v1:` 旧密文）、scrypt 管理员、PG 会话与审计 |
| HTTP 与路由 | `src/http.ts`、`src/routes/{meta,auth,providers,models,runninghub}.ts`、`src/index.ts` | 无框架 Router + `/api/admin/*` 会话网关 + 统一 `{ok,success}` 信封 |
| 验证脚本 | `scripts/verify-harness.mjs`、`scripts/verify-package.mjs` | 适配新布局：harness 校验双包骨架；pack 烟测改从 `packages/kit`（含 Windows shell 修正） |
| 文档 | `README.md`、`docs/roadmap.md`、`CHANGELOG.md`、`docs/systems/control-center/README.md` | 双层定位、中控快启、阶段路线、0.3.0 变更记录 |

## Verification

- `npm run harness:verify:project` → passed
- `npm run type-check`（两包 tsc --noEmit）→ passed
- `npm test` → SDK 29 / control-center 28 全部通过
- `npm run test:package` → pack + 临时目录安装 + 导入烟测通过
- PG 集成测试（依赖真实数据库）暂未编写，属阶段 2 任务，见 Risks

## Decisions

- 弃用源项目的 file/SQLite 双模式持久化：中控只支持 PostgreSQL（多租户预留 `tenant_id` 列）。
- RH 目录（apps/workflows/groups/keyPool）继续以 provider 行内 JSONB 存储，字段语义与源项目一致，
  便于后续 `INSERT ... SELECT` 式迁移；表名换用新 中立 `cc_*` schema。
- 图像生成类模型测试提供 `confirmCost` 显式确认（修复源项目"下一阶段按钮"未实现的缺口）；
  RH 条目 test 保持本地校验式（不真正调上游）。
- 未纳入本阶段：任务执行框架、成本账本、Admin UI、LLM Pool、comfyui-connector。

## Risks

- 仓储层 SQL 尚无真库集成测试（当前仅领域逻辑/HTTP 层单元测试）；阶段 2 接 PG service 容器补齐。
- 中控 API 尚无正式 `docs/api-reference.md` 章节，先以 `docs/systems/control-center/README.md` 的
  路由清单为准，阶段 2 补 openapi 式参考。
- 会话 cookie 的 Host 判断比较简陋（localhost/127.0.0.1/::1），反代部署时需 `CC_CORS_ORIGIN`
  并在网关层固定 scheme。

## Next step

已同日完成阶段 2 切片 A（见上方 Update）。下一步：阶段 2（能跑任务）：任务表 + 提交/查询 API + Redis 队列 + worker + 全量协议适配器移植，并补 PG 集成测试。

## Update: phase 2 slice A delivered same-day (2026-10-09)

- 任务框架 + 任务 API + 任务 worker（PG SKIP LOCKED 队列，未引入 Redis——队列与并发窗口以 PG 原子领取 + 声明式 slot 实现，Redis key 并发窗保持路线图增强项）；
- 执行器先接 openai 系与 RunningHub catalog 两条已验证链路；apimart/aicopy/grsai/volcengine/gemini 显式 adapter_not_ported。
- 新增 32 个中控测试（task-machine/task-submit/suite 合计 32）。
- Next: 适配器全量移植（apimart/grsai/aicopy 优先）+ PG 集成测试（CC_TEST_DATABASE_URL 触发）。


## Update: phase 2 slice B delivered same-day (2026-10-09)

- 移植 apimart（图片+视频）、grsai_draw（图片）、modelscope（图片异步）三条生产链路，语义与 xinghuan worker 对齐（载荷映射、任务/结果提取、轮询路径模板、瞬断重试、心跳）。
- 提交门控放行上述协议；aicopy/gemini/volcengine 仍明确 adapter_not_ported（下轮切片 B2）。
- 测试 41 个（+9 适配器），PG 集成测试以 CC_TEST_DATABASE_URL 门控。

## Update: phase 2 slice B2 delivered same-day (2026-10-09) — 九协议全覆盖

- aicopy 视频（契约绑定系统完整移植）、gemini chat（generateContent 主链路）、volcengine 并入 openai 通用路（与源项目一致）；提交门控放行全 9 协议，能力门显式。
- 任务终态回调 webhook（callbackUrl best-effort 投递）。
- 测试 57（56 通过 + 1 PG 门控跳过）：新增全协议 executeTask 分发矩阵，全部使用 mock fetcher，验证不触达任何真实服务商；顺手修掉图片 b64 输出误用 video mime 的真实 bug。
- 发布验证链（harness/type-check/双包测试/打包烟测）全绿。本机无 psql/docker，CC_TEST_DATABASE_URL 门控集成测试未在本地真库执行，待有 PG 的环境跑绿。

## Update: phase 3 delivered same-day (2026-10-09)

- embedded-postgres 自托管：定位并绕过 Windows 中文 locale 下 initdb post-bootstrap 的 GBK/UTF8 致命错误（--no-clean 保留可用集群），集成测试真库 7/7。真库测试抓出幂等查询双重租户前缀的真 bug。
- 产物物化：materialize 模块（流式下载、512MiB 上限、部分文件清理、materialized*Urls、防穿越文件服务路由）+ 4 测试。
- 成本账本：迁移 003、cost 域（定价解析/金额计算纯函数）、定价仓储与管理 API、worker 成功路径自动入账；rh_target 定价修复源项目 RH 目录任务 unpriced；汇总窗口做了毫秒/微秒边界修复（真库测试同样抓出该竞态）。3 单测 + 真库断言。
- 管理控制台 GET /admin：无构建内嵌页面（登录、服务商 CRUD/探测、模型、任务 5s 轮询、定价与成本），框架中立，数据全走受保护 API；1 路由测试。
- 全量：71/71 + SDK 29/29 + harness + pack 烟测全绿；并发 3 连绿。
- Next（若继续）：任务队列的多 worker 并发压测、RH standard_model 模式、LLM Pool、Docker 部署物。
