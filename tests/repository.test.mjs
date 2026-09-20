import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  BAKED_PLATFORM_COMMIT,
  BAKED_RELEASE,
  BAKED_RELEASE_VERSION,
  BAKED_RENDER_PROFILE,
  BASE_RELEASE_VERSIONS,
  BLENDER_REVIEW_HORIZONTAL_FOV_DEGREES,
  BLENDER_BINARY_SHA256,
  CURRENT_PLATFORM_COMMIT,
  CURRENT_RELEASE_VERSION,
  HISTORICAL_PLATFORM_COMMIT,
  METADATA_PLATFORM_COMMIT,
  METADATA_RENDER_PROFILE,
  METADATA_VERSION,
  PUBLISHED_BAKED_VERSIONS,
  RELEASE_FILES,
  RELEASE_VERSIONS,
  REVIEW_RELEASE,
  REVIEW_RELEASE_VERSION,
  REVIEW_RELEASE_VIEWS,
  REVIEW_RIGHTS_APPROVAL_STATUS,
  REVIEW_RIGHTS_LICENSE_REF,
  REVIEW_RUNTIME_CAPTURE_FILES,
  REVIEW_RUNTIME_CAPTURE_RUNS,
  REVIEW_VIEWS,
  RUNTIME_CAPTURE_ARTIFACT_FILES,
  RUNTIME_CAPTURE_FILES,
  RUNTIME_REVIEW_ASPECT_RATIO,
  RIGHTS_ALLOWED_USES,
  RIGHTS_APPROVAL_STATUS,
  RIGHTS_APPROVED_ON,
  RIGHTS_LICENSE_REF,
  SCENE_ID,
  SHARED_RELEASE_FILES,
  SOURCE_VERSION,
  SPAWN_YAW,
  VERSION,
  bakedReleaseBinaryPaths,
  bakedReleasePaths,
  assertAcceptanceIndexPrefix,
  assertReviewOnlyGates,
  canonicalSha256,
  createBakedReleaseScene,
  createMetadataReleaseScene,
  fileRecord,
  glbTextureRecords,
  horizontalToVerticalFovDegrees,
  isReleaseVersionPrefix,
  nextReleaseVersion,
  pathTrackedInGit,
  pngDimensions,
  readJson,
  repositoryToolingPaths,
  sha256,
  toRuntimePosition,
  webpDimensions,
  yawToward
} from "../scripts/lib.mjs";
import { FINAL_TECHNICAL_VISUAL_PARITY_POLICY } from "../scripts/visual-parity-config.mjs";

const root = resolve(import.meta.dirname, "..");
const sceneRoot = join(root, "assets", "scenes", SCENE_ID);

test("coordinate adapter reflects semantic z exactly once", () => {
  assert.deepEqual(toRuntimePosition({ x: 1.25, y: 0.4, z: -2.5 }), { x: 1.25, y: 0.4, z: 2.5 });
  assert.deepEqual(toRuntimePosition({ x: -1, y: 0, z: 2 }), { x: -1, y: 0, z: -2 });
});

test("integrity helpers fail closed for mutable history, gate claims, and git state", async () => {
  const baseIndex = { schemaVersion: 1, sceneId: SCENE_ID, releases: [{ version: "0.2.0", lockSha256: "base" }] };
  assert.doesNotThrow(() => assertAcceptanceIndexPrefix(baseIndex, {
    ...baseIndex,
    releases: [...baseIndex.releases, { version: REVIEW_RELEASE_VERSION, lockSha256: "candidate" }]
  }));
  assert.throws(() => assertAcceptanceIndexPrefix(baseIndex, { ...baseIndex, releases: [] }), /acceptance_index_history_deleted/);
  assert.throws(() => assertAcceptanceIndexPrefix(baseIndex, {
    ...baseIndex,
    releases: [{ version: "0.2.0", lockSha256: "changed" }]
  }), /acceptance_index_history_changed/);
  for (const claim of [
    { status: "active" },
    { visualApproval: "approved" },
    { rightsApprovalStatus: RIGHTS_APPROVAL_STATUS },
    { humanRightsApproval: RIGHTS_APPROVAL_STATUS },
    { rightsApproval: { status: RIGHTS_APPROVAL_STATUS } },
    { rightsApproval: null },
    { rightsApproval: [] },
    { visualAcceptance: "approved" },
    { visualAcceptance: { status: "approved" } },
    { humanRightsAccepted: true },
    { humanGates: { visual: "approved" } },
    { humanGates: { rights: RIGHTS_APPROVAL_STATUS } },
    { immutableRelease: true },
    { publicationReady: true }
  ]) assert.throws(() => assertReviewOnlyGates(claim, "probe"));
  assert.doesNotThrow(() => assertReviewOnlyGates({ rightsApprovalStatus: RIGHTS_APPROVAL_STATUS, rightsApproved: true }, "historical", { allowApprovedRights: true }));
  assert.doesNotThrow(() => assertReviewOnlyGates({ rightsApproval: { status: RIGHTS_APPROVAL_STATUS } }, "historical", { allowApprovedRights: true }));
  const historicalOptions = { allowHistoricalManifestRecords: true };
  assert.doesNotThrow(() => assertReviewOnlyGates({ releases: [
    { version: "0.2.0", rightsApprovalStatus: RIGHTS_APPROVAL_STATUS, rightsApproved: true },
    { version: REVIEW_RELEASE_VERSION, rightsApprovalStatus: REVIEW_RIGHTS_APPROVAL_STATUS, rightsApproved: false }
  ] }, "manifest.json", historicalOptions));
  for (const claim of [
    { version: "0.2.0", rightsApproved: true },
    { extra: { version: "0.2.0", rightsApproved: true } },
    { releases: [{ version: "0.4.0", rightsApproved: true }] },
    { releases: [{ version: REVIEW_RELEASE_VERSION, details: { version: "0.2.0", rightsApproved: true } }] },
    { releases: [{ version: REVIEW_RELEASE_VERSION, releases: [{ version: "0.2.0", rightsApproved: true }] }] }
  ]) assert.throws(() => assertReviewOnlyGates(claim, "manifest.json", historicalOptions), /rights_approval_claim/);
  assert.equal(pathTrackedInGit(root, "package.json"), true);
  assert.equal(pathTrackedInGit(root, "missing-integrity-probe"), false);
  const tooling = await repositoryToolingPaths(root);
  for (const path of [
    ".github/workflows/validate.yml",
    "package.json",
    "pnpm-lock.yaml",
    "scripts/build-review-release.mjs",
    "scripts/write-review-evidence.mjs",
    "scripts/calibrate-review-visual.mjs",
    "scripts/create-review-capture-binding.mjs",
    "scripts/lib.mjs",
    "scripts/validate-baked-visual-parity.mjs",
    "tests/repository.test.mjs"
  ]) assert.ok(tooling.includes(path), path);
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
  const release = await readJson(join(sceneRoot, METADATA_VERSION, "scene.json"));
  assert.deepEqual(release, createMetadataReleaseScene(source));
  assert.equal(release.renderProfile, METADATA_RENDER_PROFILE);
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

test("materialized releases preserve the runtime workspace contract", async () => {
  const contract = await readJson(join(root, "source", "scene-contract.json"));
  const manifest = await readJson(join(root, "manifest.json"));
  for (const { version } of manifest.releases) {
    const scene = await readJson(join(sceneRoot, version, "scene.json"));
    if (version === CURRENT_RELEASE_VERSION) {
      assert.deepEqual(scene.spawnPoints[0].position, { x: 2.1, y: 0, z: 1.55 });
      assert.deepEqual(scene.anchors.seatAnchors[0].position, { x: -1.05, y: 0, z: -0.72 });
      assert.deepEqual(scene.mediaSurfaces[0].transform, { x: -1.05, y: 1.35, z: -2.422, yaw: 0, pitch: 0, roll: 0 });
    } else {
      assert.deepEqual(scene.spawnPoints[0].position, toRuntimePosition(contract.spawn.position));
      assert.deepEqual(scene.anchors.seatAnchors[0].position, toRuntimePosition(contract.seats[0].position));
      assert.deepEqual(scene.mediaSurfaces[0].transform, {
        ...toRuntimePosition(contract.mediaSurfaces[0].transform),
        yaw: contract.mediaSurfaces[0].transform.yaw,
        pitch: contract.mediaSurfaces[0].transform.pitch,
        roll: contract.mediaSurfaces[0].transform.roll
      });
    }
    assert.equal(scene.renderMode, "clean");
    if ([REVIEW_RELEASE_VERSION, CURRENT_RELEASE_VERSION].includes(version)) {
      if (version === REVIEW_RELEASE_VERSION) assert.equal(scene.rights.license, REVIEW_RIGHTS_LICENSE_REF);
      assert.deepEqual(scene.rights.clearedFor, []);
    } else {
      assert.equal(scene.rights.license, RIGHTS_LICENSE_REF);
      assert.deepEqual(scene.rights.clearedFor, RIGHTS_ALLOWED_USES);
    }
    for (const field of ["input", "representation", "position", "pixelDimensions", "frontFace"]) assert.equal(field in scene.mediaSurfaces[0], false);
  }
});

test("root records preserve historical releases and declare 0.4.0 as the review target", async () => {
  const [packageManifest, repository, manifest, releaseLedger, metadataEvidence] = await Promise.all([
    readJson(join(root, "package.json")),
    readJson(join(root, "scene-repository.json")),
    readJson(join(root, "manifest.json")),
    readJson(join(root, "provenance", "release-artifact-ledger.json")),
    readJson(join(root, "provenance", `metadata-release-${METADATA_VERSION}.json`))
  ]);
  assert.equal(packageManifest.version, VERSION);
  assert.equal(repository.releaseVersion, VERSION);
  assert.deepEqual(PUBLISHED_BAKED_VERSIONS, [BAKED_RELEASE_VERSION]);
  assert.equal(BAKED_RELEASE_VERSION, "0.2.0");
  assert.equal(VERSION, CURRENT_RELEASE_VERSION);
  const manifestVersions = manifest.releases.map(({ version }) => version);
  assert.deepEqual(manifestVersions, RELEASE_VERSIONS);
  assert.equal(manifest.releases.every(({ isCurrent, publicationReady }) => isCurrent === false && publicationReady === false), true);
  assert.equal(releaseLedger.releaseVersion, SOURCE_VERSION);
  assert.equal(releaseLedger.rights.productionActivation, false);
  assert.equal(releaseLedger.rights.humanVisualAccepted, false);
  assert.equal(repository.platformValidatorCommit, CURRENT_PLATFORM_COMMIT);
  assert.equal(manifest.platformValidatorCommit, CURRENT_PLATFORM_COMMIT);
  assert.equal(repository.qualityOutcome, "REWORK_REQUIRED");
  assert.equal(repository.rightsApprovalStatus, REVIEW_RIGHTS_APPROVAL_STATUS);
  assert.equal(repository.rightsApproved, false);
  assert.equal(manifest.rightsApprovalStatus, REVIEW_RIGHTS_APPROVAL_STATUS);
  assert.equal(manifest.rightsApproved, false);
  assert.equal(metadataEvidence.platformValidatorCommit, METADATA_PLATFORM_COMMIT);
  assert.equal(metadataEvidence.baseVersion, SOURCE_VERSION);
  assert.equal(metadataEvidence.targetVersion, METADATA_VERSION);
  assert.equal(metadataEvidence.renderProfile, METADATA_RENDER_PROFILE);
  assert.equal(metadataEvidence.spawnYaw, SPAWN_YAW);
  assert.equal(metadataEvidence.isCurrent, false);
  assert.equal(metadataEvidence.publicationReady, false);
});

test("builders accept every exact release-history prefix and only advance to its next version", () => {
  const futureHistory = [...BASE_RELEASE_VERSIONS, "0.2.0", "0.3.0", "0.4.0"];
  for (let length = BASE_RELEASE_VERSIONS.length; length <= futureHistory.length; length += 1) {
    const prefix = futureHistory.slice(0, length);
    assert.equal(isReleaseVersionPrefix(prefix, futureHistory), true);
    assert.equal(nextReleaseVersion(prefix, futureHistory), futureHistory[length] ?? null);
  }
  for (const invalid of [
    [SOURCE_VERSION],
    [SOURCE_VERSION, "0.2.0"],
    [...BASE_RELEASE_VERSIONS, "0.3.0"],
    [...futureHistory, "0.5.0"]
  ]) {
    assert.equal(isReleaseVersionPrefix(invalid, futureHistory), false);
    assert.throws(() => nextReleaseVersion(invalid, futureHistory), /invalid_release_version_prefix/);
  }
});

test("boundary allowlist retains versioned baked inputs and capture binaries across append-only history", () => {
  const versions = [...PUBLISHED_BAKED_VERSIONS];
  const binaryPaths = bakedReleaseBinaryPaths(versions);
  for (const version of versions) {
    const paths = bakedReleasePaths(version);
    assert.deepEqual(paths, {
      version,
      evidencePath: `provenance/baked-lightmap-${version}.json`,
      blendPath: "source/review-candidate.blend",
      exportScriptPath: `source/export_baked_release_${version.replaceAll(".", "_")}.py`,
      lightmapPath: `source/baked-lightmap-${version}.png`,
      runtimeReviewPath: `source/runtime-review-${version}.json`,
      runtimeCapturePath: `provenance/runtime-capture-${version}`,
      releasePath: `assets/scenes/${SCENE_ID}/${version}`
    });
    assert.equal(binaryPaths.includes(paths.lightmapPath), true);
    for (const name of RUNTIME_CAPTURE_FILES.filter((name) => /\.(png|webp)$/i.test(name))) {
      assert.equal(binaryPaths.includes(`${paths.runtimeCapturePath}/${name}`), true);
    }
  }
  assert.equal(new Set(binaryPaths).size, binaryPaths.length);
  assert.equal(REVIEW_RELEASE.blendPath, "source/releases/0.3.0/review-scene.blend");
  assert.equal(REVIEW_RELEASE.lightmapPath, "source/releases/0.3.0/baked-lightmap.png");
  assert.equal(REVIEW_RELEASE.panoramaPath, "source/releases/0.3.0/panorama-city-park.jpg");
  assert.equal(REVIEW_RELEASE.reviewPath, "source/releases/0.3.0/review");
});

test("release directories are exact and shared artifact hashes are unchanged", async () => {
  const manifest = await readJson(join(root, "manifest.json"));
  assert.deepEqual((await readdir(join(root, "assets", "scenes"))).sort(), [SCENE_ID]);
  assert.deepEqual((await readdir(sceneRoot)).sort(), manifest.releases.map(({ version }) => version).sort());
  for (const release of manifest.releases) {
    assert.deepEqual((await readdir(join(sceneRoot, release.version))).sort(), RELEASE_FILES);
    for (const name of RELEASE_FILES) assert.deepEqual(await fileRecord(join(sceneRoot, release.version, name)), release.files[name]);
  }
  const [sourceRelease, metadataRelease] = manifest.releases;
  for (const name of SHARED_RELEASE_FILES) assert.deepEqual(metadataRelease.files[name], sourceRelease.files[name]);
  assert.notEqual(metadataRelease.files["scene.json"].sha256, sourceRelease.files["scene.json"].sha256);
  const bakedRelease = manifest.releases.find(({ version }) => version === BAKED_RELEASE_VERSION);
  assert.deepEqual(bakedRelease.files["LICENSES.md"], metadataRelease.files["LICENSES.md"]);
  assert.deepEqual(bakedRelease.files["preview.webp"], await fileRecord(join(root, BAKED_RELEASE.runtimeCapturePath, "preview.webp")));
  assert.equal(bakedRelease.files["preview.webp"].sha256, "799adff5172395b48f0a663c5408176bc0f58030b4d5b0b86bc9795a424def62");
  const reviewRelease = manifest.releases.find(({ version }) => version === REVIEW_RELEASE_VERSION);
  assert.equal(reviewRelease.rightsApprovalStatus, REVIEW_RIGHTS_APPROVAL_STATUS);
  assert.equal(reviewRelease.rightsApproved, false);
  assert.deepEqual(reviewRelease.files["preview.webp"], await fileRecord(join(root, REVIEW_RELEASE.reviewPath, "entry.webp")));
  const currentRelease = manifest.releases.find(({ version }) => version === CURRENT_RELEASE_VERSION);
  assert.equal(currentRelease.qualityOutcome, "REWORK_REQUIRED");
  assert.equal(currentRelease.isCurrent, false);
  assert.equal(currentRelease.publicationReady, false);
  assert.equal(currentRelease.files["scene.glb"].sha256, "ae45bdab2aeec5c8c66e7957c13ca769f356d17df86db13660461a9825ca64b9");
});

test("historical Blender evidence and current metadata tooling use distinct validator pins", async () => {
  const [validatorLock, generationLedger, metadataEvidence, buildScript, reproducibilityScript, workflow, readme] = await Promise.all([
    readFile(join(root, "platform-validator.lock"), "utf8"),
    readJson(join(root, "provenance", "generation-ledger.json")),
    readJson(join(root, "provenance", `metadata-release-${METADATA_VERSION}.json`)),
    readFile(join(root, "scripts", "build-candidate.mjs"), "utf8"),
    readFile(join(root, "scripts", "verify-reproducibility.mjs"), "utf8"),
    readFile(join(root, ".github", "workflows", "validate.yml"), "utf8"),
    readFile(join(root, "README.md"), "utf8")
  ]);
  assert.equal(validatorLock.trim(), CURRENT_PLATFORM_COMMIT);
  assert.equal(generationLedger.toolchain.platformValidatorCommit, HISTORICAL_PLATFORM_COMMIT);
  assert.equal(generationLedger.toolchain.blenderBinarySha256, BLENDER_BINARY_SHA256);
  assert.equal(metadataEvidence.platformValidatorCommit, METADATA_PLATFORM_COMMIT);
  assert.doesNotMatch(buildScript, /BLENDER_BIN|spawnSync|review-candidate\.blend/);
  assert.match(reproducibilityScript, /BLENDER_BIN/);
  assert.match(reproducibilityScript, /export_scene\.py/);
  assert.match(reproducibilityScript, /historical-run-1\.glb/);
  assert.match(reproducibilityScript, /historical-run-2\.glb/);
  assert.match(reproducibilityScript, /metadata-run-1/);
  assert.match(reproducibilityScript, /metadata-run-2/);
  assert.match(readme, /BLENDER_BIN=\/path\/to\/blender pnpm verify:reproducibility/);
  assert.doesNotMatch(readme, /\/tmp\/opencode/);
  assert.match(workflow, /sudo apt-get install --yes imagemagick/);
  assert.match(workflow, /pnpm validate:visual/);
  assert.match(workflow, /95e3a2dfedba3bd32ca54fc355eac6b15a11986954ccb02815a07535d0120a25/);
  assert.match(workflow, /blender-4\.5\.12-linux-x64\.tar\.xz/);
  assert.match(workflow, /sha256sum --check --strict/);
  assert.match(workflow, /BLENDER_BIN=.*blender-4\.5\.12-linux-x64\/blender/);
  assert.match(workflow, /pnpm verify:reproducibility/);
  assert.match(workflow, /provenance\/runtime-capture-\*\/\*/);
  assert.match(workflow, /source\/baked-lightmap-\*\.png/);
  assert.match(workflow, /source\/export_baked_release_\*\.py/);
  assert.match(workflow, /source\/releases\/\*\/\*/);
  assert.match(workflow, /provenance\/releases\/\*\/\*/);
  assert.match(workflow, /git ls-tree --name-only "\$BASE_SHA" -- "\$protected_root"/);
  assert.match(workflow, /immutable_diff_failed/);
  assert.match(workflow, /done < "\$changed_paths"/);
  assert.doesNotMatch(workflow, /done < <\(git diff/);
  assert.match(workflow, /source\/review\/\*/);
  assert.match(workflow, /source\/review-candidate-lock\.json/);
  assert.match(workflow, /validate-acceptance-index-prefix\.mjs/);
  assert.doesNotMatch(workflow, /workflow_dispatch/);
  assert.match(workflow, /fetch-depth: 1/);
  assert.match(workflow, /immutable_baseline_sha_required/);
  assert.match(workflow, /if \[\[ -z "\$BASE_SHA" \|\| "\$BASE_SHA" =~ \^0\+\$ \]\]; then[\s\S]{0,120}exit 1/);
  assert.doesNotMatch(workflow, /git rev-parse HEAD\^/);
  assert.match(workflow, /Validate repository, historical evidence, and current release records/);
  assert.match(workflow, /for manifest in assets\/scenes\/\*\/\*\/scene\.json/);
});

test("0.3.0 is an append-only reproducible review release with technical runtime evidence and pending human gates", async () => {
  const [manifest, scene, previousScene, index, lock, visualConfig, visualEvidence, visualStability, generationLedger] = await Promise.all([
    readJson(join(root, "manifest.json")),
    readJson(join(sceneRoot, REVIEW_RELEASE_VERSION, "scene.json")),
    readJson(join(sceneRoot, BAKED_RELEASE_VERSION, "scene.json")),
    readJson(join(root, "source", "release-acceptance-index.json")),
    readJson(join(root, REVIEW_RELEASE.sourceLockPath)),
    readJson(join(root, REVIEW_RELEASE.visualParityConfigPath)),
    readJson(join(root, REVIEW_RELEASE.provenancePath, "visual-parity.json")),
    readJson(join(root, REVIEW_RELEASE.provenancePath, "visual-stability.json")),
    readJson(join(root, REVIEW_RELEASE.provenancePath, "generation-ledger.json"))
  ]);
  const release = manifest.releases.find(({ version }) => version === REVIEW_RELEASE_VERSION);
  assert.equal(release.isCurrent, false);
  assert.equal(release.publicationReady, false);
  assert.equal(release.rightsApprovalStatus, REVIEW_RIGHTS_APPROVAL_STATUS);
  assert.equal(release.rightsApproved, false);
  assert.equal(scene.rights.license, REVIEW_RIGHTS_LICENSE_REF);
  assert.equal(scene.rights.rightsApproved, false);
  assert.deepEqual(scene.rights.clearedFor, []);
  for (const field of ["spawnPoints", "bounds", "anchors", "mediaSurfaces", "renderMode", "renderProfile"]) assert.deepEqual(scene[field], previousScene[field]);
  assert.deepEqual(release.stats, { triangles: 45772, objects: 232, meshes: 232, primitives: 232, materials: 16, textures: 2, animations: 0, scenes: 1 });
  assert.deepEqual(await glbTextureRecords(join(sceneRoot, REVIEW_RELEASE_VERSION, "scene.glb")), [
    { name: "baked-lightmap", mimeType: "image/png", sha256: "99efa06a464e15f04b496b2f21916de4b4e97603fafecb07edca35478a37283b", sizeBytes: 6058088 },
    { name: "panorama-city-park", mimeType: "image/jpeg", sha256: "f974eaeb4d19bdf3ce25b4d2d3f9fe65b9b6c1ac2fc38a74757edbd5a17656d6", sizeBytes: 435189 }
  ]);
  assert.deepEqual(index.releases.map(({ version }) => version), [REVIEW_RELEASE_VERSION, CURRENT_RELEASE_VERSION]);
  assert.equal(index.releases[0].humanVisualAccepted, false);
  assert.equal(lock.status, "review-source-lock");
  assert.equal(lock.humanVisualAccepted, false);
  assert.equal(lock.rightsApproved, false);
  assert.deepEqual(lock.tooling, generationLedger.tooling);
  assert.notDeepEqual(lock.tooling.map(({ path }) => path), await repositoryToolingPaths(root));
  assert.equal(lock.reproducibility.sourceContainer.reauthoringBytesClaimedReproducible, false);
  assert.deepEqual(lock.reviewViews.map(({ id }) => id), REVIEW_RELEASE_VIEWS);
  assert.equal(lock.technicalRuntimeCapture.status, "passed-three-byte-stable-runtime-capture-sets");
  assert.equal(index.releases[0].technicalRuntimeCapture, "passed-three-byte-stable-runtime-capture-sets");
  assert.equal(visualConfig.status, "technical-runtime-capture-passed");
  assert.deepEqual(visualConfig.views.map(({ id }) => id), REVIEW_RELEASE_VIEWS);
  assert.equal(visualConfig.views.every(({ thresholds }) => Number.isFinite(thresholds.phashMax) && Number.isFinite(thresholds.nccMin)), true);
  assert.equal(visualEvidence.status, "technical-runtime-capture-passed");
  assert.equal(visualEvidence.passed, true);
  assert.deepEqual(visualEvidence.captureSets.map(({ id }) => id), REVIEW_RUNTIME_CAPTURE_RUNS);
  assert.equal(visualStability.status, "stable-three-runtime-capture-sets");
  assert.equal(visualStability.comparison.imagesByteIdenticalAcrossRuns, true);
  assert.equal(visualStability.comparison.maximumPairwisePhash, 0);
  assert.equal(visualStability.comparison.minimumPairwiseNcc, 1);
  assert.deepEqual(generationLedger.tooling, lock.tooling);
  assert.equal(generationLedger.derivation.acceptedSourceContainer, "locked-exact-bytes");
  assert.equal(generationLedger.derivation.reauthoringBytesClaimedReproducible, false);
  for (const run of REVIEW_RUNTIME_CAPTURE_RUNS) {
    assert.deepEqual((await readdir(join(root, REVIEW_RELEASE.runtimeCapturePath, run))).sort(), [...REVIEW_RUNTIME_CAPTURE_FILES].sort());
  }
  for (const view of REVIEW_RELEASE_VIEWS) {
    const records = await Promise.all(REVIEW_RUNTIME_CAPTURE_RUNS.map((run) => fileRecord(join(root, REVIEW_RELEASE.runtimeCapturePath, run, `${view}.png`))));
    assert.equal(records.every((record) => record.sha256 === records[0].sha256 && record.sizeBytes === records[0].sizeBytes), true, view);
  }
  assert.equal(visualEvidence.humanVisualAcceptance, "pending-human-acceptance");
  assert.equal(visualEvidence.humanRightsApproval, REVIEW_RIGHTS_APPROVAL_STATUS);
  assert.equal(visualEvidence.publicationReady, false);
});

test("0.4.0 is locked as an exact-byte REWORK_REQUIRED review release", async () => {
  const [manifest, scene, index, lock, inventory, quality, captureIndex, releaseLedger] = await Promise.all([
    readJson(join(root, "manifest.json")),
    readJson(join(sceneRoot, CURRENT_RELEASE_VERSION, "scene.json")),
    readJson(join(root, "source", "release-acceptance-index.json")),
    readJson(join(root, "source", "releases", CURRENT_RELEASE_VERSION, "review-source-lock.json")),
    readJson(join(root, "provenance", "releases", CURRENT_RELEASE_VERSION, "glb-inventory.json")),
    readJson(join(root, "provenance", "releases", CURRENT_RELEASE_VERSION, "quality-disposition.json")),
    readJson(join(root, "provenance", "releases", CURRENT_RELEASE_VERSION, "runtime-capture-index.json")),
    readJson(join(root, "provenance", "releases", CURRENT_RELEASE_VERSION, "release-ledger.json"))
  ]);
  const release = manifest.releases.at(-1);
  assert.equal(release.version, CURRENT_RELEASE_VERSION);
  assert.equal(release.qualityOutcome, "REWORK_REQUIRED");
  assert.equal(release.isCurrent, false);
  assert.equal(release.publicationReady, false);
  assert.equal(scene.glbSha256, release.files["scene.glb"].sha256);
  assert.equal(lock.release.files["scene.glb"].sha256, release.files["scene.glb"].sha256);
  assert.equal(lock.reproducibility.releaseMaterialization.runs, 2);
  assert.equal(inventory.budgets.meshes.actual, 397);
  assert.equal(inventory.budgets.meshes.maximum, 250);
  assert.equal(inventory.budgets.meshes.withinBudget, false);
  assert.equal(inventory.budgets.meshes.blocksPublication, true);
  assert.equal(quality.verdicts.inheritedQualityTarget, "REWORK_REQUIRED");
  assert.equal(quality.unresolvedDefects.every(({ blocksReadyForUserReview }) => blocksReadyForUserReview), true);
  assert.equal(captureIndex.repeatabilityClaim, "not-a-three-run-stability-claim");
  assert.equal(captureIndex.normal.verdict, "functional-checks-passed");
  assert.equal(releaseLedger.gates.meshBudget, "failed-unapproved-exception");
  assert.equal(releaseLedger.gates.staging, "not-published");
  const record = index.releases.at(-1);
  assert.equal(record.version, CURRENT_RELEASE_VERSION);
  assert.equal(record.lockSha256, (await fileRecord(join(root, record.lockPath))).sha256);
  assert.equal(record.releaseLedgerSha256, (await fileRecord(join(root, record.releaseLedgerPath))).sha256);
  assert.equal(record.humanVisualAccepted, false);
  assert.equal(record.rightsApproved, false);
});

test("0.2.0 baked source plumbing is review-only and contains no invented artifact digest", async () => {
  const [metadataScene, exporter, buildScript] = await Promise.all([
    readJson(join(sceneRoot, METADATA_VERSION, "scene.json")),
    readFile(join(root, BAKED_RELEASE.exportScriptPath), "utf8"),
    readFile(join(root, "scripts", "build-baked-release.mjs"), "utf8")
  ]);
  const bakedScene = createBakedReleaseScene(metadataScene);
  assert.equal(bakedScene.version, BAKED_RELEASE_VERSION);
  assert.equal(bakedScene.renderProfile, BAKED_RENDER_PROFILE);
  assert.equal(bakedScene.status, "review");
  assert.equal(bakedScene.acceptanceStatus, "pending-human-acceptance");
  assert.equal(bakedScene.visualAcceptanceStatus, "pending-human-acceptance");
  assert.equal(bakedScene.isCurrent, false);
  assert.equal(bakedScene.publicationReady, false);
  assert.match(exporter, /bpy\.data\.collections\.get\("Runtime"\)/);
  assert.match(exporter, /EXCLUDED_LIGHTMAP_OBJECT = "architecture\.window-glass"/);
  assert.match(exporter, /EXPECTED_BAKED_MATERIAL_COUNT = 15/);
  assert.match(exporter, /DEFAULT_LIGHTMAP_INTENSITY = 4\.0/);
  assert.match(exporter, /material\["vrataOriginalEmissive"\] = original_color/);
  assert.match(exporter, /material\["vrataOriginalEmissiveIntensity"\] = original_intensity/);
  assert.match(exporter, /use_selection=True/);
  assert.doesNotMatch(exporter, /LIGHTMAP_INTENSITIES|tune_unbaked_materials|material\.review-/);
  assert.doesNotMatch(buildScript, /[0-9a-f]{64}/);
  assert.match(buildScript, /fileRecord/);
  assert.match(buildScript, /isCurrent: false/);
  assert.match(buildScript, /publicationReady: false/);
  assert.match(buildScript, /releaseExists && releaseTrackedAtHead/);
  assert.match(buildScript, /immutable_baked_release_drift:/);
  assert.match(buildScript, /pathTrackedInGit\(root, BAKED_RELEASE\.releasePath\)/);
  assert.match(buildScript, /rename\(temporaryReleaseDir, releaseDir\)/);
});

test("0.3.0 exporter structurally rejects external Blend dependencies", async () => {
  const exporter = await readFile(join(root, REVIEW_RELEASE.exportScriptPath), "utf8");
  assert.match(exporter, /len\(bpy\.data\.libraries\) == 0/);
  assert.match(exporter, /bpy\.utils\.blend_paths\(absolute=False, packed=False, local=True\)/);
  assert.match(exporter, /image\.packed_file is not None/);
});

test("0.2.0 provenance binds source, committed runtime evidence, immutable release, and technical parity", async () => {
  const [evidence, manifest, atlasBytes, runtimeReview, historicalContract, sceneDebug, captureSettings, captureBinding] = await Promise.all([
    readJson(join(root, "provenance", `baked-lightmap-${BAKED_RELEASE_VERSION}.json`)),
    readJson(join(root, "manifest.json")),
    readFile(join(root, BAKED_RELEASE.lightmapPath)),
    readJson(join(root, BAKED_RELEASE.runtimeReviewPath)),
    readJson(join(root, "source", "scene-contract.json")),
    readJson(join(root, BAKED_RELEASE.runtimeCapturePath, "scene-debug.json")),
    readJson(join(root, BAKED_RELEASE.runtimeCapturePath, "capture-settings.json")),
    readJson(join(root, BAKED_RELEASE.runtimeCapturePath, "capture-binding.json"))
  ]);
  const release = manifest.releases.find(({ version }) => version === BAKED_RELEASE_VERSION);
  assert.equal(evidence.platformValidatorCommit, BAKED_PLATFORM_COMMIT);
  assert.equal(evidence.renderProfile, BAKED_RENDER_PROFILE);
  assert.equal(evidence.status, "review");
  assert.equal(evidence.acceptanceStatus, "pending-human-acceptance");
  assert.equal(evidence.visualAcceptanceStatus, "pending-human-acceptance");
  assert.equal(evidence.isCurrent, false);
  assert.equal(evidence.publicationReady, false);
  assert.equal(evidence.humanVisualAccepted, false);
  assert.equal(evidence.productionActivation, false);
  assert.deepEqual(await fileRecord(join(root, evidence.source.exporter.path)), {
    sha256: evidence.source.exporter.sha256,
    sizeBytes: evidence.source.exporter.sizeBytes
  });
  assert.deepEqual(await fileRecord(join(root, evidence.source.atlas.path)), {
    sha256: evidence.source.atlas.sha256,
    sizeBytes: evidence.source.atlas.sizeBytes
  });
  assert.deepEqual(await fileRecord(join(root, evidence.source.runtimeReview.path)), {
    sha256: evidence.source.runtimeReview.sha256,
    sizeBytes: evidence.source.runtimeReview.sizeBytes
  });
  assert.deepEqual(pngDimensions(atlasBytes), { width: 2048, height: 2048 });
  assert.equal(Object.hasOwn(historicalContract, "runtimeReview"), false);
  assert.deepEqual(evidence.runtimeReviewAdapter, {
    sourceFovAxis: "horizontal",
    runtimeFovAxis: "vertical",
    aspectRatio: RUNTIME_REVIEW_ASPECT_RATIO,
    formula: "2 * atan(tan(horizontalFov / 2) / aspectRatio)",
    sourceHorizontalFovDegrees: BLENDER_REVIEW_HORIZONTAL_FOV_DEGREES
  });
  assert.deepEqual(runtimeReview.reviewViews.map(({ id }) => id), REVIEW_VIEWS);
  for (const view of runtimeReview.reviewViews) {
    assert.ok(Math.abs(view.fovDegrees - horizontalToVerticalFovDegrees(BLENDER_REVIEW_HORIZONTAL_FOV_DEGREES[view.id])) < 1e-9, view.id);
  }
  assert.equal(evidence.runtimeCapture.path, BAKED_RELEASE.runtimeCapturePath);
  assert.deepEqual(Object.keys(evidence.runtimeCapture.files), RUNTIME_CAPTURE_FILES);
  for (const name of RUNTIME_CAPTURE_FILES) {
    const record = evidence.runtimeCapture.files[name];
    assert.equal(record.path, `${BAKED_RELEASE.runtimeCapturePath}/${name}`);
    assert.deepEqual(await fileRecord(join(root, record.path)), { sha256: record.sha256, sizeBytes: record.sizeBytes });
  }
  for (const view of REVIEW_VIEWS) {
    assert.deepEqual(pngDimensions(await readFile(join(root, BAKED_RELEASE.runtimeCapturePath, `${view}.png`))), { width: 960, height: 540 });
  }
  assert.deepEqual(webpDimensions(await readFile(join(root, BAKED_RELEASE.runtimeCapturePath, "preview.webp"))), { width: 960, height: 540 });
  assert.deepEqual(evidence.runtimeCapture.files["preview.webp"], {
    path: `${BAKED_RELEASE.runtimeCapturePath}/preview.webp`,
    ...release.files["preview.webp"]
  });
  assert.deepEqual(evidence.runtimeCapture.normalization, {
    status: "applied",
    kind: "machine-local-url-replacement",
    fields: { bundleUrl: "local-capture/scene.json", assetUrl: "local-capture/scene.glb" },
    machineLocalUrlsRetained: false
  });
  assert.equal(sceneDebug.bundleUrl, evidence.runtimeCapture.normalization.fields.bundleUrl);
  assert.equal(sceneDebug.assetUrl, evidence.runtimeCapture.normalization.fields.assetUrl);
  assert.deepEqual(captureSettings, { environmentIntensity: 0.35, exposure: 1.2 });
  assert.deepEqual({
    schemaVersion: captureBinding.schemaVersion,
    kind: captureBinding.kind,
    sceneId: captureBinding.sceneId,
    releaseVersion: captureBinding.releaseVersion,
    scope: captureBinding.scope,
    humanVisualAccepted: captureBinding.humanVisualAccepted,
    productionActivation: captureBinding.productionActivation
  }, {
    schemaVersion: 1,
    kind: "local-runtime-capture-attestation",
    sceneId: SCENE_ID,
    releaseVersion: BAKED_RELEASE_VERSION,
    scope: "explicit-local-capture",
    humanVisualAccepted: false,
    productionActivation: false
  });
  for (const [name, path] of [
    ["releaseSceneGlb", `${BAKED_RELEASE.releasePath}/scene.glb`],
    ["releaseSceneJson", `${BAKED_RELEASE.releasePath}/scene.json`],
    ["runtimeReview", BAKED_RELEASE.runtimeReviewPath]
  ]) {
    assert.equal(captureBinding.bindings[name].path, path);
    assert.deepEqual(await fileRecord(join(root, path)), {
      sha256: captureBinding.bindings[name].sha256,
      sizeBytes: captureBinding.bindings[name].sizeBytes
    });
  }
  const commitBinding = captureBinding.bindings.captureImplementationCommit;
  assert.equal(commitBinding.value, BAKED_PLATFORM_COMMIT);
  assert.equal(commitBinding.valueEncoding, "lowercase-hex");
  assert.equal(commitBinding.hashInputEncoding, "utf8");
  assert.equal(commitBinding.sha256, sha256(commitBinding.value));
  assert.equal(commitBinding.sizeBytes, Buffer.byteLength(commitBinding.value, "utf8"));
  assert.deepEqual(captureBinding.localRuntime, {
    assetBytes: { loaded: sceneDebug.assetBytesLoaded, expected: sceneDebug.assetBytesExpected },
    statistics: Object.fromEntries([
      "objectCount",
      "meshCount",
      "materialCount",
      "texturedMaterialCount",
      "lightMappedMaterialCount",
      "geometryCount",
      "triangleEstimate",
      "textureCount"
    ].map((name) => [name, sceneDebug[name]]))
  });
  assert.deepEqual(Object.keys(captureBinding.captureFiles), RUNTIME_CAPTURE_ARTIFACT_FILES);
  for (const name of RUNTIME_CAPTURE_ARTIFACT_FILES) {
    const record = captureBinding.captureFiles[name];
    assert.equal(record.path, `${BAKED_RELEASE.runtimeCapturePath}/${name}`);
    assert.deepEqual(await fileRecord(join(root, record.path)), { sha256: record.sha256, sizeBytes: record.sizeBytes });
    assert.deepEqual(record, evidence.runtimeCapture.files[name]);
  }
  assert.deepEqual(await fileRecord(join(root, BAKED_RELEASE.runtimeCapturePath, "capture-binding.json")), {
    sha256: evidence.runtimeCapture.files["capture-binding.json"].sha256,
    sizeBytes: evidence.runtimeCapture.files["capture-binding.json"].sizeBytes
  });
  assert.deepEqual(evidence.bake, {
    resolution: 2048,
    samples: 128,
    scale: 0.25,
    device: "CUDA",
    lightMapIntensity: 4,
    lightMappedMaterials: 15,
    excludedObject: "architecture.window-glass",
    transport: "emissiveTexture TEXCOORD_1 with baked-pbr-v1 metadata"
  });
  assert.equal(evidence.release.path, BAKED_RELEASE.releasePath);
  assert.deepEqual(evidence.release.files, release.files);
  assert.deepEqual(evidence.release.stats, {
    triangles: 41816,
    objects: 232,
    meshes: 232,
    primitives: 232,
    materials: 16,
    textures: 1,
    animations: 0,
    scenes: 1
  });
  assert.equal(evidence.release.files["scene.glb"].sha256, "b85516333cfcb767640e2ecf830662c8fabb847c1b62007351c3610b0d9331a4");
  assert.deepEqual(evidence.reproducibility, {
    scope: "same-host-same-saved-blend-same-atlas-same-blender-binary-two-run",
    runs: 2,
    result: "byte-identical-glb",
    sha256: evidence.release.files["scene.glb"].sha256
  });
  assert.deepEqual(await glbTextureRecords(join(root, evidence.release.path, "scene.glb")), [{
    name: "baked-lightmap",
    mimeType: "image/png",
    sha256: evidence.source.atlas.sha256,
    sizeBytes: evidence.source.atlas.sizeBytes
  }]);
  assert.deepEqual(evidence.localRuntime, {
    status: "passed",
    state: sceneDebug.state,
    failureReason: sceneDebug.failureReason,
    missingAssets: sceneDebug.missingAssets,
    loadMs: sceneDebug.loadMs,
    renderProfileApplyMs: sceneDebug.renderProfileApplyMs,
    renderProfile: sceneDebug.renderProfile,
    lightMappedMaterialCount: sceneDebug.lightMappedMaterialCount,
    materialCount: sceneDebug.materialCount,
    triangleEstimate: sceneDebug.triangleEstimate,
    darkPixelRatio: sceneDebug.screenshot.darkPixelRatio,
    assetBytesLoaded: sceneDebug.assetBytesLoaded,
    spawnApplied: sceneDebug.spawnApplied
  });
  assert.equal(evidence.visualParity.status, "passed");
  assert.equal(evidence.visualParity.tool, "ImageMagick compare");
  assert.equal(evidence.visualParity.toolVersion, "ImageMagick 6.9.12-98 Q16 x86_64 18038");
  assert.deepEqual(evidence.visualParity.policy, FINAL_TECHNICAL_VISUAL_PARITY_POLICY);
  assert.equal(evidence.visualParity.result, "passed");
  const expectedMetrics = [
    { id: "entry", phash: 9.41377, ncc: 0.685611 },
    { id: "workspace", phash: 17.6007, ncc: 0.758762 },
    { id: "reading", phash: 24.6839, ncc: 0.508701 },
    { id: "diagonal-overview", phash: 120.703, ncc: 0.264875 }
  ];
  const tolerance = FINAL_TECHNICAL_VISUAL_PARITY_POLICY.evidenceMetricTolerance;
  for (const expected of expectedMetrics) {
    const actual = evidence.visualParity.views.find(({ id }) => id === expected.id);
    assert.ok(Math.abs(actual.phash - expected.phash) <= tolerance.phashAbsolute, expected.id);
    assert.ok(Math.abs(actual.ncc - expected.ncc) <= tolerance.nccAbsolute, expected.id);
  }
  const phashTotal = evidence.visualParity.views.reduce((total, { phash }) => total + phash, 0);
  const nccMean = evidence.visualParity.views.reduce((total, { ncc }) => total + ncc, 0) / evidence.visualParity.views.length;
  assert.ok(Math.abs(evidence.visualParity.aggregate.phashTotal - phashTotal) <= tolerance.phashAbsolute * expectedMetrics.length);
  assert.ok(Math.abs(evidence.visualParity.aggregate.nccMean - nccMean) <= tolerance.nccAbsolute);
});

test("visual parity policy uses final technical regression thresholds without changing human gates", async () => {
  assert.equal(FINAL_TECHNICAL_VISUAL_PARITY_POLICY.status, "final-technical-regression-thresholds");
  assert.equal(FINAL_TECHNICAL_VISUAL_PARITY_POLICY.finalThresholds, true);
  assert.equal(FINAL_TECHNICAL_VISUAL_PARITY_POLICY.scope, "technical-regression-only");
  assert.deepEqual(FINAL_TECHNICAL_VISUAL_PARITY_POLICY.evidenceMetricTolerance, {
    scope: "recorded-metric-comparison-only",
    phashAbsolute: 0.001,
    nccAbsolute: 0.000001
  });
  assert.deepEqual(FINAL_TECHNICAL_VISUAL_PARITY_POLICY.views, {
    entry: { phashMax: 14, nccMin: 0.62 },
    workspace: { phashMax: 25, nccMin: 0.68 },
    reading: { phashMax: 32, nccMin: 0.45 },
    "diagonal-overview": { phashMax: 135, nccMin: 0.22 }
  });
  assert.deepEqual(FINAL_TECHNICAL_VISUAL_PARITY_POLICY.aggregate, { phashTotalMax: 195, nccMeanMin: 0.5 });
  const [manifest, evidence] = await Promise.all([
    readJson(join(root, "manifest.json")),
    readJson(join(root, "provenance", `baked-lightmap-${BAKED_RELEASE_VERSION}.json`))
  ]);
  assert.equal(manifest.visualAcceptanceStatus, "pending-human-acceptance");
  assert.equal(manifest.publicationReady, false);
  assert.equal(evidence.humanVisualAccepted, false);
  assert.equal(evidence.productionActivation, false);
});
