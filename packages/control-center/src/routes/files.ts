import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Router, HttpError } from "../http.js";
import type { ControlCenterConfig } from "../config.js";
import { mimeTypeFor, resolveServedFile } from "../worker/materialize.js";

export function registerFileRoutes(router: Router, deps: { config: ControlCenterConfig }) {
  const storageDir = deps.config.storageDir;

  router.add("GET", "/api/tasks/:taskId/files/:filename", async ({ params, response }) => {
    if (!storageDir) throw new HttpError(404, "物化存储未启用（CC_STORAGE_DIR）");
    const taskId = String(params.taskId ?? "");
    const filename = String(params.filename ?? "");
    const path = resolveServedFile(storageDir, taskId, filename);
    if (!path) throw new HttpError(400, "非法文件名");
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new HttpError(404, "文件不存在");
    response.statusCode = 200;
    response.setHeader("content-type", mimeTypeFor(filename));
    response.setHeader("content-length", String(info.size));
    response.setHeader("cache-control", "private, max-age=3600");
    createReadStream(path).pipe(response);
  });
}
