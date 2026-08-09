import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const runRoot = join(
  projectRoot,
  ".temp",
  "build",
  `${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${process.pid}`,
);
const stagedOutput = join(runRoot, "dist");
const finalOutput = join(projectRoot, "dist");
mkdirSync(runRoot, { recursive: true });

const compiler = spawnSync(
  process.execPath,
  [
    join(projectRoot, "node_modules", "typescript", "bin", "tsc"),
    "-p",
    join(projectRoot, "tsconfig.json"),
    "--outDir",
    stagedOutput,
  ],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  },
);
if (compiler.error !== undefined) {
  throw compiler.error;
}
if (compiler.signal !== null) {
  throw new Error(`TypeScript build terminated by ${compiler.signal}`);
}
if (compiler.status !== 0) {
  process.exit(compiler.status ?? 1);
}
if (existsSync(finalOutput)) {
  renameSync(finalOutput, join(runRoot, "previous-dist"));
}
renameSync(stagedOutput, finalOutput);
