import { spawnSync } from "node:child_process";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  BAKED_RELEASE,
  BAKED_RELEASE_VERSION,
  BLENDER_BINARY_SHA256,
  BLENDER_BUILD_HASH,
  BLENDER_VERSION,
  METADATA_VERSION,
  RELEASE_FILES,
  SCENE_ID,
  SHARED_RELEASE_FILES,
  SOURCE_VERSION,
  assert,
  createBakedReleaseScene,
  createMetadataReleaseScene,
  fileRecord,
  hashFile,
  readJson
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const blender = process.env.BLENDER_BIN?.trim();
const outputDir = join(root, "build", "reproducibility");
const sourceReleaseDir = join(root, "assets", "scenes", SCENE_ID, SOURCE_VERSION);
const metadataReleaseDir = join(root, "assets", "scenes", SCENE_ID, METADATA_VERSION);
const bakedReleaseDir = join(root, BAKED_RELEASE.releasePath);
const sourceDir = join(root, "source");

function assertRecord(actual, expected, code) {
  assert(actual?.sha256 === expected?.sha256 && actual?.sizeBytes === expected?.sizeBytes, code);
}

function runBlender(args, code) {
  const result = spawnSync(blender, args, { cwd: root, stdio: "inherit" });
  if (result.error?.code === "ENOENT") throw new Error("blender_not_found: set BLENDER_BIN to the pinned Blender binary");
  if (result.error || result.status !== 0) throw new Error(`${code}:${result.error?.message ?? result.status}`);
}

async function exportHistoricalRun(name) {
  const output = join(outputDir, name);
  runBlender([
    "--background",
    join(sourceDir, "review-candidate.blend"),
    "--python",
    join(sourceDir, "export_scene.py"),
    "--",
    "--output",
    output
  ], `historical_export_failed:${name}`);
  return fileRecord(output);
}

async function materializeMetadataRun(name) {
  const directory = join(outputDir, name);
  await mkdir(directory, { recursive: true });
  for (const file of SHARED_RELEASE_FILES) await copyFile(join(sourceReleaseDir, file), join(directory, file));
  const sourceScene = await readJson(join(sourceReleaseDir, "scene.json"));
  await writeFile(join(directory, "scene.json"), `${JSON.stringify(createMetadataReleaseScene(sourceScene), null, 2)}\n`);
  return Object.fromEntries(await Promise.all(RELEASE_FILES.map(async (file) => [file, await fileRecord(join(directory, file))])));
}

async function materializeBakedRun(name) {
  const directory = join(outputDir, name);
  await mkdir(directory, { recursive: true });
  const exportLightmap = join(directory, "baked-lightmap.png");
  await copyFile(join(root, BAKED_RELEASE.lightmapPath), exportLightmap);
  runBlender([
    "--background",
    join(root, BAKED_RELEASE.blendPath),
    "--python",
    join(root, BAKED_RELEASE.exportScriptPath),
    "--",
    "--output",
    join(directory, "scene.glb"),
    "--lightmap",
    exportLightmap
  ], `baked_export_failed:${name}`);
  await rm(exportLightmap);
  await copyFile(join(metadataReleaseDir, "LICENSES.md"), join(directory, "LICENSES.md"));
  await copyFile(join(root, BAKED_RELEASE.runtimeCapturePath, "preview.webp"), join(directory, "preview.webp"));
  const metadataScene = await readJson(join(metadataReleaseDir, "scene.json"));
  await writeFile(join(directory, "scene.json"), `${JSON.stringify(createBakedReleaseScene(metadataScene), null, 2)}\n`);
  return Object.fromEntries(await Promise.all(RELEASE_FILES.map(async (file) => [file, await fileRecord(join(directory, file))])));
}

assert(blender, "blender_bin_required: set BLENDER_BIN to the pinned Blender binary");
const versionResult = spawnSync(blender, ["--version"], { cwd: root, encoding: "utf8" });
if (versionResult.error?.code === "ENOENT") throw new Error("blender_not_found: set BLENDER_BIN to the pinned Blender binary");
if (versionResult.error || versionResult.status !== 0) throw new Error(`blender_unavailable:${versionResult.error?.message ?? versionResult.stderr?.trim() ?? versionResult.status}`);
assert(versionResult.stdout.includes(`Blender ${BLENDER_VERSION}`), `unexpected_blender_version:${versionResult.stdout.split("\n")[0]}`);
assert(versionResult.stdout.includes(BLENDER_BUILD_HASH), "unexpected_blender_build_hash");
assert(await hashFile(blender) === BLENDER_BINARY_SHA256, "unexpected_blender_binary_sha256");

const candidateLock = await readJson(join(sourceDir, "review-candidate-lock.json"));
assert(candidateLock.version === SOURCE_VERSION, "historical_candidate_version_drift");
assertRecord(await fileRecord(join(sourceDir, "review-candidate.blend")), candidateLock.source, "historical_blend_drift");
assertRecord(await fileRecord(join(sourceDir, "export_scene.py")), candidateLock.source.scripts["export_scene.py"], "historical_export_script_drift");
assertRecord(await fileRecord(join(sourceReleaseDir, "scene.glb")), candidateLock.release.files["scene.glb"], "historical_release_glb_drift");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
const historicalFirst = await exportHistoricalRun("historical-run-1.glb");
const historicalSecond = await exportHistoricalRun("historical-run-2.glb");
assertRecord(historicalFirst, historicalSecond, "historical_two_run_glb_mismatch");
assert(historicalFirst.sha256 === candidateLock.reproducibility.sha256, "historical_locked_glb_mismatch");
assertRecord(historicalFirst, candidateLock.release.files["scene.glb"], "historical_release_glb_mismatch");

const metadataFirst = await materializeMetadataRun("metadata-run-1");
const metadataSecond = await materializeMetadataRun("metadata-run-2");
for (const file of RELEASE_FILES) {
  const released = await fileRecord(join(metadataReleaseDir, file));
  assertRecord(metadataFirst[file], metadataSecond[file], `metadata_two_run_mismatch:${file}`);
  assertRecord(metadataFirst[file], released, `metadata_release_mismatch:${file}`);
}

const manifest = await readJson(join(root, "manifest.json"));
const bakedRecord = manifest.releases.find(({ version }) => version === BAKED_RELEASE_VERSION);
assert(bakedRecord?.releasePath === BAKED_RELEASE.releasePath, "baked_release_record_missing");
const bakedFirst = await materializeBakedRun("baked-run-1");
const bakedSecond = await materializeBakedRun("baked-run-2");
for (const file of RELEASE_FILES) {
  const released = await fileRecord(join(bakedReleaseDir, file));
  assertRecord(bakedFirst[file], bakedSecond[file], `baked_two_run_mismatch:${file}`);
  assertRecord(bakedFirst[file], released, `baked_release_mismatch:${file}`);
  assertRecord(released, bakedRecord.files[file], `baked_manifest_record_mismatch:${file}`);
}

process.stdout.write(`Historical ${SOURCE_VERSION} saved-Blend exports are byte-identical: ${historicalFirst.sha256}\n`);
process.stdout.write(`Metadata-only ${METADATA_VERSION} materializations are byte-identical and match all four release files.\n`);
process.stdout.write(`Baked ${BAKED_RELEASE_VERSION} materializations are byte-identical and match all four release files.\n`);
