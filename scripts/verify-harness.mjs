import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const requiredFiles = [
  "AGENTS.md",
  "README.md",
  "MEMORY.md",
  "DEVLOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "docs/INDEX.md",
  "docs/getting-started.md",
  "docs/api-reference.md",
  "docs/roadmap.md",
  "docs/governance/root-entry-responsibility-matrix.md",
  "docs/governance/documentation-governance-standard.md",
  "docs/governance/engineering-guardrails.md",
  "docs/governance/secrets-and-access-policy.md",
  "docs/systems/README.md",
  "docs/systems/harness/README.md",
  "docs/systems/providers/README.md",
  "docs/systems/runninghub/README.md",
  "docs/systems/runtime/README.md",
  "docs/systems/control-center/README.md",
  "docs/systems/interface-documentation-template.md",
  "docs/superpowers/specs/2026-07-08-aigc-provider-runtime-kit-design.md",
  "docs/superpowers/plans/2026-07-08-aigc-provider-runtime-kit-implementation.md",
  "packages/kit/src/core/index.ts",
  "packages/kit/src/runninghub/index.ts",
  "packages/kit/src/runtime/index.ts",
  "packages/control-center/src/index.ts",
  "packages/control-center/src/migrations.ts",
  "packages/control-center/tests"
];

const requiredPackageScripts = [
  "harness:verify:project",
  "harness:verify:workspace",
  "harness:verify:release",
  "type-check",
  "build",
  "test",
  "test:package",
  "prepack"
];

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) failures.push(`Missing required file: ${file}`);
}

const packageJsonPath = join(root, "package.json");
const packageJson = existsSync(packageJsonPath) ? JSON.parse(readFileSync(packageJsonPath, "utf8")) : {};
for (const script of requiredPackageScripts) {
  if (!packageJson.scripts?.[script]) failures.push(`Missing package script: ${script}`);
}

const kitPackageJsonPath = join(root, "packages/kit/package.json");
const kitPackageJson = existsSync(kitPackageJsonPath) ? JSON.parse(readFileSync(kitPackageJsonPath, "utf8")) : {};
if (kitPackageJson.name !== "aigc-provider-runtime-kit") {
  failures.push("packages/kit must keep the published package name aigc-provider-runtime-kit");
}
for (const exportPath of [".", "./core", "./runninghub", "./runtime"]) {
  if (!kitPackageJson.exports?.[exportPath]?.types) failures.push(`kit exports missing types for: ${exportPath}`);
  if (!kitPackageJson.exports?.[exportPath]?.import) failures.push(`kit exports missing import for: ${exportPath}`);
}
for (const field of ["main", "types", "files", "sideEffects", "engines", "repository", "bugs", "homepage"]) {
  if (kitPackageJson[field] === undefined) failures.push(`kit package.json missing package maturity field: ${field}`);
}
if (kitPackageJson.dependencies && Object.keys(kitPackageJson.dependencies).length > 0) {
  failures.push("kit package must remain dependency-free at runtime");
}

const readme = existsSync(join(root, "README.md")) ? readFileSync(join(root, "README.md"), "utf8") : "";
for (const anchor of ["Provider", "RunningHub", "Harness", "Security", "Package Entrypoints", "Local Development"]) {
  if (!readme.includes(anchor)) failures.push(`README missing anchor: ${anchor}`);
}

const gitignore = existsSync(join(root, ".gitignore")) ? readFileSync(join(root, ".gitignore"), "utf8") : "";
for (const token of [".env", "*.pem", "*.key"]) {
  if (!gitignore.includes(token)) failures.push(`.gitignore missing secret pattern: ${token}`);
}

const ci = existsSync(join(root, ".github/workflows/ci.yml")) ? readFileSync(join(root, ".github/workflows/ci.yml"), "utf8") : "";
for (const command of ["npm ci", "npm run harness:verify:project", "npm run type-check", "npm run test:ci", "npm run test:package"]) {
  if (!ci.includes(command)) failures.push(`CI missing command: ${command}`);
}

for (const testFile of [
  "packages/kit/tests/core.test.mjs",
  "packages/kit/tests/provider-runtime.test.mjs",
  "packages/kit/tests/runninghub.test.mjs",
  "packages/kit/tests/runtime.test.mjs"
]) {
  if (!existsSync(join(root, testFile))) failures.push(`Missing test file: ${testFile}`);
}

if (failures.length > 0) {
  console.error("Harness verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Harness verification passed.");
