import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import validator from "gltf-validator";

import {
  BLENDER_BINARY_SHA256,
  BLENDER_BUILD_HASH,
  BLENDER_VERSION,
  RELEASE_FILES,
  REVIEW_RELEASE,
  REVIEW_RELEASE_VERSION,
  REVIEW_RIGHTS_APPROVAL_STATUS,
  SCENE_ID,
  assert,
  assertReviewReleaseMaterialContract,
  fileRecord,
  glbStats,
  glbTextureRecords,
  hashFile,
  isReleaseVersionPrefix,
  nextReleaseVersion,
  pathTrackedInGit,
  readJson
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const blender = process.env.BLENDER_BIN?.trim();
const releaseDir = join(root, REVIEW_RELEASE.releasePath);
const temporaryReleaseDir = join(root, "build", `review-release-${REVIEW_RELEASE_VERSION}`);
const secondGlb = join(root, "build", `review-release-${REVIEW_RELEASE_VERSION}.second.glb`);
const twice = process.argv.includes("--twice");
const verifyOnly = process.argv.includes("--verify-only");

function assertRecord(actual, expected, code) {
  assert(actual?.sha256 === expected?.sha256 && actual?.sizeBytes === expected?.sizeBytes, code);
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function recordsFor(directory) {
  return Object.fromEntries(await Promise.all(RELEASE_FILES.map(async (name) => [name, await fileRecord(join(directory, name))])));
}

async function assertExactFiles(directory, code) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  assert(JSON.stringify(entries) === JSON.stringify(RELEASE_FILES), `${code}:${entries.join(",")}`);
}

function runBlender(output) {
  const result = spawnSync(blender, [
    "--background",
    join(root, REVIEW_RELEASE.blendPath),
    "--python",
    join(root, REVIEW_RELEASE.exportScriptPath),
    "--",
    "--output",
    output,
    "--lightmap",
    join(root, REVIEW_RELEASE.lightmapPath)
  ], { cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, stdio: "inherit" });
  if (result.error?.code === "ENOENT") throw new Error("blender_not_found: set BLENDER_BIN to the pinned Blender binary");
  if (result.error || result.status !== 0) throw new Error(`review_export_failed:${result.error?.message ?? result.status}`);
}

function reproducePanoramaRgb() {
  const result = spawnSync(blender, [
    "--background",
    "--python",
    join(root, REVIEW_RELEASE.panoramaGeneratorPath),
    "--python-expr",
    "import sys; sys.stdout.flush()",
    "--",
    "--parameters",
    join(root, REVIEW_RELEASE.panoramaParametersPath),
    "--decoded-only"
  ], { cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8" });
  if (result.error?.code === "ENOENT") throw new Error("blender_not_found: set BLENDER_BIN to the pinned Blender binary");
  if (result.error || result.status !== 0) throw new Error(`review_panorama_reproduction_failed:${result.error?.message ?? result.stderr?.trim() ?? result.status}`);
  const record = result.stdout.split(/\r?\n/).reverse().find((line) => line.startsWith("{") && line.endsWith("}"));
  assert(record, "review_panorama_reproduction_record_missing");
  return JSON.parse(record);
}

assert(blender, "blender_bin_required: set BLENDER_BIN to the pinned Blender binary");
const versionResult = spawnSync(blender, ["--version"], { cwd: root, encoding: "utf8" });
if (versionResult.error?.code === "ENOENT") throw new Error("blender_not_found: set BLENDER_BIN to the pinned Blender binary");
if (versionResult.error || versionResult.status !== 0) throw new Error(`blender_unavailable:${versionResult.error?.message ?? versionResult.stderr?.trim() ?? versionResult.status}`);
assert(versionResult.stdout.includes(`Blender ${BLENDER_VERSION}`), `unexpected_blender_version:${versionResult.stdout.split("\n")[0]}`);
assert(versionResult.stdout.includes(BLENDER_BUILD_HASH), "unexpected_blender_build_hash");
assert(await hashFile(blender) === BLENDER_BINARY_SHA256, "unexpected_blender_binary_sha256");

const [packageManifest, repository, manifest, reality, sourceScene, previousScene, panoramaParameters] = await Promise.all([
  readJson(join(root, "package.json")),
  readJson(join(root, "scene-repository.json")),
  readJson(join(root, "manifest.json")),
  readJson(join(root, REVIEW_RELEASE.sceneRealityPath)),
  readJson(join(root, REVIEW_RELEASE.sceneManifestPath)),
  readJson(join(root, "assets", "scenes", SCENE_ID, "0.2.0", "scene.json")),
  readJson(join(root, REVIEW_RELEASE.panoramaParametersPath))
]);
assert(packageManifest.version === repository.releaseVersion, "current_release_version_mismatch");
const manifestVersions = manifest.releases.map(({ version }) => version);
assert(isReleaseVersionPrefix(manifestVersions), "invalid_release_set_before_review_build");
const nextVersion = nextReleaseVersion(manifestVersions);
assert(nextVersion === null || nextVersion === REVIEW_RELEASE_VERSION, `review_release_must_be_next:${nextVersion}`);
assert(sourceScene.sceneId === SCENE_ID && sourceScene.version === REVIEW_RELEASE_VERSION, "invalid_review_scene_identity");
assert(sourceScene.status === "review"
  && sourceScene.acceptanceStatus === "pending-human-acceptance"
  && sourceScene.visualAcceptanceStatus === "pending-human-acceptance"
  && sourceScene.rightsApprovalStatus === REVIEW_RIGHTS_APPROVAL_STATUS
  && sourceScene.rightsApproved === false
  && sourceScene.isCurrent === false
  && sourceScene.publicationReady === false, "invalid_review_scene_gate_state");
for (const field of ["spawnPoints", "bounds", "anchors", "mediaSurfaces", "renderMode", "renderProfile"]) {
  assert(JSON.stringify(sourceScene[field]) === JSON.stringify(previousScene[field]), `preserved_runtime_binding_drift:${field}`);
}

await rm(temporaryReleaseDir, { recursive: true, force: true });
await rm(secondGlb, { force: true });
await mkdir(temporaryReleaseDir, { recursive: true });
runBlender(join(temporaryReleaseDir, "scene.glb"));
if (twice) {
  const panoramaFirst = reproducePanoramaRgb();
  const panoramaSecond = reproducePanoramaRgb();
  assert(panoramaFirst.decodedRgbSha256 === panoramaParameters.decodedRgbSha256
    && panoramaSecond.decodedRgbSha256 === panoramaParameters.decodedRgbSha256
    && JSON.stringify(panoramaFirst) === JSON.stringify(panoramaSecond), "review_two_run_panorama_rgb_mismatch");
  runBlender(secondGlb);
  assertRecord(await fileRecord(secondGlb), await fileRecord(join(temporaryReleaseDir, "scene.glb")), "review_two_run_glb_mismatch");
  await rm(secondGlb);
}
await copyFile(join(root, REVIEW_RELEASE.sceneManifestPath), join(temporaryReleaseDir, "scene.json"));
await copyFile(join(root, REVIEW_RELEASE.reviewPath, "entry.webp"), join(temporaryReleaseDir, "preview.webp"));
await copyFile(join(root, REVIEW_RELEASE.licensePath), join(temporaryReleaseDir, "LICENSES.md"));
await assertExactFiles(temporaryReleaseDir, "invalid_generated_review_release_files");

const generatedFiles = await recordsFor(temporaryReleaseDir);
const generatedGlb = join(temporaryReleaseDir, "scene.glb");
const glbBytes = await readFile(generatedGlb);
const validation = await validator.validateBytes(new Uint8Array(glbBytes), { uri: `${SCENE_ID}@${REVIEW_RELEASE_VERSION}/scene.glb`, maxIssues: 500 });
assert(validation.issues.numErrors === 0 && validation.issues.numWarnings === 0, `khronos_gltf_validation_failed:${validation.issues.numErrors}:${validation.issues.numWarnings}`);
const stats = await glbStats(generatedGlb);
assert(JSON.stringify(stats) === JSON.stringify({
  triangles: 45772,
  objects: 232,
  meshes: 232,
  primitives: 232,
  materials: 16,
  textures: 2,
  animations: 0,
  scenes: 1
}), `review_release_stats_drift:${JSON.stringify(stats)}`);
assert(glbBytes.length <= reality.budgets.glbBytesMax, `glb_budget_exceeded:${glbBytes.length}`);
assert(stats.triangles <= reality.budgets.trianglesMax, `triangle_budget_exceeded:${stats.triangles}`);
assert(stats.objects <= reality.budgets.meshNodesMax, `object_budget_exceeded:${stats.objects}`);
assert(stats.materials <= reality.budgets.materialsMax, `material_budget_exceeded:${stats.materials}`);
assert(stats.textures <= reality.budgets.texturesMax, `texture_budget_exceeded:${stats.textures}`);
await assertReviewReleaseMaterialContract(generatedGlb);
const [textures, lightmapRecord, panoramaRecord] = await Promise.all([
  glbTextureRecords(generatedGlb),
  fileRecord(join(root, REVIEW_RELEASE.lightmapPath)),
  fileRecord(join(root, REVIEW_RELEASE.panoramaPath))
]);
assert(JSON.stringify(textures) === JSON.stringify([
  { name: "baked-lightmap", mimeType: "image/png", ...lightmapRecord },
  { name: "panorama-city-park", mimeType: "image/jpeg", ...panoramaRecord }
]), "embedded_review_texture_drift");

const releaseExists = await readdir(releaseDir).then(() => true, (error) => error.code === "ENOENT" ? false : Promise.reject(error));
const releaseTrackedAtHead = pathTrackedInGit(root, REVIEW_RELEASE.releasePath);
assert(!releaseTrackedAtHead || releaseExists, "tracked_review_release_missing");
if (verifyOnly) {
  assert(releaseExists, "review_release_missing_for_verification");
  await assertExactFiles(releaseDir, "invalid_existing_review_release_files");
  const existingFiles = await recordsFor(releaseDir);
  for (const name of RELEASE_FILES) assertRecord(existingFiles[name], generatedFiles[name], `review_release_reproducibility_drift:${name}`);
  await rm(temporaryReleaseDir, { recursive: true, force: true });
} else if (releaseExists && releaseTrackedAtHead) {
  await assertExactFiles(releaseDir, "invalid_existing_review_release_files");
  const existingFiles = await recordsFor(releaseDir);
  for (const name of RELEASE_FILES) assertRecord(existingFiles[name], generatedFiles[name], `immutable_review_release_drift:${name}`);
  await rm(temporaryReleaseDir, { recursive: true, force: true });
} else {
  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(dirname(releaseDir), { recursive: true });
  await rename(temporaryReleaseDir, releaseDir);
}

const releaseRecord = {
  sceneId: SCENE_ID,
  version: REVIEW_RELEASE_VERSION,
  releasePath: REVIEW_RELEASE.releasePath,
  status: "review",
  acceptanceStatus: "pending-human-acceptance",
  visualAcceptanceStatus: "pending-human-acceptance",
  rightsApprovalStatus: REVIEW_RIGHTS_APPROVAL_STATUS,
  rightsApproved: false,
  isCurrent: false,
  publicationReady: false,
  files: generatedFiles,
  stats
};
const existingRecord = manifest.releases.find(({ version }) => version === REVIEW_RELEASE_VERSION);
if (verifyOnly || (existingRecord && releaseTrackedAtHead)) {
  assert(JSON.stringify(existingRecord) === JSON.stringify(releaseRecord), "immutable_review_manifest_record_drift");
} else {
  const releases = existingRecord
    ? manifest.releases.map((release) => release.version === REVIEW_RELEASE_VERSION ? releaseRecord : release)
    : [...manifest.releases, releaseRecord];
  await writeJson(join(root, "manifest.json"), {
    ...manifest,
    releases
  });
}

process.stdout.write(`Built immutable review release ${SCENE_ID}@${REVIEW_RELEASE_VERSION}\nGLB SHA-256 ${generatedFiles["scene.glb"].sha256}\nStats ${JSON.stringify(stats)}\n${twice ? `Panorama pre-encoding RGB SHA-256 ${panoramaParameters.decodedRgbSha256}\n` : ""}`);
