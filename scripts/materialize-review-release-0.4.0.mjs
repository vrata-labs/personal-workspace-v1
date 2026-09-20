import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import validator from "gltf-validator";

import {
  BLENDER_BINARY_SHA256,
  BLENDER_BUILD_HASH,
  BLENDER_VERSION,
  assert,
  fileRecord,
  glbStats,
  hashFile,
  pathTrackedInGit,
  readJson
} from "./lib.mjs";
import {
  CURRENT_HASHES,
  CURRENT_RELEASE_FILES,
  CURRENT_RELEASE_PATH,
  CURRENT_RELEASE_VERSION,
  CURRENT_SOURCE_PATH,
  CURRENT_STATS
} from "./release-0.4.0.mjs";

const root = resolve(import.meta.dirname, "..");
const blender = process.env.BLENDER_BIN?.trim();
const releaseDir = join(root, CURRENT_RELEASE_PATH);
const sourceDir = join(root, CURRENT_SOURCE_PATH);
const temporaryDir = join(root, "build", `review-release-${CURRENT_RELEASE_VERSION}`);
const rawGlb = join(temporaryDir, "scene.raw.glb");
const finalGlb = join(temporaryDir, "scene.glb");

function assertRecord(actual, expected, code) {
  assert(actual?.sha256 === expected?.sha256 && actual?.sizeBytes === expected?.sizeBytes, code);
}

function run(command, args, code) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    stdio: "inherit"
  });
  if (result.error?.code === "ENOENT") throw new Error(`${code}:command_not_found`);
  if (result.error || result.status !== 0) throw new Error(`${code}:${result.error?.message ?? result.status}`);
}

async function recordsFor(directory) {
  return Object.fromEntries(await Promise.all(CURRENT_RELEASE_FILES.map(async (name) => [name, await fileRecord(join(directory, name))])));
}

async function assertExactFiles(directory, code) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  assert(JSON.stringify(entries) === JSON.stringify([...CURRENT_RELEASE_FILES].sort()), `${code}:${entries.join(",")}`);
}

assert(blender, "blender_bin_required:set_BLENDER_BIN_to_pinned_Blender");
const version = spawnSync(blender, ["--version"], { cwd: root, encoding: "utf8" });
if (version.error?.code === "ENOENT") throw new Error("blender_not_found:set_BLENDER_BIN_to_pinned_Blender");
assert(version.status === 0, `blender_unavailable:${version.status}`);
assert(version.stdout.includes(`Blender ${BLENDER_VERSION}`), "unexpected_blender_version");
assert(version.stdout.includes(BLENDER_BUILD_HASH), "unexpected_blender_build_hash");
assert(await hashFile(blender) === BLENDER_BINARY_SHA256, "unexpected_blender_binary_sha256");

const sourceRecords = await Promise.all([
  ["draft-scene.blend", CURRENT_HASHES.authoredBlend],
  ["baked-source-0.4.0.blend", CURRENT_HASHES.bakedBlend],
  ["lightmap-0.4.0.png", CURRENT_HASHES.atlas],
  ["scene-manifest.json", CURRENT_HASHES.sceneManifest],
  ["preview.webp", CURRENT_HASHES.preview],
  ["release-LICENSES.md", CURRENT_HASHES.licenses]
].map(async ([name, sha256]) => ({ name, expected: sha256, actual: await hashFile(join(sourceDir, name)) })));
for (const record of sourceRecords) assert(record.actual === record.expected, `accepted_source_drift:${record.name}`);

await rm(temporaryDir, { recursive: true, force: true });
await mkdir(temporaryDir, { recursive: true });
run(blender, [
  "--background",
  join(sourceDir, "baked-source-0.4.0.blend"),
  "--python",
  join(sourceDir, "export-scene.py"),
  "--",
  "--out",
  rawGlb,
  "--atlas",
  join(sourceDir, "lightmap-0.4.0.png")
], "release_0_4_raw_export_failed");
assert(await hashFile(rawGlb) === CURRENT_HASHES.rawGlb, "release_0_4_raw_glb_drift");

run(process.execPath, [
  join(sourceDir, "finalize-glb.mjs"),
  relative(root, rawGlb),
  relative(root, finalGlb)
], "release_0_4_finalization_failed");
const finalRecord = await fileRecord(finalGlb);
assertRecord(finalRecord, { sha256: CURRENT_HASHES.finalGlb, sizeBytes: 6674412 }, "release_0_4_final_glb_drift");

await Promise.all([
  copyFile(join(sourceDir, "scene-manifest.json"), join(temporaryDir, "scene.json")),
  copyFile(join(sourceDir, "preview.webp"), join(temporaryDir, "preview.webp")),
  copyFile(join(sourceDir, "release-LICENSES.md"), join(temporaryDir, "LICENSES.md"))
]);
await rm(rawGlb);
await assertExactFiles(temporaryDir, "invalid_materialized_release_files");

const scene = await readJson(join(temporaryDir, "scene.json"));
assert(scene.version === CURRENT_RELEASE_VERSION && scene.glbSha256 === CURRENT_HASHES.finalGlb, "release_0_4_scene_binding_drift");
const bytes = await readFile(finalGlb);
const report = await validator.validateBytes(bytes, { maxIssues: 100000 });
assert(report.issues.numErrors === 0 && report.issues.numWarnings === 0, `release_0_4_gltf_validation_failed:${report.issues.numErrors}:${report.issues.numWarnings}`);
assert(JSON.stringify(await glbStats(finalGlb)) === JSON.stringify(CURRENT_STATS), "release_0_4_stats_drift");

const generated = await recordsFor(temporaryDir);
const releaseExists = await readdir(releaseDir).then(() => true, (error) => error.code === "ENOENT" ? false : Promise.reject(error));
if (releaseExists) {
  await assertExactFiles(releaseDir, "invalid_existing_release_files");
  const existing = await recordsFor(releaseDir);
  for (const name of CURRENT_RELEASE_FILES) assertRecord(existing[name], generated[name], `immutable_release_0_4_drift:${name}`);
  await rm(temporaryDir, { recursive: true, force: true });
} else {
  assert(!pathTrackedInGit(root, CURRENT_RELEASE_PATH), "tracked_release_0_4_missing");
  await mkdir(dirname(releaseDir), { recursive: true });
  await rename(temporaryDir, releaseDir);
}

process.stdout.write(`Materialized ${CURRENT_RELEASE_VERSION}: ${CURRENT_HASHES.finalGlb} (${finalRecord.sizeBytes} bytes)\n`);
