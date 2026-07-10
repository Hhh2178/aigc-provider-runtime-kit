import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = new URL("..", import.meta.url);

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const targets = new Set();

for (const entry of Object.values(pkg.exports || {})) {
  if (!entry || typeof entry !== "object") continue;
  if (typeof entry.import === "string") targets.add(entry.import);
  if (typeof entry.types === "string") targets.add(entry.types);
}

if (typeof pkg.main === "string") targets.add(pkg.main);
if (typeof pkg.types === "string") targets.add(pkg.types);

for (const target of targets) {
  await access(new URL(`../${target.replace(/^\.\//, "")}`, import.meta.url));
}

if (!Array.isArray(pkg.files) || !pkg.files.includes("dist/packages")) {
  throw new Error("package files must include dist/packages");
}

if (pkg.files.includes("dist")) {
  throw new Error("package files must not include all of dist");
}

const temporary = await mkdtemp(join(tmpdir(), "aigc-provider-runtime-kit-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const childEnvironment = {
  ...process.env,
  HOME: temporary,
  npm_config_cache: join(temporary, "npm-cache")
};

try {
  const packed = await run(npm, ["pack", "--json", "--pack-destination", temporary, "--cache", join(temporary, "npm-cache")], { cwd: root, env: childEnvironment });
  const packageInfo = JSON.parse(packed.stdout)[0];
  const tarball = join(temporary, packageInfo.filename);
  const packagedPaths = packageInfo.files.map((file) => file.path);
  if (packagedPaths.some((path) => path.includes("examples"))) throw new Error("published package must not contain compiled examples");

  await writeFile(join(temporary, "package.json"), JSON.stringify({ private: true, type: "module" }));
  await run(npm, ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", "--cache", join(temporary, "npm-cache")], { cwd: temporary, env: childEnvironment });
  await writeFile(join(temporary, "consumer.mjs"), [
    'import * as runtime from "aigc-provider-runtime-kit";',
    'import * as core from "aigc-provider-runtime-kit/core";',
    'import * as runninghub from "aigc-provider-runtime-kit/runninghub";',
    'import * as unified from "aigc-provider-runtime-kit/runtime";',
    'if (typeof runtime.createProviderRegistry !== "function") throw new Error("missing root export");',
    'if (typeof core.createOpenAICompatibleClient !== "function") throw new Error("missing core export");',
    'if (typeof runninghub.createRunningHubClient !== "function") throw new Error("missing RunningHub export");',
    'if (typeof unified.createProviderRuntime !== "function") throw new Error("missing runtime export");'
  ].join("\n"));
  await run(process.execPath, [join(temporary, "consumer.mjs")], { cwd: temporary });
  console.log(`Package verification passed (${targets.size} entry targets, ${packageInfo.entryCount} packed files, installed consumer smoke test).`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
