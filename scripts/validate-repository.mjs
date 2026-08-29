import { readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import validator from "gltf-validator";

import {
  PLATFORM_COMMIT,
  RELEASE_FILES,
  REVIEW_VIEWS,
  RIGHTS_ALLOWED_USES,
  RIGHTS_APPROVAL_STATUS,
  RIGHTS_APPROVED_ON,
  RIGHTS_LICENSE_REF,
  SCENE_ID,
  VERSION,
  assert,
  canonicalSha256,
  fileRecord,
  glbStats,
  readJson,
  toRuntimePosition,
  webpDimensions
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const manifestOnly = process.argv.includes("--manifest-only");
const config = await readJson(join(root, "scene-repository.json"));
const manifest = await readJson(join(root, "manifest.json"));
const contract = await readJson(join(root, "source", "scene-contract.json"));
const contractLock = await readJson(join(root, "source", "scene-contract-lock.json"));
const candidateLock = await readJson(join(root, "source", "review-candidate-lock.json"));
const assetLedger = await readJson(join(root, "provenance", "asset-ledger.json"));
const generationLedger = await readJson(join(root, "provenance", "generation-ledger.json"));
const releaseLedger = await readJson(join(root, "provenance", "release-artifact-ledger.json"));
const validatorLock = (await readFile(join(root, "platform-validator.lock"), "utf8")).trim();
const release = manifest.releases?.[0];
const releaseDir = join(root, `assets/scenes/${SCENE_ID}/${VERSION}`);
const scene = await readJson(join(releaseDir, "scene.json"));

assert(config.oneSceneOnly === true && config.sceneId === SCENE_ID, "invalid_repository_identity");
assert(config.repository === `vrata-labs/${SCENE_ID}`, "repository_name_mismatch");
assert(config.releaseStatus === "review" && config.visualAcceptanceStatus === "pending-human-acceptance" && config.rightsApprovalStatus === RIGHTS_APPROVAL_STATUS && config.rightsApproved === true && config.publicationReady === false, "invalid_repository_gate_state");
assert(validatorLock === PLATFORM_COMMIT && config.platformValidatorCommit === PLATFORM_COMMIT, "platform_validator_lock_mismatch");
assert(/^[0-9a-f]{40}$/.test(validatorLock), "invalid_platform_validator_sha");
assert(manifest.sceneId === SCENE_ID && manifest.platformValidatorCommit === PLATFORM_COMMIT, "invalid_root_manifest_identity");
assert(manifest.blenderVersion === "4.5.12 LTS" && manifest.blenderBuildHash === "84afd5f785f7", "invalid_blender_lock");
assert(manifest.status === "review" && manifest.acceptanceStatus === "pending-human-acceptance" && manifest.visualAcceptanceStatus === "pending-human-acceptance" && manifest.rightsApprovalStatus === RIGHTS_APPROVAL_STATUS && manifest.rightsApproved === true && manifest.publicationReady === false, "invalid_manifest_review_state");
assert(manifest.releases.length === 1 && release.version === VERSION, "invalid_release_set");
assert(release.status === "review" && release.acceptanceStatus === "pending-human-acceptance" && release.visualAcceptanceStatus === "pending-human-acceptance" && release.rightsApprovalStatus === RIGHTS_APPROVAL_STATUS && release.rightsApproved === true && release.isCurrent === false && release.publicationReady === false, "invalid_release_state");
assert(release.releasePath === `assets/scenes/${SCENE_ID}/${VERSION}`, "invalid_release_path");

const releaseEntries = (await readdir(releaseDir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
assert(JSON.stringify(releaseEntries) === JSON.stringify(RELEASE_FILES), `invalid_release_files:${releaseEntries.join(",")}`);
for (const name of RELEASE_FILES) {
  const actual = await fileRecord(join(releaseDir, name));
  assert(JSON.stringify(actual) === JSON.stringify(release.files[name]), `release_file_hash_or_size_drift:${name}`);
}

assert(scene.schemaVersion === 1 && scene.sceneId === SCENE_ID && scene.version === VERSION, "invalid_scene_manifest_identity");
assert(scene.status === "review" && scene.acceptanceStatus === "pending-human-acceptance" && scene.visualAcceptanceStatus === "pending-human-acceptance" && scene.rightsApprovalStatus === RIGHTS_APPROVAL_STATUS && scene.rightsApproved === true && scene.publicationReady === false, "invalid_scene_review_state");
assert(scene.rights.license === RIGHTS_LICENSE_REF && scene.rights.approvalStatus === RIGHTS_APPROVAL_STATUS && scene.rights.rightsApproved === true && scene.rights.approvedOn === RIGHTS_APPROVED_ON && scene.rights.approvedBy === "human-rights-owner", "invalid_scene_rights_verdict");
assert(JSON.stringify(scene.rights.clearedFor) === JSON.stringify(RIGHTS_ALLOWED_USES), "invalid_scene_rights_scope");
assert(scene.glbPath === "scene.glb" && scene.preview === "preview.webp", "unsafe_or_missing_relative_asset_path");
assert(scene.renderMode === "clean", "invalid_scene_render_mode");
assert(!Object.values(scene).some((value) => typeof value === "string" && /(^\/|^[A-Za-z]:[\\/]|\.\.)/.test(value)), "private_or_unsafe_scene_path");
assert(scene.spawnPoints.length === 1 && scene.spawnPoints[0].id === "main", "invalid_main_spawn");
assert(JSON.stringify(scene.spawnPoints[0].position) === JSON.stringify(toRuntimePosition(contract.spawn.position)), "spawn_coordinate_adapter_drift");
assert(scene.anchors.seatAnchors.length === 1 && scene.anchors.seatAnchors[0].id === "owner-desk-seat", "invalid_owner_seat_contract");
assert(JSON.stringify(scene.anchors.seatAnchors[0].position) === JSON.stringify(toRuntimePosition(contract.seats[0].position)), "seat_coordinate_adapter_drift");
assert(contract.mediaSurfaces.length === 1, "invalid_canonical_workspace_surface_count");
const contractSurface = contract.mediaSurfaces[0];
const legacySurfaceKeys = ["allowedObjectTypes", "heightM", "heightPx", "kind", "label", "surfaceId", "transform", "visible", "widthM", "widthPx"];
assert(JSON.stringify(Object.keys(contractSurface).sort()) === JSON.stringify(legacySurfaceKeys), "invalid_canonical_workspace_surface_shape");
assert(contractSurface.surfaceId === "workspace-main" && contractSurface.label === "Personal workspace" && contractSurface.kind === "wall", "invalid_canonical_workspace_surface_identity");
assert(contractSurface.widthPx === 1920 && contractSurface.heightPx === 1080 && contractSurface.visible === true, "invalid_canonical_workspace_surface_properties");
assert(JSON.stringify(contractSurface.allowedObjectTypes) === JSON.stringify(["markdown-board", "image-viewer", "video-player"]), "invalid_canonical_workspace_surface_object_types");
assert(["x", "y", "z", "yaw", "pitch", "roll"].every((key) => Number.isFinite(contractSurface.transform[key])), "invalid_canonical_workspace_surface_transform");
const expectedRuntimeSurface = {
  surfaceId: contractSurface.surfaceId,
  label: contractSurface.label,
  kind: contractSurface.kind,
  widthM: contractSurface.widthM,
  heightM: contractSurface.heightM,
  widthPx: contractSurface.widthPx,
  heightPx: contractSurface.heightPx,
  transform: {
    ...toRuntimePosition(contractSurface.transform),
    yaw: contractSurface.transform.yaw,
    pitch: contractSurface.transform.pitch,
    roll: contractSurface.transform.roll
  },
  visible: contractSurface.visible,
  allowedObjectTypes: contractSurface.allowedObjectTypes
};
assert(scene.mediaSurfaces.length === 1 && JSON.stringify(scene.mediaSurfaces[0]) === JSON.stringify(expectedRuntimeSurface), "invalid_workspace_surface_contract");
assert(!["input", "representation", "position", "pixelDimensions", "frontFace"].some((key) => key in scene.mediaSurfaces[0]), "f3_workspace_surface_fields_forbidden");
assert(contract.visualDirection.audienceLayout === false && contract.seats.length <= 1, "shared_audience_layout_forbidden");
assert(contractLock.contractCanonicalSha256 === canonicalSha256(contract), "canonical_contract_hash_drift");
assert(contractLock.coordinateAdapter === "x=x,y=y,z=-z", "coordinate_adapter_lock_drift");
assert(contractLock.status === "review" && contractLock.acceptanceStatus === "pending-human-acceptance", "invalid_contract_lock_state");
assert(contract.boundaries.humanVisualAccepted === false && contract.boundaries.humanRightsAccepted === true && contract.boundaries.rightsApprovalStatus === RIGHTS_APPROVAL_STATUS && contract.boundaries.rightsApprovedOn === RIGHTS_APPROVED_ON && contract.boundaries.publicStagingRightsApproved === true && contract.boundaries.publicationReady === false, "invalid_contract_boundaries");
assert(contractLock.boundaries.contractLockedForReview === true && JSON.stringify(contractLock.boundaries) === JSON.stringify({ contractLockedForReview: true, humanVisualAccepted: false, humanRightsAccepted: true, rightsApprovalStatus: RIGHTS_APPROVAL_STATUS, rightsApprovedOn: RIGHTS_APPROVED_ON, publicStagingRightsApproved: true, publicationReady: false }), "invalid_contract_lock_boundaries");
assert(candidateLock.status === "pending-human-acceptance" && candidateLock.release.status === "review", "invalid_candidate_lock_state");
assert(candidateLock.humanGates.visual === "pending-human-acceptance" && candidateLock.humanGates.rights === RIGHTS_APPROVAL_STATUS && candidateLock.humanGates.rightsApproved === true && candidateLock.humanGates.rightsApprovedOn === RIGHTS_APPROVED_ON, "invalid_candidate_human_gates");
assert(candidateLock.release.publicationReady === false && releaseLedger.publicationReady === false, "publication_must_remain_blocked");
assert(releaseLedger.releaseStatus === "review" && releaseLedger.visualAcceptanceStatus === "pending-human-acceptance" && releaseLedger.rightsApprovalStatus === RIGHTS_APPROVAL_STATUS && releaseLedger.rightsApproved === true, "invalid_release_ledger_gate_state");
assert(releaseLedger.rights.decision === RIGHTS_APPROVAL_STATUS && releaseLedger.rights.rightsApproved === true && releaseLedger.rights.approvedOn === RIGHTS_APPROVED_ON && releaseLedger.rights.productionActivation === false && releaseLedger.rights.humanVisualAccepted === false && releaseLedger.rights.publicationReady === false, "invalid_release_rights_verdict");
assert(JSON.stringify(releaseLedger.rights.allowedUses) === JSON.stringify(RIGHTS_ALLOWED_USES), "invalid_release_rights_scope");
assert(assetLedger.rightsVerdict.decision === RIGHTS_APPROVAL_STATUS && assetLedger.rightsVerdict.rightsApproved === true && assetLedger.rightsVerdict.approvedOn === RIGHTS_APPROVED_ON && assetLedger.rightsVerdict.licenseRef.endsWith("project-authored-public-staging-review.txt"), "invalid_asset_rights_verdict");
assert(assetLedger.records.every((record) => record.approvalStatus === RIGHTS_APPROVAL_STATUS && record.licenseRef === assetLedger.rightsVerdict.licenseRef), "invalid_asset_record_rights");
assert(generationLedger.humanAcceptance === "pending-human-acceptance" && generationLedger.rightsApproval.status === RIGHTS_APPROVAL_STATUS && generationLedger.rightsApproval.rightsApproved === true && generationLedger.rightsApproval.productionActivation === false && generationLedger.rightsApproval.humanVisualAccepted === false && generationLedger.rightsApproval.publicationReady === false, "invalid_generation_rights_state");
const releaseLicense = await readFile(join(releaseDir, "LICENSES.md"), "utf8");
const provenanceLicense = await readFile(join(root, "provenance", "licenses", "project-authored-public-staging-review.txt"), "utf8");
for (const licenseText of [releaseLicense, provenanceLicense]) {
  assert(licenseText.includes(RIGHTS_LICENSE_REF) && licenseText.includes(RIGHTS_APPROVAL_STATUS) && licenseText.includes(RIGHTS_APPROVED_ON), "incomplete_rights_license_record");
  assert(licenseText.includes("does not grant human visual acceptance") && licenseText.includes("production") && licenseText.includes("publicationReady=false"), "missing_rights_license_limits");
}

for (const view of REVIEW_VIEWS) {
  const path = join(root, "source", "review", `${view}.webp`);
  const actual = await fileRecord(path);
  const locked = candidateLock.reviewViews.find(({ id }) => id === view);
  assert(locked && actual.sha256 === locked.sha256 && actual.sizeBytes === locked.sizeBytes, `review_view_drift:${view}`);
  const dimensions = webpDimensions(await readFile(path));
  assert(dimensions.width === 960 && dimensions.height === 540, `invalid_review_dimensions:${view}:${dimensions.width}x${dimensions.height}`);
}
assert((await fileRecord(join(releaseDir, "preview.webp"))).sha256 === (await fileRecord(join(root, "source", "review", "entry.webp"))).sha256, "preview_must_equal_entry_view");

if (!manifestOnly) {
  const glbPath = join(releaseDir, "scene.glb");
  const glbBytes = await readFile(glbPath);
  const report = await validator.validateBytes(new Uint8Array(glbBytes), { uri: `${SCENE_ID}@${VERSION}/scene.glb`, maxIssues: 200 });
  assert(report.issues.numErrors === 0, `khronos_gltf_validation_errors:${report.issues.numErrors}`);
  const stats = await glbStats(glbPath);
  assert(JSON.stringify(stats) === JSON.stringify(release.stats), "release_stats_drift");
  assert(stats.scenes === 1, `one_gltf_scene_required:${stats.scenes}`);
  assert(glbBytes.length <= contract.budgets.glbBytesMax, `glb_budget_exceeded:${glbBytes.length}`);
  assert(stats.triangles <= contract.budgets.trianglesMax, `triangle_budget_exceeded:${stats.triangles}`);
  assert(stats.objects <= contract.budgets.objectsMax, `object_budget_exceeded:${stats.objects}`);
  assert(stats.meshes <= contract.budgets.meshesMax, `mesh_budget_exceeded:${stats.meshes}`);
  assert(stats.materials <= contract.budgets.materialsMax, `material_budget_exceeded:${stats.materials}`);
  assert(stats.textures <= contract.budgets.texturesMax, `texture_budget_exceeded:${stats.textures}`);
  assert(candidateLock.reproducibility.result === "byte-identical-glb" && candidateLock.reproducibility.sha256 === release.files["scene.glb"].sha256, "reproducibility_lock_drift");
}

process.stdout.write(`Scene repository is valid (${basename(releaseDir)} ${manifestOnly ? "manifest" : "full"} review check).\n`);
