import { copyFile, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  BAKED_PLATFORM_COMMIT,
  BASE_RELEASE_VERSIONS,
  METADATA_PLATFORM_COMMIT,
  METADATA_RENDER_PROFILE,
  METADATA_VERSION,
  PUBLISHED_BAKED_VERSIONS,
  RIGHTS_APPROVAL_STATUS,
  RELEASE_FILES,
  SCENE_ID,
  SHARED_RELEASE_FILES,
  SOURCE_VERSION,
  SPAWN_YAW,
  VERSION,
  assert,
  createMetadataReleaseScene,
  fileRecord,
  glbStats,
  isReleaseVersionPrefix,
  readJson
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const buildDir = join(root, "build");
const sourceReleaseDir = join(root, "assets", "scenes", SCENE_ID, SOURCE_VERSION);
const releaseDir = join(root, "assets", "scenes", SCENE_ID, METADATA_VERSION);
const temporaryReleaseDir = join(buildDir, `metadata-release-${METADATA_VERSION}`);

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

function assertRecords(actual, expected, code) {
  for (const name of RELEASE_FILES) assert(JSON.stringify(actual[name]) === JSON.stringify(expected[name]), `${code}:${name}`);
}

const packageManifest = await readJson(join(root, "package.json"));
const repository = await readJson(join(root, "scene-repository.json"));
const existingManifest = await readJson(join(root, "manifest.json"));
const candidateLock = await readJson(join(root, "source", "review-candidate-lock.json"));
assert(packageManifest.version === VERSION && repository.releaseVersion === VERSION, "current_release_version_mismatch");
assert(isReleaseVersionPrefix(existingManifest.releases.map(({ version }) => version)), "invalid_existing_release_set");
assert(candidateLock.version === SOURCE_VERSION && candidateLock.release.path === `assets/scenes/${SCENE_ID}/${SOURCE_VERSION}`, "historical_source_lock_drift");
await assertExactFiles(sourceReleaseDir, "invalid_historical_release_files");
const sourceFiles = await recordsFor(sourceReleaseDir);
assertRecords(sourceFiles, candidateLock.release.files, "immutable_historical_release_drift");

await rm(temporaryReleaseDir, { recursive: true, force: true });
await mkdir(temporaryReleaseDir, { recursive: true });
for (const name of SHARED_RELEASE_FILES) await copyFile(join(sourceReleaseDir, name), join(temporaryReleaseDir, name));
const sourceScene = await readJson(join(sourceReleaseDir, "scene.json"));
await writeJson(join(temporaryReleaseDir, "scene.json"), createMetadataReleaseScene(sourceScene));
const generatedFiles = await recordsFor(temporaryReleaseDir);

const releaseExists = await readdir(releaseDir).then(() => true, (error) => error.code === "ENOENT" ? false : Promise.reject(error));
if (releaseExists) {
  await assertExactFiles(releaseDir, "invalid_existing_metadata_release_files");
  assertRecords(await recordsFor(releaseDir), generatedFiles, "immutable_metadata_release_drift");
  await rm(temporaryReleaseDir, { recursive: true, force: true });
} else {
  await mkdir(join(root, "assets", "scenes", SCENE_ID), { recursive: true });
  await rename(temporaryReleaseDir, releaseDir);
}

const releaseFiles = await recordsFor(releaseDir);
const stats = await glbStats(join(releaseDir, "scene.glb"));
assert(JSON.stringify(stats) === JSON.stringify(candidateLock.release.stats), "shared_glb_stats_drift");
for (const name of SHARED_RELEASE_FILES) {
  assert(JSON.stringify(sourceFiles[name]) === JSON.stringify(releaseFiles[name]), `shared_release_file_drift:${name}`);
}

const releaseRecord = (version, files) => ({
  sceneId: SCENE_ID,
  version,
  releasePath: `assets/scenes/${SCENE_ID}/${version}`,
  status: "review",
  acceptanceStatus: "pending-human-acceptance",
  visualAcceptanceStatus: "pending-human-acceptance",
  rightsApprovalStatus: RIGHTS_APPROVAL_STATUS,
  rightsApproved: true,
  isCurrent: false,
  publicationReady: false,
  files,
  stats
});

await writeJson(join(root, "manifest.json"), {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  blenderVersion: "4.5.12 LTS",
  blenderBuildHash: "84afd5f785f7",
  platformValidatorCommit: BAKED_PLATFORM_COMMIT,
  status: "review",
  acceptanceStatus: "pending-human-acceptance",
  visualAcceptanceStatus: "pending-human-acceptance",
  rightsApprovalStatus: RIGHTS_APPROVAL_STATUS,
  rightsApproved: true,
  publicationReady: false,
  releases: [
    releaseRecord(SOURCE_VERSION, sourceFiles),
    releaseRecord(METADATA_VERSION, releaseFiles),
    ...existingManifest.releases.slice(BASE_RELEASE_VERSIONS.length).filter(({ version }) => PUBLISHED_BAKED_VERSIONS.includes(version))
  ]
});

await writeJson(join(root, "provenance", `metadata-release-${METADATA_VERSION}.json`), {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  kind: "metadata-only-review-release",
  platformValidatorCommit: METADATA_PLATFORM_COMMIT,
  baseVersion: SOURCE_VERSION,
  targetVersion: METADATA_VERSION,
  renderProfile: METADATA_RENDER_PROFILE,
  spawnYaw: SPAWN_YAW,
  status: "review",
  acceptanceStatus: "pending-human-acceptance",
  visualAcceptanceStatus: "pending-human-acceptance",
  rightsApprovalStatus: RIGHTS_APPROVAL_STATUS,
  rightsApproved: true,
  isCurrent: false,
  publicationReady: false,
  humanVisualAccepted: false,
  productionActivation: false,
  sharedFiles: Object.fromEntries(SHARED_RELEASE_FILES.map((name) => [name, releaseFiles[name]])),
  sceneJson: releaseFiles["scene.json"]
});

process.stdout.write(`Built metadata-only ${SCENE_ID}@${METADATA_VERSION} from immutable ${SOURCE_VERSION}\nShared GLB SHA-256 ${releaseFiles["scene.glb"].sha256}\nStats ${JSON.stringify(stats)}\n`);
