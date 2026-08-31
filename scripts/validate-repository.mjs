import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import validator from "gltf-validator";

import {
  BAKED_PLATFORM_COMMIT,
  BAKED_RELEASE,
  BAKED_RELEASE_VERSION,
  BAKED_RENDER_PROFILE,
  BLENDER_REVIEW_HORIZONTAL_FOV_DEGREES,
  BLENDER_BINARY_SHA256,
  BLENDER_BUILD_HASH,
  BLENDER_VERSION,
  HISTORICAL_PLATFORM_COMMIT,
  METADATA_PLATFORM_COMMIT,
  METADATA_RENDER_PROFILE,
  METADATA_VERSION,
  RELEASE_FILES,
  RELEASE_VERSIONS,
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
  assert,
  assertBakedMaterialContract,
  canonicalSha256,
  createBakedReleaseScene,
  createMetadataReleaseScene,
  fileRecord,
  glbStats,
  glbTextureRecords,
  horizontalToVerticalFovDegrees,
  pngDimensions,
  readJson,
  sha256,
  toRuntimePosition,
  webpDimensions,
  yawToward
} from "./lib.mjs";
import { FINAL_TECHNICAL_VISUAL_PARITY_POLICY } from "./visual-parity-config.mjs";

const root = resolve(import.meta.dirname, "..");
const manifestOnly = process.argv.includes("--manifest-only");
const releaseRoot = join(root, "assets", "scenes", SCENE_ID);

const [packageManifest, config, manifest, contract, contractLock, candidateLock, assetLedger, generationLedger, releaseLedger, metadataEvidence, bakedEvidence, runtimeReview, sceneDebug, captureSettings, captureBinding] = await Promise.all([
  readJson(join(root, "package.json")),
  readJson(join(root, "scene-repository.json")),
  readJson(join(root, "manifest.json")),
  readJson(join(root, "source", "scene-contract.json")),
  readJson(join(root, "source", "scene-contract-lock.json")),
  readJson(join(root, "source", "review-candidate-lock.json")),
  readJson(join(root, "provenance", "asset-ledger.json")),
  readJson(join(root, "provenance", "generation-ledger.json")),
  readJson(join(root, "provenance", "release-artifact-ledger.json")),
  readJson(join(root, "provenance", `metadata-release-${METADATA_VERSION}.json`)),
  readJson(join(root, "provenance", `baked-lightmap-${BAKED_RELEASE_VERSION}.json`)),
  readJson(join(root, BAKED_RELEASE.runtimeReviewPath)),
  readJson(join(root, BAKED_RELEASE.runtimeCapturePath, "scene-debug.json")),
  readJson(join(root, BAKED_RELEASE.runtimeCapturePath, "capture-settings.json")),
  readJson(join(root, BAKED_RELEASE.runtimeCapturePath, "capture-binding.json"))
]);
const validatorLock = (await readFile(join(root, "platform-validator.lock"), "utf8")).trim();
const releases = new Map(manifest.releases?.map((release) => [release.version, release]));
const manifestVersions = manifest.releases.map(({ version }) => version);
const scenes = new Map(await Promise.all(manifestVersions.map(async (version) => [version, await readJson(join(releaseRoot, version, "scene.json"))])));

function assertReviewState(value, code, requireCurrentState = false) {
  assert(value.status === "review" && value.acceptanceStatus === "pending-human-acceptance" && value.visualAcceptanceStatus === "pending-human-acceptance", code);
  assert(value.rightsApprovalStatus === RIGHTS_APPROVAL_STATUS && value.rightsApproved === true && value.publicationReady === false, code);
  if (requireCurrentState) assert(value.isCurrent === false, code);
}

function assertRecord(actual, expected, code) {
  assert(actual?.sha256 === expected?.sha256 && actual?.sizeBytes === expected?.sizeBytes, code);
}

assert(packageManifest.version === VERSION && config.releaseVersion === VERSION, "current_release_version_mismatch");
assert(config.oneSceneOnly === true && config.sceneId === SCENE_ID && config.repository === `vrata-labs/${SCENE_ID}`, "invalid_repository_identity");
assert(config.releaseStatus === "review" && config.acceptanceStatus === "pending-human-acceptance" && config.visualAcceptanceStatus === "pending-human-acceptance", "invalid_repository_gate_state");
assert(config.rightsApprovalStatus === RIGHTS_APPROVAL_STATUS && config.rightsApproved === true && config.publicationReady === false, "invalid_repository_gate_state");
assert(validatorLock === BAKED_PLATFORM_COMMIT && config.platformValidatorCommit === BAKED_PLATFORM_COMMIT, "platform_validator_lock_mismatch");
assert(/^[0-9a-f]{40}$/.test(validatorLock), "invalid_platform_validator_sha");
assert(manifest.sceneId === SCENE_ID && manifest.platformValidatorCommit === BAKED_PLATFORM_COMMIT, "invalid_root_manifest_identity");
assert(manifest.blenderVersion === BLENDER_VERSION && manifest.blenderBuildHash === BLENDER_BUILD_HASH, "invalid_blender_lock");
assertReviewState(manifest, "invalid_manifest_review_state");
assert(JSON.stringify(manifestVersions) === JSON.stringify(RELEASE_VERSIONS), "invalid_release_set");
assert(JSON.stringify((await readdir(releaseRoot)).sort()) === JSON.stringify([...manifestVersions].sort()), "invalid_release_directories");

for (const version of manifestVersions) {
  const release = releases.get(version);
  const releaseDir = join(releaseRoot, version);
  const scene = scenes.get(version);
  assert(release?.releasePath === `assets/scenes/${SCENE_ID}/${version}`, `invalid_release_path:${version}`);
  assertReviewState(release, `invalid_release_state:${version}`, true);
  const entries = (await readdir(releaseDir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  assert(JSON.stringify(entries) === JSON.stringify(RELEASE_FILES), `invalid_release_files:${version}:${entries.join(",")}`);
  for (const name of RELEASE_FILES) assertRecord(await fileRecord(join(releaseDir, name)), release.files[name], `release_file_hash_or_size_drift:${version}:${name}`);

  assert(scene.schemaVersion === 1 && scene.sceneId === SCENE_ID && scene.version === version, `invalid_scene_manifest_identity:${version}`);
  assertReviewState(scene, `invalid_scene_review_state:${version}`);
  assert(scene.rights.license === RIGHTS_LICENSE_REF && scene.rights.approvalStatus === RIGHTS_APPROVAL_STATUS && scene.rights.rightsApproved === true, `invalid_scene_rights_verdict:${version}`);
  assert(scene.rights.approvedOn === RIGHTS_APPROVED_ON && scene.rights.approvedBy === "human-rights-owner", `invalid_scene_rights_verdict:${version}`);
  assert(JSON.stringify(scene.rights.clearedFor) === JSON.stringify(RIGHTS_ALLOWED_USES), `invalid_scene_rights_scope:${version}`);
  assert(scene.glbPath === "scene.glb" && scene.preview === "preview.webp" && scene.renderMode === "clean", `invalid_scene_asset_contract:${version}`);
  assert(!/(^|["'])(\/|[A-Za-z]:[\\/]|\.\.)/.test(JSON.stringify(scene)), `private_or_unsafe_scene_path:${version}`);
  assert(scene.spawnPoints.length === 1 && scene.spawnPoints[0].id === "main", `invalid_main_spawn:${version}`);

  const releaseLicense = await readFile(join(releaseDir, "LICENSES.md"), "utf8");
  assert(releaseLicense.includes(RIGHTS_LICENSE_REF) && releaseLicense.includes(RIGHTS_APPROVAL_STATUS) && releaseLicense.includes(RIGHTS_APPROVED_ON), `incomplete_rights_license_record:${version}`);
  assert(releaseLicense.includes("does not grant human visual acceptance") && releaseLicense.includes("production") && releaseLicense.includes("publicationReady=false"), `missing_rights_license_limits:${version}`);
}

const sourceScene = scenes.get(SOURCE_VERSION);
const metadataScene = scenes.get(METADATA_VERSION);
assert(contract.version === SOURCE_VERSION && candidateLock.version === SOURCE_VERSION, "historical_authoring_version_drift");
assert(candidateLock.release.path === `assets/scenes/${SCENE_ID}/${SOURCE_VERSION}`, "historical_release_lock_path_drift");
for (const name of RELEASE_FILES) {
  assertRecord(releases.get(SOURCE_VERSION).files[name], candidateLock.release.files[name], `immutable_historical_release_drift:${name}`);
}
assert(!("renderProfile" in sourceScene) && !("yaw" in sourceScene.spawnPoints[0]), "historical_scene_metadata_mutated");
assert(JSON.stringify(metadataScene) === JSON.stringify(createMetadataReleaseScene(sourceScene)), "metadata_only_scene_manifest_drift");
assert(metadataScene.renderProfile === METADATA_RENDER_PROFILE, "invalid_render_profile");
assert(metadataScene.spawnPoints[0].yaw === SPAWN_YAW, "invalid_spawn_yaw");
assert(metadataScene.isCurrent === false, "metadata_release_must_not_be_current");
assert(SPAWN_YAW === yawToward(metadataScene.spawnPoints[0].position, metadataScene.mediaSurfaces[0].transform), "spawn_yaw_formula_drift");
assert(JSON.stringify(metadataScene.rights) === JSON.stringify(sourceScene.rights), "metadata_release_rights_drift");
for (const name of SHARED_RELEASE_FILES) {
  assertRecord(releases.get(METADATA_VERSION).files[name], releases.get(SOURCE_VERSION).files[name], `shared_release_file_drift:${name}`);
}
assert(releases.get(METADATA_VERSION).files["scene.json"].sha256 !== releases.get(SOURCE_VERSION).files["scene.json"].sha256, "metadata_manifest_hash_must_change");

assert(JSON.stringify(sourceScene.spawnPoints[0].position) === JSON.stringify(toRuntimePosition(contract.spawn.position)), "spawn_coordinate_adapter_drift");
assert(sourceScene.anchors.seatAnchors.length === 1 && sourceScene.anchors.seatAnchors[0].id === "owner-desk-seat", "invalid_owner_seat_contract");
assert(JSON.stringify(sourceScene.anchors.seatAnchors[0].position) === JSON.stringify(toRuntimePosition(contract.seats[0].position)), "seat_coordinate_adapter_drift");
assert(contract.mediaSurfaces.length === 1, "invalid_canonical_workspace_surface_count");
const contractSurface = contract.mediaSurfaces[0];
const legacySurfaceKeys = ["allowedObjectTypes", "heightM", "heightPx", "kind", "label", "surfaceId", "transform", "visible", "widthM", "widthPx"];
assert(JSON.stringify(Object.keys(contractSurface).sort()) === JSON.stringify(legacySurfaceKeys), "invalid_canonical_workspace_surface_shape");
const expectedRuntimeSurface = {
  surfaceId: contractSurface.surfaceId,
  label: contractSurface.label,
  kind: contractSurface.kind,
  widthM: contractSurface.widthM,
  heightM: contractSurface.heightM,
  widthPx: contractSurface.widthPx,
  heightPx: contractSurface.heightPx,
  transform: { ...toRuntimePosition(contractSurface.transform), yaw: contractSurface.transform.yaw, pitch: contractSurface.transform.pitch, roll: contractSurface.transform.roll },
  visible: contractSurface.visible,
  allowedObjectTypes: contractSurface.allowedObjectTypes
};
assert(JSON.stringify(sourceScene.mediaSurfaces) === JSON.stringify([expectedRuntimeSurface]), "invalid_workspace_surface_contract");
assert(!["input", "representation", "position", "pixelDimensions", "frontFace"].some((key) => key in sourceScene.mediaSurfaces[0]), "f3_workspace_surface_fields_forbidden");
assert(contract.visualDirection.audienceLayout === false && contract.seats.length <= 1, "shared_audience_layout_forbidden");

assert(contractLock.platformValidatorCommit === HISTORICAL_PLATFORM_COMMIT, "historical_contract_platform_validator_drift");
assert(contractLock.contractCanonicalSha256 === canonicalSha256(contract), "canonical_contract_hash_drift");
assertRecord(await fileRecord(join(root, "source", "scene-contract.json")), { sha256: contractLock.contractFileSha256, sizeBytes: (await fileRecord(join(root, "source", "scene-contract.json"))).sizeBytes }, "contract_file_hash_drift");
assert(contractLock.coordinateAdapter === "x=x,y=y,z=-z" && contractLock.status === "review" && contractLock.acceptanceStatus === "pending-human-acceptance", "contract_lock_drift");
assert(contract.boundaries.humanVisualAccepted === false && contract.boundaries.humanRightsAccepted === true && contract.boundaries.rightsApprovalStatus === RIGHTS_APPROVAL_STATUS, "invalid_contract_boundaries");
assert(contract.boundaries.rightsApprovedOn === RIGHTS_APPROVED_ON && contract.boundaries.publicStagingRightsApproved === true && contract.boundaries.publicationReady === false, "invalid_contract_boundaries");
assert(candidateLock.status === "pending-human-acceptance" && candidateLock.release.status === "review" && candidateLock.release.publicationReady === false, "invalid_candidate_lock_state");
assert(candidateLock.humanGates.visual === "pending-human-acceptance" && candidateLock.humanGates.rights === RIGHTS_APPROVAL_STATUS && candidateLock.humanGates.rightsApproved === true, "invalid_candidate_human_gates");

assert(releaseLedger.releaseVersion === SOURCE_VERSION, "invalid_historical_release_ledger_identity");
assert(releaseLedger.releaseStatus === "review" && releaseLedger.visualAcceptanceStatus === "pending-human-acceptance" && releaseLedger.publicationReady === false, "invalid_release_ledger_gate_state");
for (const name of RELEASE_FILES) assertRecord(releaseLedger.files[name], releases.get(SOURCE_VERSION).files[name], `historical_release_ledger_file_drift:${name}`);
assert(releaseLedger.rights.decision === RIGHTS_APPROVAL_STATUS && releaseLedger.rights.productionActivation === false && releaseLedger.rights.humanVisualAccepted === false && releaseLedger.rights.publicationReady === false, "invalid_release_rights_verdict");
assert(JSON.stringify(releaseLedger.rights.allowedUses) === JSON.stringify(RIGHTS_ALLOWED_USES), "invalid_release_rights_scope");

assert(generationLedger.toolchain.platformValidatorCommit === HISTORICAL_PLATFORM_COMMIT, "historical_generation_platform_validator_drift");
assert(generationLedger.toolchain.blenderVersion === `Blender ${BLENDER_VERSION}` && generationLedger.toolchain.blenderBuildHash === BLENDER_BUILD_HASH, "historical_generation_blender_drift");
assert(generationLedger.toolchain.blenderBinarySha256 === BLENDER_BINARY_SHA256, "historical_generation_blender_binary_drift");
assertRecord(generationLedger.outputs.releaseGlb, releases.get(SOURCE_VERSION).files["scene.glb"], "historical_generation_output_drift");
assert(generationLedger.reproducibility.sha256 === releases.get(SOURCE_VERSION).files["scene.glb"].sha256, "historical_reproducibility_drift");
assert(generationLedger.humanAcceptance === "pending-human-acceptance" && generationLedger.rightsApproval.productionActivation === false && generationLedger.rightsApproval.publicationReady === false, "invalid_generation_rights_state");

assert(metadataEvidence.kind === "metadata-only-review-release" && metadataEvidence.platformValidatorCommit === METADATA_PLATFORM_COMMIT, "invalid_metadata_evidence_identity");
assert(metadataEvidence.baseVersion === SOURCE_VERSION && metadataEvidence.targetVersion === METADATA_VERSION, "invalid_metadata_evidence_versions");
assert(metadataEvidence.renderProfile === METADATA_RENDER_PROFILE && metadataEvidence.spawnYaw === SPAWN_YAW, "invalid_metadata_evidence_values");
assertReviewState(metadataEvidence, "invalid_metadata_evidence_review_state", true);
assert(metadataEvidence.humanVisualAccepted === false && metadataEvidence.productionActivation === false, "invalid_metadata_evidence_gates");
for (const name of SHARED_RELEASE_FILES) {
  assertRecord(metadataEvidence.sharedFiles[name], releases.get(SOURCE_VERSION).files[name], `metadata_evidence_shared_file_drift:${name}`);
  assertRecord(metadataEvidence.sharedFiles[name], releases.get(METADATA_VERSION).files[name], `metadata_evidence_release_file_drift:${name}`);
}
assertRecord(metadataEvidence.sceneJson, releases.get(METADATA_VERSION).files["scene.json"], "metadata_evidence_scene_json_drift");

const bakedScene = scenes.get(BAKED_RELEASE_VERSION);
const bakedRelease = releases.get(BAKED_RELEASE_VERSION);
assert(JSON.stringify(bakedScene) === JSON.stringify(createBakedReleaseScene(metadataScene)), "baked_scene_manifest_drift");
assert(bakedScene.renderProfile === BAKED_RENDER_PROFILE, "invalid_baked_render_profile");
assert(releases.get(BAKED_RELEASE_VERSION).releasePath === BAKED_RELEASE.releasePath, "invalid_baked_release_path");
assertRecord(bakedRelease.files["LICENSES.md"], releases.get(METADATA_VERSION).files["LICENSES.md"], "baked_shared_file_drift:LICENSES.md");

assert(bakedEvidence.schemaVersion === 1
  && bakedEvidence.kind === "baked-lightmap-review-release"
  && bakedEvidence.sceneId === SCENE_ID
  && bakedEvidence.releaseVersion === BAKED_RELEASE_VERSION
  && bakedEvidence.platformValidatorCommit === BAKED_PLATFORM_COMMIT
  && bakedEvidence.renderProfile === BAKED_RENDER_PROFILE, "invalid_baked_evidence_identity");
assertReviewState(bakedEvidence, "invalid_baked_evidence_review_state", true);
assert(bakedEvidence.humanVisualAccepted === false && bakedEvidence.productionActivation === false, "invalid_baked_evidence_gates");
assert(bakedEvidence.source?.exporter?.path === BAKED_RELEASE.exportScriptPath
  && bakedEvidence.source?.atlas?.path === BAKED_RELEASE.lightmapPath
  && bakedEvidence.source?.runtimeReview?.path === BAKED_RELEASE.runtimeReviewPath, "invalid_baked_evidence_source_paths");
assertRecord(await fileRecord(join(root, BAKED_RELEASE.exportScriptPath)), bakedEvidence.source.exporter, "baked_exporter_record_drift");
const atlasBytes = await readFile(join(root, BAKED_RELEASE.lightmapPath));
assertRecord(await fileRecord(join(root, BAKED_RELEASE.lightmapPath)), bakedEvidence.source.atlas, "baked_atlas_record_drift");
assertRecord(await fileRecord(join(root, BAKED_RELEASE.runtimeReviewPath)), bakedEvidence.source.runtimeReview, "runtime_review_source_record_drift");
assert(JSON.stringify(pngDimensions(atlasBytes)) === JSON.stringify({ width: 2048, height: 2048 }), "invalid_baked_atlas_dimensions");
assert(JSON.stringify(bakedEvidence.runtimeReviewAdapter) === JSON.stringify({
  sourceFovAxis: "horizontal",
  runtimeFovAxis: "vertical",
  aspectRatio: RUNTIME_REVIEW_ASPECT_RATIO,
  formula: "2 * atan(tan(horizontalFov / 2) / aspectRatio)",
  sourceHorizontalFovDegrees: BLENDER_REVIEW_HORIZONTAL_FOV_DEGREES
}), "invalid_runtime_review_adapter");
assert(JSON.stringify(Object.keys(runtimeReview)) === JSON.stringify(["reviewViews"])
  && JSON.stringify(runtimeReview.reviewViews?.map(({ id }) => id)) === JSON.stringify(REVIEW_VIEWS), "invalid_runtime_review_config_shape");
for (const view of runtimeReview.reviewViews) {
  assert(view.position && view.target
    && [...Object.values(view.position), ...Object.values(view.target)].every(Number.isFinite), `invalid_runtime_review_view:${view.id}`);
  const expectedFov = horizontalToVerticalFovDegrees(BLENDER_REVIEW_HORIZONTAL_FOV_DEGREES[view.id]);
  assert(Math.abs(view.fovDegrees - expectedFov) < 1e-9, `runtime_review_vertical_fov_drift:${view.id}`);
}
assert(bakedEvidence.runtimeCapture?.path === BAKED_RELEASE.runtimeCapturePath, "invalid_runtime_capture_evidence_path");
assert(JSON.stringify(Object.keys(bakedEvidence.runtimeCapture.files)) === JSON.stringify(RUNTIME_CAPTURE_FILES), "invalid_runtime_capture_file_set");
for (const name of RUNTIME_CAPTURE_FILES) {
  const evidenceFile = bakedEvidence.runtimeCapture.files[name];
  const expectedPath = `${BAKED_RELEASE.runtimeCapturePath}/${name}`;
  assert(evidenceFile.path === expectedPath, `runtime_capture_evidence_path_drift:${name}`);
  assertRecord(await fileRecord(join(root, expectedPath)), evidenceFile, `runtime_capture_evidence_record_drift:${name}`);
}
for (const view of REVIEW_VIEWS) {
  const bytes = await readFile(join(root, BAKED_RELEASE.runtimeCapturePath, `${view}.png`));
  assert(JSON.stringify(pngDimensions(bytes)) === JSON.stringify({ width: 960, height: 540 }), `invalid_runtime_capture_dimensions:${view}`);
}
const capturePreviewBytes = await readFile(join(root, BAKED_RELEASE.runtimeCapturePath, "preview.webp"));
assert(JSON.stringify(webpDimensions(capturePreviewBytes)) === JSON.stringify({ width: 960, height: 540 }), "invalid_runtime_capture_preview_dimensions");
assert(JSON.stringify(bakedEvidence.runtimeCapture.normalization) === JSON.stringify({
  status: "applied",
  kind: "machine-local-url-replacement",
  fields: {
    bundleUrl: "local-capture/scene.json",
    assetUrl: "local-capture/scene.glb"
  },
  machineLocalUrlsRetained: false
}), "invalid_runtime_capture_normalization");
assert(sceneDebug.bundleUrl === bakedEvidence.runtimeCapture.normalization.fields.bundleUrl
  && sceneDebug.assetUrl === bakedEvidence.runtimeCapture.normalization.fields.assetUrl, "runtime_capture_normalized_url_drift");
assert(JSON.stringify(captureSettings) === JSON.stringify({ environmentIntensity: 0.35, exposure: 1.2 }), "runtime_capture_settings_drift");
assert(captureBinding.schemaVersion === 1
  && captureBinding.kind === "local-runtime-capture-attestation"
  && captureBinding.sceneId === SCENE_ID
  && captureBinding.releaseVersion === BAKED_RELEASE_VERSION
  && captureBinding.scope === "explicit-local-capture"
  && captureBinding.humanVisualAccepted === false
  && captureBinding.productionActivation === false, "invalid_capture_binding_identity");
const bindingInputs = [
  ["releaseSceneGlb", `${BAKED_RELEASE.releasePath}/scene.glb`],
  ["releaseSceneJson", `${BAKED_RELEASE.releasePath}/scene.json`],
  ["runtimeReview", BAKED_RELEASE.runtimeReviewPath]
];
for (const [name, path] of bindingInputs) {
  const binding = captureBinding.bindings?.[name];
  assert(binding?.path === path, `capture_binding_path_drift:${name}`);
  assertRecord(await fileRecord(join(root, path)), binding, `capture_binding_record_drift:${name}`);
}
const implementationBinding = captureBinding.bindings?.captureImplementationCommit;
assert(implementationBinding?.value === BAKED_PLATFORM_COMMIT
  && implementationBinding.valueEncoding === "lowercase-hex"
  && implementationBinding.hashInputEncoding === "utf8"
  && implementationBinding.sha256 === sha256(implementationBinding.value)
  && implementationBinding.sizeBytes === Buffer.byteLength(implementationBinding.value, "utf8"), "capture_implementation_binding_drift");
const runtimeStatistics = Object.fromEntries([
  "objectCount",
  "meshCount",
  "materialCount",
  "texturedMaterialCount",
  "lightMappedMaterialCount",
  "geometryCount",
  "triangleEstimate",
  "textureCount"
].map((name) => [name, sceneDebug[name]]));
assert(JSON.stringify(captureBinding.localRuntime) === JSON.stringify({
  assetBytes: { loaded: sceneDebug.assetBytesLoaded, expected: sceneDebug.assetBytesExpected },
  statistics: runtimeStatistics
}), "capture_binding_local_runtime_drift");
assert(captureBinding.localRuntime.assetBytes.loaded === bakedRelease.files["scene.glb"].sizeBytes
  && captureBinding.localRuntime.assetBytes.expected === bakedRelease.files["scene.glb"].sizeBytes
  && captureBinding.localRuntime.statistics.meshCount === bakedRelease.stats.meshes
  && captureBinding.localRuntime.statistics.materialCount === bakedRelease.stats.materials
  && captureBinding.localRuntime.statistics.triangleEstimate === bakedRelease.stats.triangles, "capture_binding_release_statistics_drift");
assert(JSON.stringify(Object.keys(captureBinding.captureFiles)) === JSON.stringify(RUNTIME_CAPTURE_ARTIFACT_FILES), "capture_binding_file_set_drift");
for (const name of RUNTIME_CAPTURE_ARTIFACT_FILES) {
  const binding = captureBinding.captureFiles[name];
  const path = `${BAKED_RELEASE.runtimeCapturePath}/${name}`;
  assert(binding?.path === path, `capture_binding_file_path_drift:${name}`);
  assertRecord(await fileRecord(join(root, path)), binding, `capture_binding_file_record_drift:${name}`);
  assertRecord(binding, bakedEvidence.runtimeCapture.files[name], `capture_binding_evidence_record_drift:${name}`);
}
assert(JSON.stringify(bakedEvidence.toolchain) === JSON.stringify({
  blenderVersion: BLENDER_VERSION,
  blenderBuildHash: BLENDER_BUILD_HASH,
  blenderBinarySha256: BLENDER_BINARY_SHA256
}), "invalid_baked_evidence_toolchain");
assert(JSON.stringify(bakedEvidence.bake) === JSON.stringify({
  resolution: 2048,
  samples: 128,
  scale: 0.25,
  device: "CUDA",
  lightMapIntensity: 4,
  lightMappedMaterials: 15,
  excludedObject: "architecture.window-glass",
  transport: "emissiveTexture TEXCOORD_1 with baked-pbr-v1 metadata"
}), "invalid_baked_evidence_settings");
assert(bakedEvidence.release?.path === BAKED_RELEASE.releasePath, "invalid_baked_evidence_release_path");
for (const name of RELEASE_FILES) assertRecord(bakedEvidence.release.files[name], bakedRelease.files[name], `baked_evidence_release_record_drift:${name}`);
assert(JSON.stringify(bakedEvidence.release.stats) === JSON.stringify(bakedRelease.stats), "baked_evidence_stats_drift");
assert(JSON.stringify(bakedEvidence.reproducibility) === JSON.stringify({
  scope: "same-host-same-saved-blend-same-atlas-same-blender-binary-two-run",
  runs: 2,
  result: "byte-identical-glb",
  sha256: bakedRelease.files["scene.glb"].sha256
}), "invalid_baked_reproducibility_evidence");
const runtimeEvidenceFromDebug = {
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
  darkPixelRatio: sceneDebug.screenshot?.darkPixelRatio,
  assetBytesLoaded: sceneDebug.assetBytesLoaded,
  spawnApplied: sceneDebug.spawnApplied
};
assert(JSON.stringify(bakedEvidence.localRuntime) === JSON.stringify(runtimeEvidenceFromDebug), "invalid_local_runtime_evidence");
assert(sceneDebug.state === "loaded"
  && sceneDebug.failureReason === null
  && sceneDebug.missingAssets.length === 0
  && sceneDebug.renderProfile === BAKED_RENDER_PROFILE
  && sceneDebug.lightMappedMaterialCount === 15
  && sceneDebug.materialCount === bakedRelease.stats.materials
  && sceneDebug.triangleEstimate === bakedRelease.stats.triangles
  && sceneDebug.assetBytesLoaded === bakedRelease.files["scene.glb"].sizeBytes
  && sceneDebug.spawnApplied === true, "runtime_capture_diagnostics_failed");
const expectedVisualViews = [
  { id: "entry", phash: 9.41377, ncc: 0.685611 },
  { id: "workspace", phash: 17.6007, ncc: 0.758762 },
  { id: "reading", phash: 24.6839, ncc: 0.508701 },
  { id: "diagonal-overview", phash: 120.703, ncc: 0.264875 }
];
const evidenceTolerance = FINAL_TECHNICAL_VISUAL_PARITY_POLICY.evidenceMetricTolerance;
const withinTolerance = (actual, expected, tolerance) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
assert(bakedEvidence.visualParity.status === "passed"
  && bakedEvidence.visualParity.tool === "ImageMagick compare"
  && /^ImageMagick\s+\S+/.test(bakedEvidence.visualParity.toolVersion)
  && JSON.stringify(bakedEvidence.visualParity.policy) === JSON.stringify(FINAL_TECHNICAL_VISUAL_PARITY_POLICY)
  && bakedEvidence.visualParity.result === "passed"
  && bakedEvidence.visualParity.views.length === expectedVisualViews.length, "invalid_visual_parity_evidence");
for (const { id, phash, ncc } of expectedVisualViews) {
  const recorded = bakedEvidence.visualParity.views.find((view) => view.id === id);
  assert(withinTolerance(recorded?.phash, phash, evidenceTolerance.phashAbsolute)
    && withinTolerance(recorded?.ncc, ncc, evidenceTolerance.nccAbsolute), `visual_evidence_metric_drift:${id}`);
  const threshold = FINAL_TECHNICAL_VISUAL_PARITY_POLICY.views[id];
  assert(recorded.phash <= threshold.phashMax && recorded.ncc >= threshold.nccMin, `visual_view_threshold_failed:${id}`);
}
const phashTotal = bakedEvidence.visualParity.views.reduce((total, { phash }) => total + phash, 0);
const nccMean = bakedEvidence.visualParity.views.reduce((total, { ncc }) => total + ncc, 0) / bakedEvidence.visualParity.views.length;
assert(withinTolerance(bakedEvidence.visualParity.aggregate.phashTotal, phashTotal, evidenceTolerance.phashAbsolute * expectedVisualViews.length)
  && withinTolerance(bakedEvidence.visualParity.aggregate.nccMean, nccMean, evidenceTolerance.nccAbsolute)
  && phashTotal <= FINAL_TECHNICAL_VISUAL_PARITY_POLICY.aggregate.phashTotalMax
  && nccMean >= FINAL_TECHNICAL_VISUAL_PARITY_POLICY.aggregate.nccMeanMin, "visual_aggregate_threshold_failed");

assert(assetLedger.rightsVerdict.decision === RIGHTS_APPROVAL_STATUS && assetLedger.rightsVerdict.rightsApproved === true && assetLedger.rightsVerdict.approvedOn === RIGHTS_APPROVED_ON, "invalid_asset_rights_verdict");
assert(assetLedger.records.every((record) => record.approvalStatus === RIGHTS_APPROVAL_STATUS && record.licenseRef === assetLedger.rightsVerdict.licenseRef), "invalid_asset_record_rights");
const provenanceLicense = await readFile(join(root, "provenance", "licenses", "project-authored-public-staging-review.txt"), "utf8");
assert(provenanceLicense.includes(RIGHTS_LICENSE_REF) && provenanceLicense.includes(RIGHTS_APPROVAL_STATUS) && provenanceLicense.includes(RIGHTS_APPROVED_ON), "incomplete_provenance_license_record");

for (const view of REVIEW_VIEWS) {
  const path = join(root, "source", "review", `${view}.webp`);
  const actual = await fileRecord(path);
  const locked = candidateLock.reviewViews.find(({ id }) => id === view);
  assertRecord(actual, locked, `review_view_drift:${view}`);
  const dimensions = webpDimensions(await readFile(path));
  assert(dimensions.width === 960 && dimensions.height === 540, `invalid_review_dimensions:${view}:${dimensions.width}x${dimensions.height}`);
}
for (const version of [SOURCE_VERSION, METADATA_VERSION]) {
  assertRecord(await fileRecord(join(releaseRoot, version, "preview.webp")), await fileRecord(join(root, "source", "review", "entry.webp")), `preview_must_equal_entry_view:${version}`);
}
assertRecord(await fileRecord(join(releaseRoot, BAKED_RELEASE_VERSION, "preview.webp")), await fileRecord(join(root, BAKED_RELEASE.runtimeCapturePath, "preview.webp")), "baked_preview_must_equal_runtime_capture");

if (!manifestOnly) {
  for (const version of manifestVersions) {
    const release = releases.get(version);
    const glbPath = join(releaseRoot, version, "scene.glb");
    const glbBytes = await readFile(glbPath);
    const report = await validator.validateBytes(new Uint8Array(glbBytes), { uri: `${SCENE_ID}@${version}/scene.glb`, maxIssues: 200 });
    assert(report.issues.numErrors === 0, `khronos_gltf_validation_errors:${version}:${report.issues.numErrors}`);
    const stats = await glbStats(glbPath);
    assert(JSON.stringify(stats) === JSON.stringify(release.stats), `release_stats_drift:${version}`);
    assert(stats.scenes === 1, `one_gltf_scene_required:${version}:${stats.scenes}`);
    assert(glbBytes.length <= contract.budgets.glbBytesMax, `glb_budget_exceeded:${version}:${glbBytes.length}`);
    assert(stats.triangles <= contract.budgets.trianglesMax, `triangle_budget_exceeded:${version}:${stats.triangles}`);
    assert(stats.objects <= contract.budgets.objectsMax, `object_budget_exceeded:${version}:${stats.objects}`);
    assert(stats.meshes <= contract.budgets.meshesMax, `mesh_budget_exceeded:${version}:${stats.meshes}`);
    assert(stats.materials <= contract.budgets.materialsMax, `material_budget_exceeded:${version}:${stats.materials}`);
    assert(stats.textures <= contract.budgets.texturesMax, `texture_budget_exceeded:${version}:${stats.textures}`);
    if (version === BAKED_RELEASE_VERSION) {
      await assertBakedMaterialContract(glbPath);
      const textures = await glbTextureRecords(glbPath);
      assert(textures.length === 1
        && textures[0].mimeType === "image/png"
        && textures[0].sha256 === bakedEvidence.source.atlas.sha256
        && textures[0].sizeBytes === bakedEvidence.source.atlas.sizeBytes, "embedded_baked_atlas_drift");
    }
  }
}

process.stdout.write(`Scene repository is valid (${manifestVersions.join(", ")} ${manifestOnly ? "manifest" : "full"} review check; target ${VERSION}).\n`);
