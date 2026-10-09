import type { Router } from "../http.js";
import type { ControlCenterConfig } from "../config.js";
import { sendJson } from "../http.js";

export type MetaRouteDeps = {
  config: ControlCenterConfig;
};

export function registerMetaRoutes(router: Router, deps: MetaRouteDeps) {
  router.add("GET", "/healthz", async ({ response }) => {
    sendJson(response, { status: "ok", version: "0.1.0", port: deps.config.port });
  });
}
