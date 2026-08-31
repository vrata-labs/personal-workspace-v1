import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import validator from "gltf-validator";

import {
  BAKED_PLATFORM_COMMIT,
  BAKED_RELEASE,
  BAKED_RELEASE_VERSION,
  BLENDER_BINARY_SHA256,
  BLENDER_BUILD_HASH,
  BLENDER_VERSION,
  METADATA_VERSION,
  RELEASE_FILES,
  RIGHTS_APPROVAL_STATUS,
  SCENE_ID,
  VERSION,
  assert,
  assertBakedMaterialContract,
  createBakedReleaseScene,
  fileRecord,
  glbTextureRecords,
  glbStats,
  hashFile,
  isReleaseVersionPrefix,
  nextReleaseVersion,
  readJson
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const blender = process.env.BLENDER_BIN?.trim();
const releaseDir = join(root, BAKED_RELEASE.releasePath);
const temporaryReleaseDir = join(root, "build", `baked-release-${BAKED_RELEASE_VERSION}`);
const secondGlb = join(root, "build", `baked-release-${BAKED_RELEASE_VERSION}.second.glb`);
const exportLightmap = join(root, "build", "baked-lightmap.png");
const metadataReleaseDir = join(root, "assets", "scenes", SCENE_ID, METADATA_VERSION);
const twice = process.argv.includes("--twice");

function isTrackedAtHead(path) {
  const result = spawnSync("git", ["cat-file", "-e", `HEAD:${path}`], { cwd: root, stdio: "ignore" });
  if (result.error) throw result.error;
  return result.status === 0;
}

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
  const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  assert(JSON.stringify(entries) === JSON.stringify(RELEASE_FILES), `${code}:${entries.join(",")}`);
}

function runBlender(output) {
  const result = spawnSync(blender, [
    "--background",
    join(root, BAKED_RELEASE.blendPath),
    "--python",
    join(root, BAKED_RELEASE.exportScriptPath),
    "--",
    "--output",
    output,
    "--lightmap",
    exportLightmap
  ], { cwd: root, stdio: "inherit" });
  if (result.error?.code === "ENOENT") throw new Error("blender_not_found: set BLENDER_BIN to the pinned Blender binary");
  if (result.error || result.status !== 0) throw new Error(`baked_export_failed:${result.error?.message ?? result.status}`);
}

assert(blender, "blender_bin_required: set BLENDER_BIN to the pinned Blender binary");
const atlasBytes = await readFile(join(root, BAKED_RELEASE.lightmapPath)).catch((error) => {
  if (error.code === "ENOENT") throw new Error(`baked_lightmap_missing:${BAKED_RELEASE.lightmapPath}`);
  throw error;
});
const versionResult = spawnSync(blender, ["--version"], { cwd: root, encoding: "utf8" });
if (versionResult.error?.code === "ENOENT") throw new Error("blender_not_found: set BLENDER_BIN to the pinned Blender binary");
if (versionResult.error || versionResult.status !== 0) throw new Error(`blender_unavailable:${versionResult.error?.message ?? versionResult.status}`);
assert(versionResult.stdout.includes(`Blender ${BLENDER_VERSION}`), `unexpected_blender_version:${versionResult.stdout.split("\n")[0]}`);
assert(versionResult.stdout.includes(BLENDER_BUILD_HASH), "unexpected_blender_build_hash");
assert(await hashFile(blender) === BLENDER_BINARY_SHA256, "unexpected_blender_binary_sha256");

const [packageManifest, repository, manifest, contract] = await Promise.all([
  readJson(join(root, "package.json")),
  readJson(join(root, "scene-repository.json")),
  readJson(join(root, "manifest.json")),
  readJson(join(root, "source", "scene-contract.json"))
]);
assert(packageManifest.version === VERSION && repository.releaseVersion === VERSION, "current_release_version_mismatch");
assert(repository.platformValidatorCommit === BAKED_PLATFORM_COMMIT && manifest.platformValidatorCommit === BAKED_PLATFORM_COMMIT, "baked_platform_validator_mismatch");
const manifestVersions = manifest.releases.map(({ version }) => version);
assert(isReleaseVersionPrefix(manifestVersions), "invalid_release_set_before_baked_build");
const nextVersion = nextReleaseVersion(manifestVersions);
assert(nextVersion === null || nextVersion === BAKED_RELEASE_VERSION, `baked_release_must_be_next:${nextVersion}`);

await rm(temporaryReleaseDir, { recursive: true, force: true });
await rm(secondGlb, { force: true });
await mkdir(temporaryReleaseDir, { recursive: true });
// Keep the original embedded texture name while the accepted source atlas has a versioned filename.
await copyFile(join(root, BAKED_RELEASE.lightmapPath), exportLightmap);
runBlender(join(temporaryReleaseDir, "scene.glb"));
if (twice) {
  runBlender(secondGlb);
  assertRecord(await fileRecord(secondGlb), await fileRecord(join(temporaryReleaseDir, "scene.glb")), "baked_two_run_glb_mismatch");
  await rm(secondGlb);
}
await rm(exportLightmap);

await copyFile(join(metadataReleaseDir, "LICENSES.md"), join(temporaryReleaseDir, "LICENSES.md"));
await copyFile(join(root, BAKED_RELEASE.runtimeCapturePath, "preview.webp"), join(temporaryReleaseDir, "preview.webp"));
const metadataScene = await readJson(join(metadataReleaseDir, "scene.json"));
await writeJson(join(temporaryReleaseDir, "scene.json"), createBakedReleaseScene(metadataScene));
await assertExactFiles(temporaryReleaseDir, "invalid_generated_baked_release_files");
const generatedFiles = await recordsFor(temporaryReleaseDir);
const generatedGlb = join(temporaryReleaseDir, "scene.glb");
const glbBytes = await readFile(generatedGlb);
const validation = await validator.validateBytes(new Uint8Array(glbBytes), { uri: `${SCENE_ID}@${BAKED_RELEASE_VERSION}/scene.glb`, maxIssues: 200 });
assert(validation.issues.numErrors === 0, `khronos_gltf_validation_errors:${validation.issues.numErrors}`);
const stats = await glbStats(generatedGlb);
assert(stats.scenes === 1, `one_gltf_scene_required:${stats.scenes}`);
assert(glbBytes.length <= contract.budgets.glbBytesMax, `glb_budget_exceeded:${glbBytes.length}`);
assert(stats.triangles <= contract.budgets.trianglesMax, `triangle_budget_exceeded:${stats.triangles}`);
assert(stats.objects <= contract.budgets.objectsMax, `object_budget_exceeded:${stats.objects}`);
assert(stats.meshes <= contract.budgets.meshesMax, `mesh_budget_exceeded:${stats.meshes}`);
assert(stats.materials <= contract.budgets.materialsMax, `material_budget_exceeded:${stats.materials}`);
assert(stats.textures <= contract.budgets.texturesMax, `texture_budget_exceeded:${stats.textures}`);
await assertBakedMaterialContract(generatedGlb);
const textures = await glbTextureRecords(generatedGlb);
assert(textures.length === 1
  && textures[0].mimeType === "image/png"
  && textures[0].sha256 === (await fileRecord(join(root, BAKED_RELEASE.lightmapPath))).sha256
  && textures[0].sizeBytes === atlasBytes.length, "embedded_lightmap_atlas_drift");

const releaseExists = await readdir(releaseDir).then(() => true, (error) => error.code === "ENOENT" ? false : Promise.reject(error));
const releaseTrackedAtHead = isTrackedAtHead(BAKED_RELEASE.releasePath);
if (releaseExists && releaseTrackedAtHead) {
  await assertExactFiles(releaseDir, "invalid_existing_baked_release_files");
  const existingFiles = await recordsFor(releaseDir);
  for (const name of RELEASE_FILES) assertRecord(existingFiles[name], generatedFiles[name], `immutable_baked_release_drift:${name}`);
  await rm(temporaryReleaseDir, { recursive: true, force: true });
} else {
  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(dirname(releaseDir), { recursive: true });
  await rename(temporaryReleaseDir, releaseDir);
}

const releaseRecord = {
  sceneId: SCENE_ID,
  version: BAKED_RELEASE_VERSION,
  releasePath: BAKED_RELEASE.releasePath,
  status: "review",
  acceptanceStatus: "pending-human-acceptance",
  visualAcceptanceStatus: "pending-human-acceptance",
  rightsApprovalStatus: RIGHTS_APPROVAL_STATUS,
  rightsApproved: true,
  isCurrent: false,
  publicationReady: false,
  files: generatedFiles,
  stats
};
const existingRecord = manifest.releases.find(({ version }) => version === BAKED_RELEASE_VERSION);
if (existingRecord && releaseTrackedAtHead) assert(JSON.stringify(existingRecord) === JSON.stringify(releaseRecord), "immutable_baked_manifest_record_drift");
else {
  const releases = existingRecord
    ? manifest.releases.map((release) => release.version === BAKED_RELEASE_VERSION ? releaseRecord : release)
    : [...manifest.releases, releaseRecord];
  await writeJson(join(root, "manifest.json"), { ...manifest, releases });
}

process.stdout.write(`Built immutable review release ${SCENE_ID}@${BAKED_RELEASE_VERSION}\nGLB SHA-256 ${generatedFiles["scene.glb"].sha256}\nStats ${JSON.stringify(stats)}\n`);
