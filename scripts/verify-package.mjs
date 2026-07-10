import { access, readFile } from "node:fs/promises";

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

console.log(`Package verification passed (${targets.size} entry targets).`);
