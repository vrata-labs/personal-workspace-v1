import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import validator from "gltf-validator";

import {
  BLENDER_BINARY_SHA256,
  BLENDER_BUILD_HASH,
  BLENDER_VERSION,
  REVIEW_RIGHTS_APPROVAL_STATUS,
  SCENE_ID,
  VERSION,
  assert,
  bakedMaterialMetadata,
  createNodeIO,
  fileRecord,
  glbStats,
  glbTextureRecords,
  jpegDimensions,
  pngDimensions,
  readJson,
  webpDimensions
} from "./lib.mjs";
import {
  CURRENT_CLEAN_CAPTURE_FILES,
  CURRENT_HASHES,
  CURRENT_NORMAL_CAPTURE_FILES,
  CURRENT_PLATFORM_COMMIT,
  CURRENT_PROVENANCE_PATH,
  CURRENT_QUALITY_OUTCOME,
  CURRENT_RELEASE_FILES,
  CURRENT_RELEASE_PATH,
  CURRENT_RELEASE_VERSION,
  CURRENT_REVIEW_FILES,
  CURRENT_REVIEW_VIEWS,
  CURRENT_RUNTIME_CAPTURE_PATH,
  CURRENT_SOURCE_PATH,
  CURRENT_STATS,
  POLY_HAVEN_INFO_URLS,
  POLY_HAVEN_LICENSE_URL,
  POLY_HAVEN_SOURCE_URLS
} from "./release-0.4.0.mjs";

const root = resolve(import.meta.dirname, "..");
const sourceDir = join(root, CURRENT_SOURCE_PATH);
const releaseDir = join(root, CURRENT_RELEASE_PATH);
const provenanceDir = join(root, CURRENT_PROVENANCE_PATH);
const runtimeDir = join(root, CURRENT_RUNTIME_CAPTURE_PATH);
const glbPath = join(releaseDir, "scene.glb");
const requiredTags = [
  "vrataObjectId",
  "vrataPartId",
  "vrataInteractionStatus",
  "vrataBakePolicy",
  "vrataCollisionPolicy",
  "vrataSupportPolicy",
  "vrataNavigableBoundsPolicy",
  "vrataAssetOrigin",
  "vrataAuthoringRelease"
];

function posix(path) {
  return path.split(sep).join("/");
}

function assertRecord(actual, expected, code) {
  assert(actual?.sha256 === expected?.sha256 && actual?.sizeBytes === expected?.sizeBytes, code);
}

async function assertPathRecord(value, code) {
  assert(value?.path && !value.path.startsWith("/") && !value.path.includes("..") && !value.path.includes("\\"), `${code}:path`);
  assertRecord(await fileRecord(join(root, value.path)), value, code);
}

async function walk(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else if (entry.isFile()) paths.push(posix(relative(root, path)));
    else throw new Error(`unsupported_source_entry:${posix(relative(root, path))}`);
  }
  return paths.sort();
}

const [
  packageManifest,
  repository,
  manifest,
  acceptanceIndex,
  scene,
  sourceLock,
  objectRegistry,
  sourceLedger,
  geometry,
  support,
  inventory,
  quality,
  captureIndex,
  releaseLedger,
  sceneDebug,
  captureSettings,
  normalEvidence
] = await Promise.all([
  readJson(join(root, "package.json")),
  readJson(join(root, "scene-repository.json")),
  readJson(join(root, "manifest.json")),
  readJson(join(root, "source", "release-acceptance-index.json")),
  readJson(join(releaseDir, "scene.json")),
  readJson(join(sourceDir, "review-source-lock.json")),
  readJson(join(sourceDir, "object-registry.json")),
  readJson(join(sourceDir, "textures", "source-ledger.json")),
  readJson(join(provenanceDir, "geometry-measurements.json")),
  readJson(join(provenanceDir, "support-measurements.json")),
  readJson(join(provenanceDir, "glb-inventory.json")),
  readJson(join(provenanceDir, "quality-disposition.json")),
  readJson(join(provenanceDir, "runtime-capture-index.json")),
  readJson(join(provenanceDir, "release-ledger.json")),
  readJson(join(runtimeDir, "clean", "scene-debug.json")),
  readJson(join(runtimeDir, "clean", "capture-settings.json")),
  readJson(join(runtimeDir, "normal", "normal-product-evidence.json"))
]);

assert(VERSION === CURRENT_RELEASE_VERSION
  && packageManifest.version === CURRENT_RELEASE_VERSION
  && repository.releaseVersion === CURRENT_RELEASE_VERSION, "current_release_target_drift");
assert(repository.releaseStatus === "review"
  && repository.acceptanceStatus === "pending-human-acceptance"
  && repository.visualAcceptanceStatus === "pending-human-acceptance"
  && repository.rightsApprovalStatus === REVIEW_RIGHTS_APPROVAL_STATUS
  && repository.rightsApproved === false
  && repository.publicationReady === false
  && repository.qualityOutcome === CURRENT_QUALITY_OUTCOME, "current_repository_gate_drift");
assert(repository.platformValidatorCommit === CURRENT_PLATFORM_COMMIT
  && manifest.platformValidatorCommit === CURRENT_PLATFORM_COMMIT, "current_platform_commit_drift");

const manifestRelease = manifest.releases.find(({ version }) => version === CURRENT_RELEASE_VERSION);
assert(manifest.releases.at(-1) === manifestRelease && manifestRelease?.releasePath === CURRENT_RELEASE_PATH, "current_manifest_release_missing");
assert(manifestRelease.status === "review"
  && manifestRelease.acceptanceStatus === "pending-human-acceptance"
  && manifestRelease.visualAcceptanceStatus === "pending-human-acceptance"
  && manifestRelease.rightsApprovalStatus === REVIEW_RIGHTS_APPROVAL_STATUS
  && manifestRelease.rightsApproved === false
  && manifestRelease.isCurrent === false
  && manifestRelease.publicationReady === false
  && manifestRelease.qualityOutcome === CURRENT_QUALITY_OUTCOME, "current_manifest_gate_drift");

assert(scene.schemaVersion === 1
  && scene.sceneId === SCENE_ID
  && scene.version === CURRENT_RELEASE_VERSION
  && scene.status === "review"
  && scene.isCurrent === false
  && scene.publicationReady === false
  && scene.humanAcceptance === "pending-human-acceptance"
  && scene.visual?.reviewStage === "draft-quality-review", "current_scene_gate_drift");
assert(scene.glbPath === "scene.glb"
  && scene.glbSha256 === CURRENT_HASHES.finalGlb
  && scene.preview === "preview.webp"
  && scene.renderMode === "clean"
  && scene.renderProfile === "baked-pbr-v1", "current_scene_asset_binding_drift");
assert(scene.rights.approvalStatus === REVIEW_RIGHTS_APPROVAL_STATUS
  && JSON.stringify(scene.rights.clearedFor) === JSON.stringify([])
  && !("approvedOn" in scene.rights)
  && !("approvedBy" in scene.rights), "current_scene_rights_drift");

assert(JSON.stringify((await readdir(releaseDir)).sort()) === JSON.stringify([...CURRENT_RELEASE_FILES].sort()), "current_release_file_set_drift");
const releaseFiles = Object.fromEntries(await Promise.all(CURRENT_RELEASE_FILES.map(async (name) => [name, await fileRecord(join(releaseDir, name))])));
for (const name of CURRENT_RELEASE_FILES) assertRecord(releaseFiles[name], manifestRelease.files[name], `current_release_record_drift:${name}`);
assert(releaseFiles["scene.glb"].sha256 === CURRENT_HASHES.finalGlb && releaseFiles["scene.glb"].sizeBytes === 6674412, "current_glb_record_drift");
assert(releaseFiles["scene.json"].sha256 === CURRENT_HASHES.sceneManifest, "current_scene_manifest_record_drift");
assert(releaseFiles["preview.webp"].sha256 === CURRENT_HASHES.preview, "current_preview_record_drift");
assert(releaseFiles["LICENSES.md"].sha256 === CURRENT_HASHES.licenses, "current_license_record_drift");
assertRecord(releaseFiles["scene.json"], await fileRecord(join(sourceDir, "scene-manifest.json")), "current_scene_source_drift");
assertRecord(releaseFiles["preview.webp"], await fileRecord(join(sourceDir, "preview.webp")), "current_preview_source_drift");
assertRecord(releaseFiles["LICENSES.md"], await fileRecord(join(sourceDir, "release-LICENSES.md")), "current_license_source_drift");
assert(JSON.stringify(webpDimensions(await readFile(join(releaseDir, "preview.webp")))) === JSON.stringify({ width: 1280, height: 800 }), "current_preview_dimensions_drift");
for (const name of ["scene.json", "LICENSES.md"]) {
  const text = await readFile(join(releaseDir, name), "utf8");
  assert(!/(^|[\s"'(])(?:\/tmp\/|\/home\/|\/mnt\/|[A-Za-z]:[\\/]|\.\.[\\/])/.test(text), `release_local_path:${name}`);
}

const glbBytes = await readFile(glbPath);
const validation = await validator.validateBytes(glbBytes, { uri: `${SCENE_ID}@${CURRENT_RELEASE_VERSION}/scene.glb`, maxIssues: 100000 });
assert(validation.issues.numErrors === 0 && validation.issues.numWarnings === 0, `current_gltf_validation_failed:${validation.issues.numErrors}:${validation.issues.numWarnings}`);
const stats = await glbStats(glbPath);
assert(JSON.stringify(stats) === JSON.stringify(CURRENT_STATS)
  && JSON.stringify(stats) === JSON.stringify(manifestRelease.stats), "current_glb_stats_drift");
const textures = await glbTextureRecords(glbPath);
assert(textures.length === CURRENT_STATS.textures
  && textures[0].sha256 === CURRENT_HASHES.atlas
  && textures.at(-1).sha256 === "65e365da8d3f192c5c091f60d8da2da63867cf7aa793c7a231fcdb582472b9ee", "current_embedded_texture_drift");
const materials = await bakedMaterialMetadata(glbPath);
const lightMapped = materials.filter(({ extras }) => extras.vrataLightMap === true);
const panoramaMaterial = materials.find(({ name }) => name === "material.panorama");
assert(lightMapped.length === 22
  && lightMapped.every(({ extras, hasEmissiveTexture }) => hasEmissiveTexture
    && extras.vrataRenderProfile === "baked-pbr-v1"
    && extras.vrataLightMapIncludesEnvironment === true
    && extras.vrataLightMapEncoding === "cycles-diffuse-radiance-srgb8"
    && Number.isFinite(extras.vrataLightMapIntensity)), "current_lightmap_material_contract_drift");
assert(panoramaMaterial && panoramaMaterial.extras.vrataLightMap !== true, "current_panorama_material_contract_drift");

const document = await createNodeIO().read(glbPath);
const meshNodes = document.getRoot().listNodes().filter((node) => node.getMesh());
const actualParts = [];
for (const node of meshNodes) {
  const extras = node.getExtras();
  for (const tag of requiredTags) assert(tag in extras, `current_mesh_tag_missing:${node.getName()}:${tag}`);
  assert(extras.vrataAssetOrigin === "project-authored" && extras.vrataAuthoringRelease === CURRENT_RELEASE_VERSION, `current_mesh_origin_drift:${node.getName()}`);
  assert(["passive", "deferred", "interactive"].includes(extras.vrataInteractionStatus), `current_mesh_interaction_status_drift:${node.getName()}`);
  actualParts.push(`${extras.vrataObjectId}.${extras.vrataPartId}`);
}
const registeredParts = objectRegistry.objects.flatMap(({ parts }) => parts).sort();
assert(objectRegistry.sceneId === SCENE_ID
  && objectRegistry.releaseVersion === CURRENT_RELEASE_VERSION
  && objectRegistry.qualityOutcome === CURRENT_QUALITY_OUTCOME
  && new Set(registeredParts).size === registeredParts.length
  && JSON.stringify(actualParts.sort()) === JSON.stringify(registeredParts), "current_object_registry_drift");

assert(geometry.sourceBlendSha256 === CURRENT_HASHES.authoredBlend
  && geometry.measurementScriptSha256 === "d961c8d0d6678a1e448b93efa04d70c57eee12ddff40bf62a9ee4abd1c65d89d"
  && geometry.registrySha256 === CURRENT_HASHES.registry
  && geometry.meshParts === CURRENT_STATS.meshes
  && geometry.screenVisibility.allClear === true
  && geometry.userClearances.kneeEnvelope.clear === true
  && geometry.userClearances.handReach.every(({ reachable }) => reachable === true)
  && geometry.userClearances.routes.every(({ clear }) => clear === true)
  && geometry.userClearances.spawnOpenRadius.clear === true
  && geometry.userClearances.plantRouteClearance.clear === true, "current_geometry_measurements_drift");
assert(support.sourceBlendSha256 === CURRENT_HASHES.authoredBlend
  && support.measurementScriptSha256 === "4e6948880245a58765911f528fd2baccc0066ffcfd0496f78f1deffaa2837e26"
  && support.registrySha256 === CURRENT_HASHES.registry
  && support.physicalParts === 396
  && support.declaredParts === 395
  && support.edges.length === support.declaredParts
  && support.edges.every(({ passed }) => passed === true)
  && Object.values(support.failures).every((items) => Array.isArray(items) && items.length === 0), "current_support_measurements_drift");
assertRecord(await fileRecord(join(provenanceDir, "geometry-measurements.json")), { sha256: CURRENT_HASHES.geometryMeasurements, sizeBytes: 3836 }, "current_geometry_record_drift");
assertRecord(await fileRecord(join(provenanceDir, "support-measurements.json")), { sha256: CURRENT_HASHES.supportMeasurements, sizeBytes: 164675 }, "current_support_record_drift");

const ledgerSourceUrls = sourceLedger.records.map(({ sourceUrl }) => sourceUrl).filter(Boolean);
const ledgerInfoUrls = [...new Set(sourceLedger.records.map(({ sourceInfoUrl }) => sourceInfoUrl).filter(Boolean))].sort();
assert(sourceLedger.schemaVersion === 1
  && sourceLedger.licenseSnapshotSha256 === "f530abb18e6317a9b0f2a128b94150e372c8456d7491a14e4860c4ed5f5fe69a"
  && JSON.stringify(ledgerSourceUrls) === JSON.stringify(POLY_HAVEN_SOURCE_URLS)
  && JSON.stringify(ledgerInfoUrls) === JSON.stringify([...POLY_HAVEN_INFO_URLS].sort())
  && sourceLedger.records.every(({ license, licenseUrl }) => license === "CC0-1.0" && licenseUrl === POLY_HAVEN_LICENSE_URL), "current_source_ledger_drift");
for (const source of sourceLedger.records) {
  const path = join(sourceDir, "textures", source.file);
  const actual = await fileRecord(path);
  assertRecord(actual, source, `current_source_asset_drift:${source.file}`);
  if (source.publisherMd5) {
    assert(createHash("md5").update(await readFile(path)).digest("hex") === source.publisherMd5, `current_source_asset_md5_drift:${source.file}`);
  }
}
assert((await fileRecord(join(sourceDir, "textures", "polyhaven-license.html"))).sha256 === sourceLedger.licenseSnapshotSha256, "current_license_snapshot_drift");
assert(JSON.stringify(scene.rights.sourceAssets.map(({ sourceUrl }) => sourceUrl).filter(Boolean)) === JSON.stringify(POLY_HAVEN_SOURCE_URLS), "current_scene_source_url_drift");
assert(JSON.stringify(jpegDimensions(await readFile(join(sourceDir, "textures", "cannon-4k.jpg")))) === JSON.stringify({ width: 4096, height: 2048 }), "current_panorama_dimensions_drift");

assert(JSON.stringify((await readdir(join(sourceDir, "review"))).sort()) === JSON.stringify([...CURRENT_REVIEW_FILES].sort()), "current_source_review_file_set_drift");
for (const view of CURRENT_REVIEW_VIEWS) {
  assert(JSON.stringify(pngDimensions(await readFile(join(sourceDir, "review", `${view}.png`)))) === JSON.stringify({ width: 1280, height: 800 }), `current_source_review_dimensions_drift:${view}`);
}
const sourcePaths = (await walk(sourceDir)).filter((path) => path !== `${CURRENT_SOURCE_PATH}/review-source-lock.json`);
assert(sourceLock.schemaVersion === 1
  && sourceLock.status === "review-source-lock"
  && sourceLock.sceneId === SCENE_ID
  && sourceLock.releaseVersion === CURRENT_RELEASE_VERSION
  && sourceLock.qualityOutcome === CURRENT_QUALITY_OUTCOME
  && sourceLock.toolchain.blenderVersion === BLENDER_VERSION
  && sourceLock.toolchain.blenderBuildHash === BLENDER_BUILD_HASH
  && sourceLock.toolchain.blenderBinarySha256 === BLENDER_BINARY_SHA256
  && JSON.stringify(sourceLock.sourceFiles.map(({ path }) => path)) === JSON.stringify(sourcePaths), "current_source_lock_drift");
for (const source of sourceLock.sourceFiles) await assertPathRecord(source, `current_locked_source_drift:${source.path}`);
assert(sourceLock.reproducibility.releaseMaterialization.runs === 2
  && sourceLock.reproducibility.releaseMaterialization.rawGlbSha256 === CURRENT_HASHES.rawGlb
  && sourceLock.reproducibility.releaseMaterialization.finalGlbSha256 === CURRENT_HASHES.finalGlb
  && sourceLock.humanGates.visual === "pending-human-acceptance"
  && sourceLock.humanGates.rights === REVIEW_RIGHTS_APPROVAL_STATUS
  && sourceLock.humanGates.publicationReady === false, "current_source_lock_gate_drift");

assert(JSON.stringify((await readdir(join(runtimeDir, "clean"))).sort()) === JSON.stringify([...CURRENT_CLEAN_CAPTURE_FILES].sort()), "current_clean_capture_file_set_drift");
assert(JSON.stringify((await readdir(join(runtimeDir, "normal"))).sort()) === JSON.stringify([...CURRENT_NORMAL_CAPTURE_FILES].sort()), "current_normal_capture_file_set_drift");
for (const view of CURRENT_REVIEW_VIEWS) {
  assert(JSON.stringify(pngDimensions(await readFile(join(runtimeDir, "clean", `${view}.png`)))) === JSON.stringify({ width: 1280, height: 800 }), `current_clean_capture_dimensions_drift:${view}`);
}
assert(sceneDebug.bundleUrl === "local-capture/scene.json"
  && sceneDebug.assetUrl === "local-capture/scene.glb"
  && sceneDebug.state === "loaded"
  && sceneDebug.failureReason === null
  && sceneDebug.missingAssets.length === 0
  && sceneDebug.assetBytesLoaded === releaseFiles["scene.glb"].sizeBytes
  && sceneDebug.assetBytesExpected === releaseFiles["scene.glb"].sizeBytes
  && sceneDebug.renderProfile === "baked-pbr-v1"
  && sceneDebug.meshCount === CURRENT_STATS.meshes
  && sceneDebug.materialCount === CURRENT_STATS.materials
  && sceneDebug.lightMappedMaterialCount === 22
  && sceneDebug.triangleEstimate === CURRENT_STATS.triangles
  && sceneDebug.spawnApplied === true, "current_clean_runtime_drift");
assert(captureSettings.glbSha256 === CURRENT_HASHES.finalGlb
  && captureSettings.width === 1280
  && captureSettings.height === 800
  && JSON.stringify(captureSettings.views.map(({ id }) => id)) === JSON.stringify(CURRENT_REVIEW_VIEWS)
  && captureSettings.cameraEvidence.every(({ id }, index) => id === CURRENT_REVIEW_VIEWS[index])
  && captureSettings.normalProductMode === false
  && captureSettings.qualityOutcome === "not-evaluated-by-this-test", "current_capture_settings_drift");
assert(normalEvidence.platformCommit === CURRENT_PLATFORM_COMMIT
  && normalEvidence.manifestSha256 === CURRENT_HASHES.sceneManifest
  && normalEvidence.glbSha256 === CURRENT_HASHES.finalGlb
  && normalEvidence.syntheticReviewPoseUsed === false
  && normalEvidence.seats.length === 1
  && normalEvidence.seats.every(({ authoritativeClaimAndRelease, seatedMovementLocked, eyeHeightAboveSeatM }) => authoritativeClaimAndRelease === true && seatedMovementLocked === true && eyeHeightAboveSeatM >= 0.6 && eyeHeightAboveSeatM <= 0.85)
  && normalEvidence.physicalSurfacesMissingLogicalState.length === 0
  && normalEvidence.mediaAfterCreate.surfaces.some(({ surfaceId, activeObjectType }) => surfaceId === "workspace-main" && activeObjectType === "markdown-board")
  && normalEvidence.verdict === "functional-checks-passed", "current_normal_runtime_drift");

assert(captureIndex.platformCommit === CURRENT_PLATFORM_COMMIT
  && captureIndex.scope === "single-exact-byte-local-clean-and-normal-capture"
  && captureIndex.repeatabilityClaim === "not-a-three-run-stability-claim"
  && captureIndex.qualityOutcome === CURRENT_QUALITY_OUTCOME
  && captureIndex.humanVisualAcceptance === "pending-human-acceptance"
  && captureIndex.humanRightsApproval === REVIEW_RIGHTS_APPROVAL_STATUS
  && captureIndex.publicationReady === false, "current_capture_index_gate_drift");
for (const record of [...Object.values(captureIndex.bindings), ...captureIndex.clean.files, ...captureIndex.normal.files]) await assertPathRecord(record, `current_capture_index_record_drift:${record.path}`);

assert(inventory.qualityOutcome === CURRENT_QUALITY_OUTCOME
  && JSON.stringify(inventory.stats) === JSON.stringify(CURRENT_STATS)
  && JSON.stringify(inventory.textures) === JSON.stringify(textures)
  && inventory.validation.result === "passed"
  && inventory.validation.errors === 0
  && inventory.validation.warnings === 0
  && inventory.budgets.meshes.actual === 397
  && inventory.budgets.meshes.maximum === 250
  && inventory.budgets.meshes.withinBudget === false
  && inventory.budgets.meshes.disposition === "documented-unapproved-review-exception"
  && inventory.budgets.meshes.blocksPublication === true, "current_glb_inventory_drift");
assert(quality.verdicts.inheritedQualityTarget === CURRENT_QUALITY_OUTCOME
  && quality.verdicts.sourceToRuntimeFidelity === CURRENT_QUALITY_OUTCOME
  && JSON.stringify(quality.inspectedSourceRuntimePairs) === JSON.stringify(CURRENT_REVIEW_VIEWS)
  && quality.unresolvedDefects.length >= 3
  && quality.unresolvedDefects.every(({ blocksReadyForUserReview }) => blocksReadyForUserReview === true)
  && quality.humanGates.visual === "pending-human-acceptance"
  && quality.humanGates.rights === REVIEW_RIGHTS_APPROVAL_STATUS
  && quality.humanGates.publicationReady === false
  && quality.humanGates.isCurrent === false, "current_quality_disposition_drift");

assert(JSON.stringify((await readdir(provenanceDir)).sort()) === JSON.stringify([
  "geometry-measurements.json",
  "glb-inventory.json",
  "quality-disposition.json",
  "release-ledger.json",
  "runtime-capture-index.json",
  "support-measurements.json"
]), "current_provenance_file_set_drift");
assert(releaseLedger.status === "review"
  && releaseLedger.qualityOutcome === CURRENT_QUALITY_OUTCOME
  && JSON.stringify(releaseLedger.release.files) === JSON.stringify(manifestRelease.files)
  && JSON.stringify(releaseLedger.release.stats) === JSON.stringify(CURRENT_STATS)
  && releaseLedger.gates.meshBudget === "failed-unapproved-exception"
  && releaseLedger.gates.inheritedQualityTarget === CURRENT_QUALITY_OUTCOME
  && releaseLedger.gates.humanVisualAcceptance === "pending-human-acceptance"
  && releaseLedger.gates.humanRightsApproval === REVIEW_RIGHTS_APPROVAL_STATUS
  && releaseLedger.gates.staging === "not-published"
  && releaseLedger.gates.publicationReady === false
  && releaseLedger.gates.isCurrent === false, "current_release_ledger_drift");
await assertPathRecord(releaseLedger.sourceLock, "current_release_ledger_source_lock_drift");
for (const evidence of releaseLedger.evidence) await assertPathRecord(evidence, `current_release_ledger_evidence_drift:${evidence.path}`);

const indexRecord = acceptanceIndex.releases.find(({ version }) => version === CURRENT_RELEASE_VERSION);
assert(acceptanceIndex.releases.at(-1) === indexRecord
  && indexRecord.status === "review-source-lock"
  && indexRecord.lockPath === `${CURRENT_SOURCE_PATH}/review-source-lock.json`
  && indexRecord.lockSha256 === (await fileRecord(join(root, indexRecord.lockPath))).sha256
  && indexRecord.releaseLedgerPath === `${CURRENT_PROVENANCE_PATH}/release-ledger.json`
  && indexRecord.releaseLedgerSha256 === (await fileRecord(join(root, indexRecord.releaseLedgerPath))).sha256
  && indexRecord.qualityOutcome === CURRENT_QUALITY_OUTCOME
  && indexRecord.humanVisualAccepted === false
  && indexRecord.rightsApproved === false
  && indexRecord.publicationReady === false
  && indexRecord.isCurrent === false, "current_acceptance_index_drift");

process.stdout.write(`Review release ${SCENE_ID}@${CURRENT_RELEASE_VERSION} exact bytes, source lock, rights provenance, role measurements, runtime evidence, and REWORK_REQUIRED gates are valid.\n`);
