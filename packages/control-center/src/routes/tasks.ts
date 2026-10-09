import { readJsonBody, sendJson, Router, HttpError } from "../http.js";
import type { ControlCenterServices } from "../index.js";
import type { ControlCenterConfig } from "../config.js";
import { resolveTaskSubmit, TaskSubmitError } from "../domain/task-submit.js";
import { TASK_CAPABILITIES, projectTaskStatus, TASK_TERMINAL_STATUSES, type TaskCapability, type TaskStatus } from "../domain/task-machine.js";
import { safeText } from "../util.js";

export function registerTaskRoutes(router: Router, deps: { config: ControlCenterConfig; services: ControlCenterServices }) {
  const { services } = deps;

  router.add("POST", "/api/tasks", async ({ request, response, admin, requestContext }) => {
    const body = await readJsonBody<Record<string, unknown>>(request);
    const capability = normalizeCapability(body.capability);
    const resolved = await resolveTaskSubmit({ capability, body }, submitDeps());
    const task = await services.tasks.enqueueTask({
      capability,
      providerId: resolved.provider.id,
      modelRecordId: resolved.model?.id ?? "",
      protocol: resolved.protocol,
      payload: resolvablePayload(resolved),
      idempotencyKey: resolved.idempotencyKey ?? ""
    });
    if (admin) await services.appendAudit(admin, "task.submit", "task", task.id, `提交任务 ${capability} -> ${resolved.provider.id}/${resolved.model?.modelId ?? resolved.protocol}`, requestContext);
    sendJson(response, { taskId: task.id, status: task.status, createdAt: task.createdAt, pollUrl: `/api/tasks/${task.id}` }, 202);
  });

  router.add("GET", "/api/tasks/:taskId", async ({ response, url, params }) => {
    const task = await requireTask(String(params.taskId ?? ""));
    const events = url.searchParams.get("events") === "1" ? await services.tasks.readTaskEvents(task.id) : [];
    const projection = projectTaskStatus(task);
    sendJson(response, {
      taskId: task.id,
      capability: task.capability,
      status: task.status,
      ...projection,
      attempts: task.attempts,
      providerId: task.providerId,
      protocol: task.protocol,
      modelRecordId: task.modelRecordId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      finalizedAt: task.finalizedAt,
      logs: events.map((event) => ({ type: safeText(event.type), at: event.created_at, detail: event.detail }))
    });
  });

  router.add("POST", "/api/tasks/:taskId/cancel", async ({ response, params }) => {
    const task = await requireTask(String(params.taskId ?? ""));
    if (TASK_TERMINAL_STATUSES.has(task.status)) {
      sendJson(response, { taskId: task.id, status: task.status, message: "任务已结束，无法取消" }, 200);
      return;
    }
    const cancelled = await services.tasks.cancelTask(task.id, "调用方取消");
    sendJson(response, { taskId: cancelled.id, status: cancelled.status });
  });

  router.add("GET", "/api/admin/tasks", async ({ response, url, admin }) => {
    void admin;
    const limit = Number(url.searchParams.get("limit")) || 50;
    const status = safeText(url.searchParams.get("status"));
    const capabilityFilter = safeText(url.searchParams.get("capability"));
    const tasks = await services.tasks.listTasks({
      ...(status ? { status } : {}),
      ...(capabilityFilter ? { capability: capabilityFilter } : {}),
      limit
    });
    sendJson(response, { tasks: tasks.map((task) => ({ ...projectTaskStatus(projectInput(task)), taskId: task.id, capability: task.capability, status: task.status, createdAt: task.createdAt, providerId: task.providerId, attempts: task.attempts })) });
  });

  function projectInput(task: { status: TaskStatus; result: Record<string, unknown> }) {
    return { status: task.status, result: task.result };
  }

  function resolvablePayload(resolved: Awaited<ReturnType<typeof resolveTaskSubmit>>) {
    return {
      ...resolved.payload,
      providerId: resolved.provider.id,
      modelRecordId: resolved.model?.id,
      modelId: resolved.model?.modelId ?? "runninghub"
    };
  }

  function submitDeps() {
    return {
      findProviderRecordById: (providerId: string) => services.repository.findProviderRecordById(providerId),
      findModelRecordById: (modelRecordId: string) => services.repository.findModelRecordById(modelRecordId),
      findEnabledEnabledModel: async (capability: TaskCapability, providerId: string, modelId: string) => {
        const provider = await services.repository.findProviderRecordById(providerId);
        if (!provider) return null;
        const model = await services.repository.findModelRecordByNaturalKey(providerId, capability, modelId);
        if (!model) return null;
        return { provider, model };
      }
    };
  }

  async function requireTask(taskId: string) {
    const task = await services.tasks.findTaskById(taskId);
    if (!task) throw new HttpError(404, "任务不存在");
    return task;
  }
}

function normalizeCapability(value: unknown): TaskCapability {
  const capability = safeText(value).toLowerCase();
  if (TASK_CAPABILITIES.includes(capability as TaskCapability)) return capability as TaskCapability;
  throw new TaskSubmitError(400, `不支持的任务类型: ${value || "<empty>"}，可选 ${TASK_CAPABILITIES.join("/")}`);
}
