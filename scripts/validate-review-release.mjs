import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import validator from "gltf-validator";

import {
  BAKED_PLATFORM_COMMIT,
  BAKED_RENDER_PROFILE,
  BLENDER_BINARY_SHA256,
  BLENDER_BUILD_HASH,
  BLENDER_VERSION,
  RELEASE_FILES,
  REVIEW_RELEASE,
  REVIEW_RELEASE_VERSION,
  REVIEW_RELEASE_VIEWS,
  REVIEW_RIGHTS_APPROVAL_STATUS,
  REVIEW_RIGHTS_LICENSE_REF,
  REVIEW_RUNTIME_CAPTURE_FILES,
  REVIEW_RUNTIME_CAPTURE_RUNS,
  SCENE_ID,
  assert,
  assertReviewReleaseMaterialContract,
  fileRecord,
  glbStats,
  glbTextureRecords,
  horizontalToVerticalFovDegrees,
  jpegDimensions,
  pngDimensions,
  readJson,
  webpDimensions
} from "./lib.mjs";
import { CURRENT_PLATFORM_COMMIT, CURRENT_RELEASE_VERSION } from "./release-0.4.0.mjs";

const root = resolve(import.meta.dirname, "..");
const releaseDir = join(root, REVIEW_RELEASE.releasePath);
const glbPath = join(releaseDir, "scene.glb");
const expectedProvenanceFiles = [
  "generation-ledger.json",
  "glb-inventory.json",
  "panorama-integrity.json",
  "project-authored-review-release.txt",
  "release-asset-ledger.json",
  "runtime-coordinates.json",
  "scene-reality-report.json",
  "visual-parity.json",
  "visual-stability.json"
];
const requiredTags = [
  "vrataObjectId",
  "vrataPartId",
  "vrataInteractionStatus",
  "vrataBakePolicy",
  "vrataCollisionPolicy",
  "vrataSupportPolicy",
  "vrataNavigableBoundsPolicy"
];

function assertRecord(actual, expected, code) {
  assert(actual?.sha256 === expected?.sha256 && actual?.sizeBytes === expected?.sizeBytes, code);
}

async function assertPathRecord(record, code) {
  assert(record?.path && !record.path.startsWith("/") && !record.path.includes("..") && !record.path.includes("\\"), `${code}:path`);
  assertRecord(await fileRecord(join(root, record.path)), record, code);
}

const [
  packageManifest,
  repository,
  manifest,
  index,
  lock,
  scene,
  previousScene,
  reality,
  scenarios,
  visualConfig,
  inventory,
  panoramaIntegrity,
  runtimeCoordinates,
  realityReport,
  generationLedger,
  assetLedger,
  visualEvidence,
  visualStability,
  panoramaParameters
] = await Promise.all([
  readJson(join(root, "package.json")),
  readJson(join(root, "scene-repository.json")),
  readJson(join(root, "manifest.json")),
  readJson(join(root, "source", "release-acceptance-index.json")),
  readJson(join(root, REVIEW_RELEASE.sourceLockPath)),
  readJson(join(releaseDir, "scene.json")),
  readJson(join(root, "assets", "scenes", SCENE_ID, "0.2.0", "scene.json")),
  readJson(join(root, REVIEW_RELEASE.sceneRealityPath)),
  readJson(join(root, REVIEW_RELEASE.userScenariosPath)),
  readJson(join(root, REVIEW_RELEASE.visualParityConfigPath)),
  readJson(join(root, REVIEW_RELEASE.provenancePath, "glb-inventory.json")),
  readJson(join(root, REVIEW_RELEASE.provenancePath, "panorama-integrity.json")),
  readJson(join(root, REVIEW_RELEASE.provenancePath, "runtime-coordinates.json")),
  readJson(join(root, REVIEW_RELEASE.provenancePath, "scene-reality-report.json")),
  readJson(join(root, REVIEW_RELEASE.provenancePath, "generation-ledger.json")),
  readJson(join(root, REVIEW_RELEASE.provenancePath, "release-asset-ledger.json")),
  readJson(join(root, REVIEW_RELEASE.provenancePath, "visual-parity.json")),
  readJson(join(root, REVIEW_RELEASE.provenancePath, "visual-stability.json")),
  readJson(join(root, REVIEW_RELEASE.panoramaParametersPath))
]);

assert(packageManifest.version === CURRENT_RELEASE_VERSION && repository.releaseVersion === CURRENT_RELEASE_VERSION, "review_release_target_drift");
for (const value of [repository, manifest]) {
  assert(value.rightsApprovalStatus === REVIEW_RIGHTS_APPROVAL_STATUS && value.rightsApproved === false && value.publicationReady === false, "review_root_rights_gate_drift");
}
assert(repository.platformValidatorCommit === CURRENT_PLATFORM_COMMIT && manifest.platformValidatorCommit === CURRENT_PLATFORM_COMMIT, "review_platform_commit_drift");
assert(JSON.stringify((await readdir(releaseDir)).sort()) === JSON.stringify(RELEASE_FILES), "review_release_file_set_drift");
assert(JSON.stringify((await readdir(join(root, REVIEW_RELEASE.provenancePath))).sort()) === JSON.stringify(expectedProvenanceFiles), "review_provenance_file_set_drift");
assert(JSON.stringify((await readdir(join(root, REVIEW_RELEASE.reviewPath))).sort()) === JSON.stringify([...REVIEW_RELEASE_VIEWS].map((id) => `${id}.webp`).sort()), "review_view_file_set_drift");

const release = manifest.releases.find(({ version }) => version === REVIEW_RELEASE_VERSION);
assert(release?.releasePath === REVIEW_RELEASE.releasePath, "review_release_manifest_missing");
for (const value of [release, scene]) {
  assert(value.status === "review"
    && value.acceptanceStatus === "pending-human-acceptance"
    && value.visualAcceptanceStatus === "pending-human-acceptance"
    && value.rightsApprovalStatus === REVIEW_RIGHTS_APPROVAL_STATUS
    && value.rightsApproved === false
    && value.publicationReady === false, "review_release_gate_drift");
}
assert(release.isCurrent === false && scene.isCurrent === false, "review_release_must_not_be_current");
assert(scene.rights.license === REVIEW_RIGHTS_LICENSE_REF
  && scene.rights.approvalStatus === REVIEW_RIGHTS_APPROVAL_STATUS
  && scene.rights.rightsApproved === false
  && JSON.stringify(scene.rights.clearedFor) === JSON.stringify([])
  && !("approvedOn" in scene.rights)
  && !("approvedBy" in scene.rights), "review_scene_rights_drift");
const license = await readFile(join(releaseDir, "LICENSES.md"), "utf8");
assert(license.includes(REVIEW_RIGHTS_LICENSE_REF)
  && license.includes(REVIEW_RIGHTS_APPROVAL_STATUS)
  && license.includes("Historical approval for earlier release bytes does not extend automatically"), "review_release_license_drift");

const releaseFiles = Object.fromEntries(await Promise.all(RELEASE_FILES.map(async (name) => [name, await fileRecord(join(releaseDir, name))])));
for (const name of RELEASE_FILES) assertRecord(releaseFiles[name], release.files[name], `review_release_record_drift:${name}`);
assertRecord(releaseFiles["scene.json"], await fileRecord(join(root, REVIEW_RELEASE.sceneManifestPath)), "review_scene_manifest_source_drift");
assertRecord(releaseFiles["LICENSES.md"], await fileRecord(join(root, REVIEW_RELEASE.licensePath)), "review_license_source_drift");
assertRecord(releaseFiles["preview.webp"], await fileRecord(join(root, REVIEW_RELEASE.reviewPath, "entry.webp")), "review_preview_source_drift");
for (const field of ["spawnPoints", "bounds", "anchors", "mediaSurfaces", "renderMode", "renderProfile"]) {
  assert(JSON.stringify(scene[field]) === JSON.stringify(previousScene[field]), `review_runtime_binding_drift:${field}`);
}

const glbBytes = await readFile(glbPath);
const validation = await validator.validateBytes(new Uint8Array(glbBytes), { uri: `${SCENE_ID}@${REVIEW_RELEASE_VERSION}/scene.glb`, maxIssues: 500 });
assert(validation.issues.numErrors === 0 && validation.issues.numWarnings === 0, `review_khronos_validation_failed:${validation.issues.numErrors}:${validation.issues.numWarnings}`);
const stats = await glbStats(glbPath);
assert(JSON.stringify(stats) === JSON.stringify(release.stats), "review_glb_stats_manifest_drift");
assert(JSON.stringify(stats) === JSON.stringify({ triangles: 45772, objects: 232, meshes: 232, primitives: 232, materials: 16, textures: 2, animations: 0, scenes: 1 }), "review_glb_stats_drift");
await assertReviewReleaseMaterialContract(glbPath);

const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(glbPath);
const gltfRoot = document.getRoot();
const meshNodes = gltfRoot.listNodes().filter((node) => node.getMesh());
const names = new Set(meshNodes.map((node) => node.getName()));
const pairs = [];
const statusCounts = {};
const groups = new Map();
for (const node of meshNodes) {
  const extras = node.getExtras();
  for (const tag of requiredTags) assert(tag in extras, `review_mesh_tag_missing:${node.getName()}:${tag}`);
  assert(/^[a-z0-9][a-z0-9-]*$/.test(extras.vrataObjectId), `invalid_review_object_id:${node.getName()}`);
  assert(/^[a-z0-9][a-z0-9-]*$/.test(extras.vrataPartId), `invalid_review_part_id:${node.getName()}`);
  assert(["passive", "deferred", "interactive"].includes(extras.vrataInteractionStatus), `invalid_review_interaction_status:${node.getName()}`);
  pairs.push(`${extras.vrataObjectId}:${extras.vrataPartId}`);
  statusCounts[extras.vrataInteractionStatus] = (statusCounts[extras.vrataInteractionStatus] ?? 0) + 1;
  const group = groups.get(extras.vrataObjectId) ?? { id: extras.vrataObjectId, status: extras.vrataInteractionStatus, partCount: 0 };
  assert(group.status === extras.vrataInteractionStatus, `mixed_review_object_status:${extras.vrataObjectId}`);
  group.partCount += 1;
  groups.set(extras.vrataObjectId, group);
  if (extras.vrataBakePolicy === "include") {
    for (const primitive of node.getMesh().listPrimitives()) assert(primitive.getAttribute("TEXCOORD_1") !== null, `review_lightmap_uv_missing:${node.getName()}`);
  }
}
assert(new Set(pairs).size === meshNodes.length, "review_object_part_pairs_not_unique");
const objectGroups = [...groups.values()].sort((left, right) => left.id.localeCompare(right.id));
assert(JSON.stringify(objectGroups) === JSON.stringify(reality.objectGroups), "review_object_groups_contract_drift");
assert(JSON.stringify(requiredTags) === JSON.stringify(reality.glbContract.requiredMeshTags), "review_required_tags_contract_drift");
assert(reality.glbContract.requiredNodeNames.every((name) => names.has(name)), "review_required_node_missing");
assert(reality.glbContract.forbiddenNodeNames.every((name) => !names.has(name)), "review_forbidden_node_present");
assert(JSON.stringify(statusCounts) === JSON.stringify({ passive: 201, deferred: 3, interactive: 28 }), "review_interaction_status_count_drift");

const panoramaNode = meshNodes.find((node) => node.getName() === reality.panorama.nodeName);
const panoramaExtras = panoramaNode?.getExtras();
assert(panoramaExtras?.vrataObjectId === "exterior-panorama"
  && panoramaExtras.vrataPartId === "sphere"
  && panoramaExtras.vrataInteractionStatus === "passive"
  && panoramaExtras.vrataBakePolicy === "exclude-unlit-background"
  && panoramaExtras.vrataCollisionPolicy === "exclude"
  && panoramaExtras.vrataSupportPolicy === "exclude"
  && panoramaExtras.vrataNavigableBoundsPolicy === "exclude"
  && panoramaExtras.vrataPanoramaSha256 === reality.panorama.sha256
  && panoramaExtras.vrataPanoramaRadiusM === reality.panorama.radiusM
  && panoramaExtras.vrataPanoramaYawDegrees === reality.panorama.yawDegrees, "review_panorama_node_contract_drift");

const [textures, lightmapRecord, panoramaRecord] = await Promise.all([
  glbTextureRecords(glbPath),
  fileRecord(join(root, REVIEW_RELEASE.lightmapPath)),
  fileRecord(join(root, REVIEW_RELEASE.panoramaPath))
]);
assert(JSON.stringify(textures) === JSON.stringify([
  { name: "baked-lightmap", mimeType: "image/png", ...lightmapRecord },
  { name: "panorama-city-park", mimeType: "image/jpeg", ...panoramaRecord }
]), "review_embedded_texture_drift");
const panoramaBytes = await readFile(join(root, REVIEW_RELEASE.panoramaPath));
const lightmapBytes = await readFile(join(root, REVIEW_RELEASE.lightmapPath));
assert(JSON.stringify(jpegDimensions(panoramaBytes)) === JSON.stringify({ width: 4096, height: 2048 }), "review_panorama_dimensions_drift");
assert(JSON.stringify(pngDimensions(lightmapBytes)) === JSON.stringify({ width: 2048, height: 2048 }), "review_lightmap_dimensions_drift");
assert(panoramaBytes.length === reality.panorama.compressedBytes && panoramaBytes.length <= reality.budgets.panoramaCompressedBytesMax, "review_panorama_compressed_budget_failed");
assert(reality.budgets.panoramaDecodedRgbaBytes + reality.budgets.lightmapDecodedRgbaBytes === reality.budgets.totalDecodedTextureBytesMax, "review_decoded_texture_budget_drift");
assert(glbBytes.length <= reality.budgets.glbBytesMax && stats.triangles <= reality.budgets.trianglesMax, "review_glb_budget_failed");

assert(index.schemaVersion === 1 && index.sceneId === SCENE_ID
  && index.releases.length >= 1
  && new Set(index.releases.map(({ version }) => version)).size === index.releases.length, "review_source_index_drift");
const indexRecord = index.releases.find(({ version }) => version === REVIEW_RELEASE_VERSION);
assert(indexRecord?.version === REVIEW_RELEASE_VERSION
  && indexRecord.status === "review-source-lock"
  && indexRecord.lockPath === REVIEW_RELEASE.sourceLockPath
  && indexRecord.visualParityConfigPath === REVIEW_RELEASE.visualParityConfigPath
  && indexRecord.humanVisualAccepted === false
  && indexRecord.technicalRuntimeCapture === "passed-three-byte-stable-runtime-capture-sets", "review_source_index_record_drift");
assertRecord(await fileRecord(join(root, indexRecord.lockPath)), { sha256: indexRecord.lockSha256, sizeBytes: (await fileRecord(join(root, indexRecord.lockPath))).sizeBytes }, "review_source_lock_index_digest_drift");
assertRecord(await fileRecord(join(root, indexRecord.visualParityConfigPath)), { sha256: indexRecord.visualParityConfigSha256, sizeBytes: (await fileRecord(join(root, indexRecord.visualParityConfigPath))).sizeBytes }, "review_visual_config_index_digest_drift");
assert(lock.status === "review-source-lock"
  && lock.sceneId === SCENE_ID
  && lock.releaseVersion === REVIEW_RELEASE_VERSION
  && lock.humanVisualAccepted === false
  && lock.rightsApproved === false, "review_source_lock_identity_drift");
assert(lock.toolchain.blenderVersion === BLENDER_VERSION
  && lock.toolchain.blenderBuildHash === BLENDER_BUILD_HASH
  && lock.toolchain.blenderBinarySha256 === BLENDER_BINARY_SHA256
  && lock.toolchain.gltfExporter === "Khronos glTF Blender I/O v4.5.51", "review_source_toolchain_drift");
assert(lock.tooling.length > 0
  && new Set(lock.tooling.map(({ path }) => path)).size === lock.tooling.length
  && lock.tooling.every(({ path, sha256, sizeBytes }) => typeof path === "string" && !path.startsWith("/") && !path.includes("..")
    && /^[0-9a-f]{64}$/.test(sha256) && Number.isInteger(sizeBytes) && sizeBytes > 0), "review_historical_tooling_snapshot_drift");
for (const record of [...lock.derivationInputs, ...lock.sourceFiles, ...lock.reviewViews]) await assertPathRecord(record, `review_locked_source_drift:${record.path}`);
assert(JSON.stringify(lock.release.files) === JSON.stringify(release.files) && JSON.stringify(lock.release.stats) === JSON.stringify(release.stats), "review_source_lock_release_drift");
assert(lock.reproducibility.panorama.runs === 2
  && lock.reproducibility.panorama.result === "byte-identical-rgb-pixels-before-lossy-encoding"
  && lock.reproducibility.panorama.decodedRgbSha256 === panoramaParameters.decodedRgbSha256
  && lock.reproducibility.panorama.artifact.sha256 === panoramaRecord.sha256
  && lock.reproducibility.panorama.jpegEncoderBytesClaimedReproducible === false
  && lock.reproducibility.glb.runs === 2
  && lock.reproducibility.glb.result === "byte-identical-glb"
  && lock.reproducibility.glb.sha256 === release.files["scene.glb"].sha256
  && lock.reproducibility.sourceContainer.result === "locked-not-claimed-byte-reproducible-from-reauthoring"
  && lock.reproducibility.sourceContainer.reauthoringBytesClaimedReproducible === false, "review_reproducibility_lock_drift");
assert(lock.technicalRuntimeCapture.status === "passed-three-byte-stable-runtime-capture-sets"
  && lock.technicalRuntimeCapture.captureRoot === REVIEW_RELEASE.runtimeCapturePath
  && JSON.stringify(lock.technicalRuntimeCapture.captureSets) === JSON.stringify(REVIEW_RUNTIME_CAPTURE_RUNS)
  && lock.technicalRuntimeCapture.humanVisualAcceptance === "pending-human-acceptance"
  && lock.technicalRuntimeCapture.humanRightsApproval === REVIEW_RIGHTS_APPROVAL_STATUS, "review_source_lock_runtime_capture_drift");

assert(JSON.stringify(REVIEW_RELEASE_VIEWS) === JSON.stringify(visualConfig.reviewViews.map(({ id }) => id)), "review_visual_view_set_drift");
assert(JSON.stringify(REVIEW_RELEASE_VIEWS) === JSON.stringify(visualConfig.views.map(({ id }) => id)), "review_visual_reference_set_drift");
for (const view of visualConfig.reviewViews) {
  assert(Math.abs(view.fovDegrees - horizontalToVerticalFovDegrees(view.sourceHorizontalFovDegrees)) < 1e-12, `review_runtime_fov_drift:${view.id}`);
}
for (const view of visualConfig.views) {
  const bytes = await readFile(join(root, view.referencePath));
  assert((await fileRecord(join(root, view.referencePath))).sha256 === view.referenceSha256, `review_visual_reference_hash_drift:${view.id}`);
  assert(JSON.stringify(webpDimensions(bytes)) === JSON.stringify({ width: 960, height: 540 }), `review_visual_reference_dimensions_drift:${view.id}`);
  assert(view.thresholds.status === "calibrated-from-three-byte-stable-runtime-capture-sets"
    && Number.isFinite(view.thresholds.phashMax)
    && Number.isFinite(view.thresholds.nccMin)
    && Number.isFinite(view.thresholds.observedPhashMax)
    && Number.isFinite(view.thresholds.observedNccMin)
    && view.thresholds.phashMarginAbsolute === 5
    && view.thresholds.nccMarginAbsolute === 0.03, `review_visual_threshold_drift:${view.id}`);
}
assert(visualConfig.status === "technical-runtime-capture-passed"
  && visualConfig.capture.platformCommit === BAKED_PLATFORM_COMMIT
  && JSON.stringify(visualConfig.capture.repeatSets) === JSON.stringify(REVIEW_RUNTIME_CAPTURE_RUNS)
  && visualConfig.aggregateThresholds.status === "calibrated-from-three-byte-stable-runtime-capture-sets"
  && Number.isFinite(visualConfig.aggregateThresholds.phashTotalMax)
  && Number.isFinite(visualConfig.aggregateThresholds.nccMeanMin)
  && visualConfig.calibration.status === "established-from-three-byte-stable-runtime-capture-sets"
  && visualConfig.calibration.purpose === "post-capture-regression-baseline-not-independent-acceptance"
  && visualConfig.humanGates.visualAcceptance === "pending-human-acceptance"
  && visualConfig.humanGates.rightsApproval === REVIEW_RIGHTS_APPROVAL_STATUS
  && visualConfig.humanGates.publicationReady === false, "review_visual_config_gate_drift");
assertRecord(visualConfig.releaseGlb, release.files["scene.glb"], "review_visual_config_glb_drift");
assertRecord(visualConfig.releaseManifest, release.files["scene.json"], "review_visual_config_manifest_drift");
await assertPathRecord(visualConfig.capture.platformPatch, "review_visual_config_patch_drift");
assert(visualEvidence.status === "technical-runtime-capture-passed"
  && visualEvidence.passed === true
  && visualEvidence.captureSets.length === REVIEW_RUNTIME_CAPTURE_RUNS.length
  && visualEvidence.captureSets.every((run) => run.passed === true && run.views.length === REVIEW_RELEASE_VIEWS.length && run.views.every((view) => view.passed === true))
  && visualEvidence.humanVisualAcceptance === "pending-human-acceptance"
  && visualEvidence.humanRightsApproval === REVIEW_RIGHTS_APPROVAL_STATUS
  && visualEvidence.publicationReady === false, "review_visual_evidence_gate_drift");
await assertPathRecord(visualEvidence.sourceLock, "review_visual_source_lock_drift");
await assertPathRecord(visualEvidence.config, "review_visual_config_record_drift");
await assertPathRecord(visualEvidence.stabilityEvidence, "review_visual_stability_record_drift");
assert(visualStability.status === "stable-three-runtime-capture-sets"
  && visualStability.thresholdsEstablished === true
  && visualStability.comparison.imagesByteIdenticalAcrossRuns === true
  && visualStability.comparison.maximumPairwisePhash === 0
  && visualStability.comparison.minimumPairwiseNcc === 1
  && visualStability.captureSets.length === REVIEW_RUNTIME_CAPTURE_RUNS.length
  && visualStability.captureSets.every((run, index) => run.id === REVIEW_RUNTIME_CAPTURE_RUNS[index] && run.images.length === REVIEW_RELEASE_VIEWS.length)
  && visualStability.humanVisualAcceptance === "pending-human-acceptance"
  && visualStability.humanRightsApproval === REVIEW_RIGHTS_APPROVAL_STATUS
  && visualStability.publicationReady === false, "review_visual_stability_drift");
for (const run of visualStability.captureSets) {
  assert(JSON.stringify((await readdir(join(root, run.path))).sort()) === JSON.stringify([...REVIEW_RUNTIME_CAPTURE_FILES].sort()), `review_runtime_capture_file_set_drift:${run.id}`);
  for (const record of [run.binding, run.diagnostics.record, run.settings, ...run.images]) await assertPathRecord(record, `review_runtime_capture_record_drift:${run.id}:${record.path}`);
}

assert(JSON.stringify(runtimeCoordinates.bindings) === JSON.stringify(reality.preservedRuntimeBindings)
  && runtimeCoordinates.previousReleaseBindingsPreserved === true, "review_runtime_coordinate_evidence_drift");
assert(scenarios.scenarios.length === 7
  && scenarios.scenarios.every(({ implementationRequired }) => implementationRequired === true), "review_scenario_contract_drift");
const visualScenario = scenarios.scenarios.find(({ id }) => id === "fixed-source-review-coverage");
const visualCriteria = Object.fromEntries(visualScenario.acceptanceCriteria.map(({ measure, value }) => [measure, value]));
assert(visualCriteria["phash-thresholds"] === "calibrated-from-three-byte-stable-runtime-capture-sets"
  && visualCriteria["ncc-thresholds"] === "calibrated-from-three-byte-stable-runtime-capture-sets", "review_scenario_visual_threshold_state_drift");
assert(realityReport.result === "valid"
  && realityReport.release.meshNodesValidated === 232
  && realityReport.release.taggedMeshNodesValidated === 232
  && realityReport.release.uniqueObjectPartPairsValidated === 232
  && realityReport.release.objectGroupsValidated === 19
  && realityReport.gates.runtimeCapture === "technical-runtime-capture-passed"
  && realityReport.gates.runtimeCaptureSets === REVIEW_RUNTIME_CAPTURE_RUNS.length
  && realityReport.gates.humanVisualAcceptance === "pending-human-acceptance"
  && realityReport.gates.humanRightsApproval === REVIEW_RIGHTS_APPROVAL_STATUS, "review_reality_report_drift");
await assertPathRecord(realityReport.contracts.sceneReality, "review_reality_contract_record_drift");
await assertPathRecord(realityReport.contracts.userScenarios, "review_scenarios_contract_record_drift");

assert(JSON.stringify(inventory.stats) === JSON.stringify(stats)
  && inventory.meshSemantics.taggedMeshNodes === 232
  && inventory.meshSemantics.uniqueObjectPartPairs === 232
  && JSON.stringify(inventory.meshSemantics.objectGroups) === JSON.stringify(objectGroups)
  && JSON.stringify(inventory.textures) === JSON.stringify(textures), "review_glb_inventory_drift");
assert(panoramaIntegrity.result === "valid"
  && panoramaIntegrity.byteIdenticalSourceAndEmbedded === true
  && panoramaIntegrity.source.sha256 === panoramaRecord.sha256
  && panoramaIntegrity.embedded.sha256 === panoramaRecord.sha256
  && panoramaIntegrity.budgets.compressedBytes <= panoramaIntegrity.budgets.compressedBytesMax
  && panoramaIntegrity.budgets.totalBaseDecodedTextureBytes <= panoramaIntegrity.budgets.totalBaseDecodedTextureBytesMax
  && panoramaIntegrity.budgets.totalMipmappedGpuRgba8Bytes <= panoramaIntegrity.budgets.totalMipmappedGpuRgba8BytesMax, "review_panorama_integrity_drift");
await assertPathRecord(panoramaIntegrity.generator, "review_panorama_generator_record_drift");
await assertPathRecord(panoramaIntegrity.parameters, "review_panorama_parameters_record_drift");
assert(panoramaParameters.compressedBytesMax === reality.budgets.panoramaCompressedBytesMax
  && panoramaParameters.decodedRgbaBytes === reality.budgets.panoramaDecodedRgbaBytes, "review_panorama_parameters_budget_drift");

assert(generationLedger.status === "review"
  && generationLedger.reproducibility === undefined
  && generationLedger.panorama.reproducibility.result === "byte-identical-rgb-pixels-before-lossy-encoding"
  && generationLedger.export.reproducibility.result === "byte-identical-glb"
  && generationLedger.derivation.acceptedSourceContainer === "locked-exact-bytes"
  && generationLedger.derivation.reauthoringBytesClaimedReproducible === false
  && generationLedger.humanGates.rights === REVIEW_RIGHTS_APPROVAL_STATUS, "review_generation_ledger_drift");
assert(JSON.stringify(generationLedger.tooling) === JSON.stringify(lock.tooling), "review_generation_tooling_drift");
for (const record of [generationLedger.derivation.immutableBaseBlend, generationLedger.derivation.inheritedLightmap, generationLedger.derivation.prepareScript, generationLedger.derivation.derivedBlend, generationLedger.panorama.generator, generationLedger.panorama.parameters, generationLedger.panorama.output, generationLedger.export.script, generationLedger.export.output, generationLedger.sourceReview.renderer]) {
  await assertPathRecord(record, `review_generation_record_drift:${record.path}`);
}
assert(assetLedger.approval.decision === REVIEW_RIGHTS_APPROVAL_STATUS
  && assetLedger.approval.rightsApproved === false
  && assetLedger.approval.humanDecisionRecorded === false
  && assetLedger.approval.evidencePath === null
  && assetLedger.externalAssetCount === 0
  && assetLedger.downloadedAssetCount === 0
  && assetLedger.boundaries.projectAuthoredOnly === true
  && assetLedger.boundaries.humanVisualAccepted === false
  && assetLedger.boundaries.humanRightsAccepted === false
  && assetLedger.boundaries.publicationReady === false, "review_asset_ledger_gate_drift");
for (const record of assetLedger.records) {
  assert(record.externalSource === null && record.attribution === null && record.authorProvider === "project-team", `review_asset_record_origin_drift:${record.id}`);
  await assertPathRecord({ path: record.repositoryPath, sha256: record.originalSha256, sizeBytes: record.sizeBytes }, `review_asset_record_drift:${record.id}`);
}
const provenanceLicense = await readFile(join(root, assetLedger.license.reference), "utf8");
assert(assetLedger.license.name === REVIEW_RIGHTS_LICENSE_REF
  && assetLedger.license.grantsPublicationRights === false
  && provenanceLicense.includes(REVIEW_RIGHTS_APPROVAL_STATUS)
  && provenanceLicense.includes("It is not a human rights decision"), "review_provenance_license_drift");

process.stdout.write(`Review release ${SCENE_ID}@${REVIEW_RELEASE_VERSION} source, reality, panorama, GLB, three-run technical parity, pending human visual gate, and pending rights gate are valid.\n`);
