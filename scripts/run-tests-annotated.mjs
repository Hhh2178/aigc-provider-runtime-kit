import { spawn } from "node:child_process";

/**
 * CI test runner: streams the normal `npm test` output, and on failure emits a
 * GitHub Actions `::error::` annotation with the failing lines so the failure
 * is readable through the public annotations API (workflow logs need auth).
 */
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npm, ["test"], {
  stdio: ["inherit", "pipe", "pipe"],
  shell: process.platform === "win32",
  env: process.env
});

let captured = "";
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  captured += String(chunk);
});
child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  captured += String(chunk);
});

child.on("close", (code) => {
  if (code === 0) {
    process.exit(0);
  }
  if (process.env.CI) {
    const lines = captured.split(/\r?\n/).filter(Boolean);
    const interesting = lines.filter((line) =>
      line.includes("✖")
      || line.includes("AssertionError")
      || line.includes("Error:")
      || line.includes("FAIL")
      || line.includes("not ok")
    );
    const tail = (interesting.length > 0 ? interesting : lines.slice(-30)).slice(-30);
    // %0A is the GitHub Actions newline escape inside workflow commands.
    console.log(`::error title=tests failed (exit ${code})::${tail.join("%0A")}`);
  }
  process.exit(code ?? 1);
});
