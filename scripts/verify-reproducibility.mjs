import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { hashFile, readJson } from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const blender = process.env.BLENDER_BIN?.trim() || "blender";
const outputDir = join(root, "build", "reproducibility");

function requireBlender() {
  const result = spawnSync(blender, ["--version"], { cwd: root, encoding: "utf8" });
  if (result.error?.code === "ENOENT") {
    throw new Error("blender_not_found: set BLENDER_BIN=/path/to/blender or install blender on PATH");
  }
  if (result.error || result.status !== 0) {
    throw new Error(`blender_unavailable: set BLENDER_BIN=/path/to/blender or provide a working blender on PATH (${result.error?.message ?? result.stderr?.trim() ?? result.status})`);
  }
}

requireBlender();
const lock = await readJson(join(root, "source", "review-candidate-lock.json"));
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

function exportRun(name) {
  const output = join(outputDir, name);
  const result = spawnSync(blender, [
    "--background",
    join(root, lock.source.blendPath),
    "--python",
    join(root, "source", "export_scene.py"),
    "--",
    "--output",
    output
  ], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`reproducibility_export_failed:${name}:${result.status}`);
  return output;
}

const first = exportRun("run-1.glb");
const second = exportRun("run-2.glb");
const firstHash = await hashFile(first);
const secondHash = await hashFile(second);
if (firstHash !== secondHash) throw new Error(`two_run_glb_mismatch:${firstHash}:${secondHash}`);
if (firstHash !== lock.reproducibility.sha256) throw new Error(`locked_glb_mismatch:${firstHash}:${lock.reproducibility.sha256}`);
process.stdout.write(`Two saved-Blend exports are byte-identical: ${firstHash}\n`);
