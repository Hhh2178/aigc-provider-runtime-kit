import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const requiredFiles = [
  "AGENTS.md",
  "README.md",
  "MEMORY.md",
  "DEVLOG.md",
  "docs/INDEX.md",
  "docs/governance/root-entry-responsibility-matrix.md",
  "docs/governance/documentation-governance-standard.md",
  "docs/governance/engineering-guardrails.md",
  "docs/governance/secrets-and-access-policy.md",
  "docs/systems/README.md",
  "docs/systems/harness/README.md",
  "docs/systems/providers/README.md",
  "docs/systems/runninghub/README.md",
  "docs/systems/interface-documentation-template.md",
  "docs/superpowers/specs/2026-07-08-aigc-provider-runtime-kit-design.md",
  "docs/superpowers/plans/2026-07-08-aigc-provider-runtime-kit-implementation.md",
  "packages/core/src/index.ts",
  "packages/runninghub/src/index.ts",
  "packages/runtime/src/index.ts"
];

const requiredPackageScripts = [
  "harness:verify:project",
  "harness:verify:workspace",
  "harness:verify:release",
  "type-check",
  "build"
];

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) failures.push(`Missing required file: ${file}`);
}

const packageJsonPath = join(root, "package.json");
if (existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  for (const script of requiredPackageScripts) {
    if (!packageJson.scripts?.[script]) failures.push(`Missing package script: ${script}`);
  }
}

const readme = existsSync(join(root, "README.md")) ? readFileSync(join(root, "README.md"), "utf8") : "";
for (const anchor of ["Provider", "RunningHub", "Harness", "Security"]) {
  if (!readme.includes(anchor)) failures.push(`README missing anchor: ${anchor}`);
}

const gitignore = existsSync(join(root, ".gitignore")) ? readFileSync(join(root, ".gitignore"), "utf8") : "";
for (const token of [".env", "*.pem", "*.key"]) {
  if (!gitignore.includes(token)) failures.push(`.gitignore missing secret pattern: ${token}`);
}

if (failures.length > 0) {
  console.error("Harness verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Harness verification passed.");
