import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

import { assert, fileRecord } from "./lib.mjs";
import {
  CURRENT_HASHES,
  CURRENT_RELEASE_PATH,
  CURRENT_RELEASE_VERSION
} from "./release-0.4.0.mjs";

const root = resolve(import.meta.dirname, "..");
const blender = process.env.BLENDER_BIN?.trim();
const materializer = join(root, "scripts", "materialize-review-release-0.4.0.mjs");
const releaseGlb = join(root, CURRENT_RELEASE_PATH, "scene.glb");

assert(blender, "blender_bin_required:set_BLENDER_BIN_to_pinned_Blender");

for (let run = 1; run <= 2; run += 1) {
  const result = spawnSync(process.execPath, [materializer], {
    cwd: root,
    env: { ...process.env, BLENDER_BIN: blender, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`release_0_4_materialization_run_failed:${run}:${result.error?.message ?? result.status}`);
  }
  const record = await fileRecord(releaseGlb);
  assert(record.sha256 === CURRENT_HASHES.finalGlb && record.sizeBytes === 6674412, `release_0_4_materialization_run_drift:${run}`);
}

process.stdout.write(`Review release ${CURRENT_RELEASE_VERSION} reproduced twice from the accepted baked source and matched ${CURRENT_HASHES.finalGlb}.\n`);
