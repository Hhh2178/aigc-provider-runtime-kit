import { Router } from "../http.js";

/**
 * Minimal built-in admin console (no build step, no framework — kept
 * framework-neutral per project guardrails). It exercises the existing admin
 * APIs: login, providers (list/create/probe), models, tasks (live refresh),
 * pricing and the cost summary.
 */
export const ADMIN_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>服务商与 RH 管理中控</title>
<style>
  :root { color-scheme: light; --line:#e5e7eb; --ink:#111827; --muted:#6b7280; --brand:#2563eb; --ok:#059669; --bad:#dc2626; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; color:var(--ink); background:#f9fafb; }
  header { display:flex; align-items:center; gap:16px; padding:10px 20px; background:#fff; border-bottom:1px solid var(--line); position:sticky; top:0; z-index:5; }
  header h1 { font-size:15px; margin:0; }
  nav { display:flex; gap:4px; margin-left:12px; }
  nav button { border:1px solid transparent; background:transparent; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:13px; color:var(--muted); }
  nav button.active { background:#eff6ff; color:var(--brand); border-color:#bfdbfe; }
  main { max-width:1080px; margin:24px auto; padding:0 16px 64px; }
  section { display:none; }
  section.active { display:block; }
  .card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:16px 18px; margin-bottom:16px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:600; background:#f9fafb; }
  input,select { border:1px solid var(--line); border-radius:6px; padding:7px 9px; font-size:13px; min-width:140px; background:#fff; }
  button.action { border:1px solid var(--line); background:#fff; border-radius:6px; padding:7px 12px; cursor:pointer; font-size:13px; }
  button.primary { background:var(--brand); border-color:var(--brand); color:#fff; }
  button.danger { color:var(--bad); }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
  .badge { display:inline-block; padding:1px 8px; border-radius:999px; font-size:12px; background:#f3f4f6; }
  .badge.ok { background:#ecfdf5; color:var(--ok); }
  .badge.bad { background:#fef2f2; color:var(--bad); }
  .badge.run { background:#eff6ff; color:var(--brand); }
  #login { max-width:360px; margin:80px auto; }
  .muted { color:var(--muted); }
  .err { color:var(--bad); min-height:20px; font-size:13px; }
  code { background:#f3f4f6; padding:1px 5px; border-radius:4px; font-size:12px; }
  body:not(.authed) nav, body:not(.authed) #whoami, body:not(.authed) #logout { display:none; }
</style>
</head>
<body>
<header>
  <h1>服务商与 RH 管理中控</h1>
  <nav id="tabs">
    <button data-tab="providers" class="active">服务商</button>
    <button data-tab="models">模型</button>
    <button data-tab="tasks">任务</button>
    <button data-tab="pricing">定价 / 成本</button>
  </nav>
  <span style="flex:1"></span>
  <span class="muted" id="whoami"></span>
  <button class="action" id="logout">退出</button>
</header>
<main>
  <div id="login" class="card">
    <h2 style="margin-top:0;font-size:16px">管理员登录</h2>
    <div class="row"><input id="email" placeholder="邮箱" value="admin@localhost"></div>
    <div class="row"><input id="password" type="password" placeholder="密码"></div>
    <div class="err" id="loginErr"></div>
    <button class="primary" id="loginBtn">登录</button>
  </div>

  <section id="tab-providers" class="active">
    <div class="card">
      <div class="row">
        <input id="pName" placeholder="名称">
        <input id="pBase" placeholder="Base URL（https://...）" style="min-width:260px">
        <select id="pProtocol">
          <option value="openai">openai</option><option value="gemini">gemini</option>
          <option value="runninghub">runninghub</option><option value="volcengine">volcengine</option>
          <option value="apimart">apimart</option><option value="aicopy">aicopy</option>
          <option value="modelscope">modelscope</option><option value="custom">custom</option>
          <option value="grsai_draw">grsai_draw</option>
        </select>
        <input id="pKey" placeholder="API Key（加密存储）" type="password" style="min-width:200px">
        <button class="primary" id="pCreate">创建</button>
        <span class="err" id="pErr"></span>
      </div>
      <table id="pTable"><thead><tr><th>名称</th><th>协议</th><th>地址</th><th>Key</th><th>探测</th><th>操作</th></tr></thead><tbody></tbody></table>
      <p class="muted" id="pEmpty"></p>
    </div>
  </section>

  <section id="tab-models">
    <div class="card">
      <div class="row">
        <select id="mProvider"><option value="">选择服务商…</option></select>
        <span class="muted">切换即加载该服务商的模型</span>
      </div>
      <table id="mTable"><thead><tr><th>显示名</th><th>上游模型</th><th>能力</th><th>启用</th><th>标签</th></tr></thead><tbody></tbody></table>
      <p class="muted" id="mEmpty"></p>
    </div>
  </section>

  <section id="tab-tasks">
    <div class="card">
      <div class="row">
        <select id="tStatus"><option value="">全部状态</option><option>queued</option><option>running</option><option>succeeded</option><option>failed</option><option>cancelled</option></select>
        <button class="action" id="tRefresh">刷新</button>
        <span class="muted">每 5 秒自动刷新</span>
      </div>
      <table id="tTable"><thead><tr><th>任务</th><th>能力</th><th>状态</th><th>显示</th><th>协议</th><th>创建时间</th></tr></thead><tbody></tbody></table>
      <p class="muted" id="tEmpty"></p>
    </div>
  </section>

  <section id="tab-pricing">
    <div class="card">
      <div class="row">
        <select id="prScope"><option value="model">模型定价</option><option value="rh_target">RH 目录定价</option></select>
        <input id="prProvider" placeholder="providerId">
        <input id="prTarget" placeholder="modelRecordId 或 runTargetId" style="min-width:220px">
        <input id="prPrice" placeholder="单价" style="min-width:90px">
        <select id="prKind"><option value="per_request">按次</option><option value="per_second">按秒</option></select>
        <button class="primary" id="prSave">保存定价</button>
        <span class="err" id="prErr"></span>
      </div>
      <table id="prTable"><thead><tr><th>范围</th><th>服务商</th><th>目标</th><th>计费</th><th>单价</th><th>启用</th><th></th></tr></thead><tbody></tbody></table>
      <p class="muted">RH 目录定价（runTargetId）让没有模型记录的 RunningHub 目录任务也能计费。</p>
    </div>
    <div class="card">
      <div class="row"><strong>近 30 天成本</strong><button class="action" id="cRefresh">刷新</button></div>
      <div id="cSummary" class="muted">—</div>
      <table id="cTable"><thead><tr><th>日期</th><th>服务商</th><th>RH 目标</th><th>计费来源</th><th>金额</th><th>任务数</th></tr></thead><tbody></tbody></table>
    </div>
  </section>
</main>
<script>
const $ = (s) => document.querySelector(s);
const api = async (path, options) => {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, credentials: "same-origin", ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || body.error || ("HTTP " + res.status));
  return body;
};
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const badge = (status) => {
  const cls = status === "succeeded" ? "ok" : (status === "failed" || status === "cancelled") ? "bad" : "run";
  return '<span class="badge ' + cls + '">' + esc(status) + "</span>";
};

let providers = [];
let taskTimer = null;

async function boot() {
  try {
    const me = await api("/api/auth/me");
    if (me.authenticated) return enterApp(me.user);
  } catch (e) { /* not logged in */ }
}

function enterApp(user) {
  document.body.classList.add("authed");
  $("#whoami").textContent = (user && user.email) || "";
  loadProviders();
}

$("#loginBtn").onclick = async () => {
  $("#loginErr").textContent = "";
  try {
    const res = await api("/api/auth/admin-login", { method: "POST", body: JSON.stringify({ email: $("#email").value, password: $("#password").value }) });
    enterApp(res.user);
  } catch (e) { $("#loginErr").textContent = e.message; }
};
$("#logout").onclick = async () => { await api("/api/auth/logout", { method: "POST" }); location.reload(); };

document.querySelectorAll("#tabs button").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll("main > section").forEach((el) => el.classList.remove("active"));
    $("#tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "models") fillProviderSelect();
    if (btn.dataset.tab === "tasks") { loadTasks(); startTaskTimer(); } else stopTaskTimer();
    if (btn.dataset.tab === "pricing") { loadPricing(); loadCosts(); }
  };
});

async function loadProviders() {
  try {
    providers = (await api("/api/admin/providers")) || [];
    const rows = providers.map((p) => '<tr><td>' + esc(p.name) + '</td><td><code>' + esc(p.protocol) + '</code></td><td>' + esc(p.baseUrl) + '</td><td>' + esc(p.apiKeyPreview || "") + '</td><td>' + (p.lastProbeStatus ? badge(p.lastProbeStatus === "ok" ? "succeeded" : "failed") : "—") + '</td><td><button class="action" data-probe="' + esc(p.id) + '">探测</button> <button class="action danger" data-del="' + esc(p.id) + '">删除</button></td></tr>');
    $("#pTable tbody").innerHTML = rows.join("");
    $("#pEmpty").textContent = providers.length ? "" : "还没有服务商，先创建一个。";
    $("#pTable").querySelectorAll("[data-probe]").forEach((btn) => {
      btn.onclick = async () => {
        try { await api("/api/admin/providers/" + encodeURIComponent(btn.dataset.probe) + "/probe", { method: "POST", body: "{}" }); await loadProviders(); }
        catch (e) { $("#pErr").textContent = e.message; }
      };
    });
    $("#pTable").querySelectorAll("[data-del]").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("确认删除该服务商及其模型？")) return;
        try { await api("/api/admin/providers/" + encodeURIComponent(btn.dataset.del), { method: "DELETE" }); await loadProviders(); }
        catch (e) { $("#pErr").textContent = e.message; }
      };
    });
    fillProviderSelect();
  } catch (e) { $("#pErr").textContent = e.message; }
}

$("#pCreate").onclick = async () => {
  $("#pErr").textContent = "";
  try {
    await api("/api/admin/providers", { method: "POST", body: JSON.stringify({ name: $("#pName").value, baseUrl: $("#pBase").value, protocol: $("#pProtocol").value, enabled: true, apiKey: $("#pKey").value }) });
    $("#pKey").value = "";
    await loadProviders();
  } catch (e) { $("#pErr").textContent = e.message; }
};

function fillProviderSelect() {
  const select = $("#mProvider");
  const current = select.value;
  select.innerHTML = '<option value="">选择服务商…</option>' + providers.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>").join("");
  if (current) select.value = current;
}
$("#mProvider").onchange = loadModels;

async function loadModels() {
  const providerId = $("#mProvider").value;
  $("#mTable tbody").innerHTML = "";
  $("#mEmpty").textContent = providerId ? "加载中…" : "先选择服务商。";
  if (!providerId) return;
  try {
    const models = (await api("/api/admin/models?providerId=" + encodeURIComponent(providerId))) || [];
    $("#mTable tbody").innerHTML = models.map((m) => '<tr><td>' + esc(m.displayName) + '</td><td><code>' + esc(m.modelId) + '</code></td><td>' + esc(m.capability) + '</td><td>' + (m.enabled ? badge("succeeded").replace("succeeded", "启用") : badge("cancelled").replace("cancelled", "停用")) + '</td><td class="muted">' + esc((m.capabilityTags || []).join(", ")) + "</td></tr>").join("");
    $("#mEmpty").textContent = models.length ? "" : "该服务商还没有模型（可用 fetch-models/import-models 接口导入）。";
  } catch (e) { $("#mEmpty").textContent = e.message; }
}

function startTaskTimer() { stopTaskTimer(); taskTimer = setInterval(loadTasks, 5000); }
function stopTaskTimer() { if (taskTimer) clearInterval(taskTimer); taskTimer = null; }
$("#tRefresh").onclick = loadTasks;
$("#tStatus").onchange = loadTasks;

async function loadTasks() {
  try {
    const status = $("#tStatus").value;
    const res = (await api("/api/admin/tasks?limit=50" + (status ? "&status=" + encodeURIComponent(status) : ""))) || { tasks: [] };
    $("#tTable tbody").innerHTML = (res.tasks || []).map((t) => '<tr><td><code>' + esc(t.taskId) + '</code></td><td>' + esc(t.capability) + '</td><td>' + badge(t.status) + '</td><td>' + esc(t.displayStatus || "") + '</td><td>' + esc(t.providerId) + '</td><td class="muted">' + new Date(t.createdAt).toLocaleString() + "</td></tr>").join("");
    $("#tEmpty").textContent = (res.tasks || []).length ? "" : "暂无任务。";
  } catch (e) { $("#tEmpty").textContent = e.message; }
}

async function loadPricing() {
  try {
    const res = await api("/api/admin/pricing");
    $("#prTable tbody").innerHTML = (res.pricing || []).map((p) => '<tr><td>' + esc(p.scope) + '</td><td>' + esc(p.providerId) + '</td><td>' + esc(p.modelRecordId || p.runTargetId) + '</td><td>' + esc(p.kind) + '</td><td>' + esc(p.unitPrice || p.perSecondPrice) + ' ' + esc(p.currency) + '</td><td>' + (p.enabled ? "是" : "否") + '</td><td><button class="action danger" data-del-price="' + esc(p.id) + '">删除</button></td></tr>').join("");
    $("#prTable").querySelectorAll("[data-del-price]").forEach((btn) => {
      btn.onclick = async () => { await api("/api/admin/pricing/" + encodeURIComponent(btn.dataset.delPrice), { method: "DELETE" }); loadPricing(); };
    });
  } catch (e) { $("#prErr").textContent = e.message; }
}

$("#prSave").onclick = async () => {
  $("#prErr").textContent = "";
  const scope = $("#prScope").value;
  const target = $("#prTarget").value;
  const body = { scope, providerId: $("#prProvider").value, kind: $("#prKind").value, unitPrice: Number($("#prPrice").value || 0) };
  if (scope === "model") body.modelRecordId = target; else body.runTargetId = target;
  try {
    await api("/api/admin/pricing", { method: "PUT", body: JSON.stringify(body) });
    await loadPricing();
  } catch (e) { $("#prErr").textContent = e.message; }
};

async function loadCosts() {
  try {
    const summary = await api("/api/admin/costs/summary");
    $("#cSummary").textContent = "合计 " + summary.totalAmount + " " + Object.keys(summary.byCurrency || {}).join("/");
    $("#cTable tbody").innerHTML = (summary.items || []).map((i) => '<tr><td>' + esc(i.day) + '</td><td>' + esc(i.providerId) + '</td><td>' + esc(i.runTargetId) + '</td><td>' + esc(i.billedSource) + '</td><td>' + esc(i.amount) + " " + esc(i.currency) + '</td><td>' + esc(i.tasks) + "</td></tr>").join("");
  } catch (e) { $("#cSummary").textContent = e.message; }
}
$("#cRefresh").onclick = loadCosts;

boot();
</script>
</body>
</html>`;

export function registerAdminUiRoutes(router: Router) {
  router.add("GET", "/admin", async ({ response }) => {
    response.statusCode = 200;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.end(ADMIN_HTML);
  });
}
