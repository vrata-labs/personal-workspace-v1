import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  BLENDER_BINARY_SHA256,
  HISTORICAL_PLATFORM_COMMIT,
  PLATFORM_COMMIT,
  RELEASE_FILES,
  RELEASE_VERSIONS,
  RENDER_PROFILE,
  REVIEW_VIEWS,
  RIGHTS_ALLOWED_USES,
  RIGHTS_APPROVAL_STATUS,
  RIGHTS_APPROVED_ON,
  RIGHTS_LICENSE_REF,
  SCENE_ID,
  SHARED_RELEASE_FILES,
  SOURCE_VERSION,
  SPAWN_YAW,
  VERSION,
  canonicalSha256,
  createMetadataReleaseScene,
  fileRecord,
  readJson,
  toRuntimePosition,
  webpDimensions,
  yawToward
} from "../scripts/lib.mjs";

const root = resolve(import.meta.dirname, "..");
const sceneRoot = join(root, "assets", "scenes", SCENE_ID);

test("coordinate adapter reflects semantic z exactly once", () => {
  assert.deepEqual(toRuntimePosition({ x: 1.25, y: 0.4, z: -2.5 }), { x: 1.25, y: 0.4, z: 2.5 });
  assert.deepEqual(toRuntimePosition({ x: -1, y: 0, z: 2 }), { x: -1, y: 0, z: -2 });
});

test("0.1.0 remains the historical authoring source", async () => {
  const [contract, lock, candidate] = await Promise.all([
    readJson(join(root, "source", "scene-contract.json")),
    readJson(join(root, "source", "scene-contract-lock.json")),
    readJson(join(root, "source", "review-candidate-lock.json"))
  ]);
  assert.equal(contract.version, SOURCE_VERSION);
  assert.equal(candidate.version, SOURCE_VERSION);
  assert.equal(candidate.release.path, `assets/scenes/${SCENE_ID}/${SOURCE_VERSION}`);
  assert.equal(lock.contractCanonicalSha256, canonicalSha256(contract));
  assert.equal(lock.platformValidatorCommit, HISTORICAL_PLATFORM_COMMIT);
  assert.equal(contract.visualDirection.audienceLayout, false);
  assert.equal(contract.boundaries.humanVisualAccepted, false);
  assert.equal(contract.boundaries.rightsApprovalStatus, RIGHTS_APPROVAL_STATUS);
  assert.equal(contract.boundaries.rightsApprovedOn, RIGHTS_APPROVED_ON);
  for (const name of RELEASE_FILES) assert.deepEqual(await fileRecord(join(sceneRoot, SOURCE_VERSION, name)), candidate.release.files[name]);
  assert.deepEqual(candidate.reviewViews.map(({ id }) => id), REVIEW_VIEWS);
  for (const view of REVIEW_VIEWS) assert.deepEqual(webpDimensions(await readFile(join(root, "source", "review", `${view}.webp`))), { width: 960, height: 540 });
});

test("0.1.1 is an exact metadata-only derivation with neutral PBR and directed spawn yaw", async () => {
  const source = await readJson(join(sceneRoot, SOURCE_VERSION, "scene.json"));
  const release = await readJson(join(sceneRoot, VERSION, "scene.json"));
  assert.deepEqual(release, createMetadataReleaseScene(source));
  assert.equal(release.renderProfile, RENDER_PROFILE);
  assert.equal(release.spawnPoints[0].yaw, SPAWN_YAW);
  assert.equal(release.isCurrent, false);
  const spawn = { x: 2.25, y: 0, z: 1.8 };
  const surface = { x: -1.08, y: 1.56, z: -2.43 };
  assert.equal(SPAWN_YAW, Math.atan2(-(surface.x - spawn.x), -(surface.z - spawn.z)));
  assert.equal(SPAWN_YAW, yawToward(spawn, surface));
  assert.deepEqual(release.rights, source.rights);
  assert.equal(release.status, "review");
  assert.equal(release.visualAcceptanceStatus, "pending-human-acceptance");
  assert.equal(release.publicationReady, false);
});

test("both releases preserve the runtime workspace contract", async () => {
  const contract = await readJson(join(root, "source", "scene-contract.json"));
  for (const version of RELEASE_VERSIONS) {
    const scene = await readJson(join(sceneRoot, version, "scene.json"));
    assert.deepEqual(scene.spawnPoints[0].position, toRuntimePosition(contract.spawn.position));
    assert.deepEqual(scene.anchors.seatAnchors[0].position, toRuntimePosition(contract.seats[0].position));
    assert.deepEqual(scene.mediaSurfaces[0].transform, {
      ...toRuntimePosition(contract.mediaSurfaces[0].transform),
      yaw: contract.mediaSurfaces[0].transform.yaw,
      pitch: contract.mediaSurfaces[0].transform.pitch,
      roll: contract.mediaSurfaces[0].transform.roll
    });
    assert.equal(scene.renderMode, "clean");
    assert.equal(scene.rights.license, RIGHTS_LICENSE_REF);
    assert.deepEqual(scene.rights.clearedFor, RIGHTS_ALLOWED_USES);
    for (const field of ["input", "representation", "position", "pixelDimensions", "frontFace"]) assert.equal(field in scene.mediaSurfaces[0], false);
  }
});

test("root records contain two review releases while historical and metadata evidence stay separate", async () => {
  const [packageManifest, repository, manifest, releaseLedger, metadataEvidence] = await Promise.all([
    readJson(join(root, "package.json")),
    readJson(join(root, "scene-repository.json")),
    readJson(join(root, "manifest.json")),
    readJson(join(root, "provenance", "release-artifact-ledger.json")),
    readJson(join(root, "provenance", `metadata-release-${VERSION}.json`))
  ]);
  assert.equal(packageManifest.version, VERSION);
  assert.equal(repository.releaseVersion, VERSION);
  assert.deepEqual(manifest.releases.map(({ version }) => version), RELEASE_VERSIONS);
  assert.equal(manifest.releases.every(({ isCurrent, publicationReady }) => isCurrent === false && publicationReady === false), true);
  assert.equal(releaseLedger.releaseVersion, SOURCE_VERSION);
  assert.equal(releaseLedger.rights.productionActivation, false);
  assert.equal(releaseLedger.rights.humanVisualAccepted, false);
  assert.equal(metadataEvidence.platformValidatorCommit, PLATFORM_COMMIT);
  assert.equal(metadataEvidence.baseVersion, SOURCE_VERSION);
  assert.equal(metadataEvidence.targetVersion, VERSION);
  assert.equal(metadataEvidence.renderProfile, RENDER_PROFILE);
  assert.equal(metadataEvidence.spawnYaw, SPAWN_YAW);
  assert.equal(metadataEvidence.isCurrent, false);
  assert.equal(metadataEvidence.publicationReady, false);
});

test("release directories are exact and shared artifact hashes are unchanged", async () => {
  const manifest = await readJson(join(root, "manifest.json"));
  assert.deepEqual((await readdir(join(root, "assets", "scenes"))).sort(), [SCENE_ID]);
  assert.deepEqual((await readdir(sceneRoot)).sort(), [...RELEASE_VERSIONS].sort());
  for (const release of manifest.releases) {
    assert.deepEqual((await readdir(join(sceneRoot, release.version))).sort(), RELEASE_FILES);
    for (const name of RELEASE_FILES) assert.deepEqual(await fileRecord(join(sceneRoot, release.version, name)), release.files[name]);
  }
  const [sourceRelease, metadataRelease] = manifest.releases;
  for (const name of SHARED_RELEASE_FILES) assert.deepEqual(metadataRelease.files[name], sourceRelease.files[name]);
  assert.notEqual(metadataRelease.files["scene.json"].sha256, sourceRelease.files["scene.json"].sha256);
});

test("historical Blender evidence and current metadata tooling use distinct validator pins", async () => {
  const [validatorLock, generationLedger, metadataEvidence, buildScript, reproducibilityScript, workflow, readme] = await Promise.all([
    readFile(join(root, "platform-validator.lock"), "utf8"),
    readJson(join(root, "provenance", "generation-ledger.json")),
    readJson(join(root, "provenance", `metadata-release-${VERSION}.json`)),
    readFile(join(root, "scripts", "build-candidate.mjs"), "utf8"),
    readFile(join(root, "scripts", "verify-reproducibility.mjs"), "utf8"),
    readFile(join(root, ".github", "workflows", "validate.yml"), "utf8"),
    readFile(join(root, "README.md"), "utf8")
  ]);
  assert.equal(validatorLock.trim(), PLATFORM_COMMIT);
  assert.equal(generationLedger.toolchain.platformValidatorCommit, HISTORICAL_PLATFORM_COMMIT);
  assert.equal(generationLedger.toolchain.blenderBinarySha256, BLENDER_BINARY_SHA256);
  assert.equal(metadataEvidence.platformValidatorCommit, PLATFORM_COMMIT);
  assert.doesNotMatch(buildScript, /BLENDER_BIN|spawnSync|review-candidate\.blend/);
  assert.match(reproducibilityScript, /BLENDER_BIN/);
  assert.match(reproducibilityScript, /export_scene\.py/);
  assert.match(reproducibilityScript, /historical-run-1\.glb/);
  assert.match(reproducibilityScript, /historical-run-2\.glb/);
  assert.match(reproducibilityScript, /metadata-run-1/);
  assert.match(reproducibilityScript, /metadata-run-2/);
  assert.match(readme, /BLENDER_BIN=\/path\/to\/blender pnpm verify:reproducibility/);
  assert.doesNotMatch(readme, /\/tmp\/opencode/);
  for (const version of RELEASE_VERSIONS) assert.match(workflow, new RegExp(`personal-workspace-v1/${version.replaceAll(".", "\\.")}`));
});
