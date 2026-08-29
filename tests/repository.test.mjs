import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { RELEASE_FILES, REVIEW_VIEWS, RIGHTS_ALLOWED_USES, RIGHTS_APPROVAL_STATUS, RIGHTS_APPROVED_ON, RIGHTS_LICENSE_REF, SCENE_ID, VERSION, canonicalSha256, fileRecord, readJson, toRuntimePosition, webpDimensions } from "../scripts/lib.mjs";

const root = resolve(import.meta.dirname, "..");

test("coordinate adapter reflects semantic z exactly once", () => {
  assert.deepEqual(toRuntimePosition({ x: 1.25, y: 0.4, z: -2.5 }), { x: 1.25, y: 0.4, z: 2.5 });
  assert.deepEqual(toRuntimePosition({ x: -1, y: 0, z: 2 }), { x: -1, y: 0, z: -2 });
});

test("Blender scripts fail clearly when neither BLENDER_BIN nor PATH resolves Blender", () => {
  for (const script of ["scripts/build-candidate.mjs", "scripts/verify-reproducibility.mjs"]) {
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, BLENDER_BIN: "vrata-missing-blender-executable" }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /blender_not_found: set BLENDER_BIN=\/path\/to\/blender or install blender on PATH/);
  }
});

test("canonical contract defines a private workspace without audience seating", async () => {
  const contract = await readJson(join(root, "source", "scene-contract.json"));
  assert.equal(contract.sceneId, SCENE_ID);
  assert.equal(contract.status, "review");
  assert.equal(contract.acceptanceStatus, "pending-human-acceptance");
  assert.equal(contract.spawn.id, "main");
  assert.deepEqual(contract.mediaSurfaces, [{
    surfaceId: "workspace-main",
    label: "Personal workspace",
    kind: "wall",
    widthM: 1.72,
    heightM: 0.97,
    widthPx: 1920,
    heightPx: 1080,
    transform: { x: -1.08, y: 1.56, z: 2.43, yaw: 0, pitch: 0, roll: 0 },
    visible: true,
    allowedObjectTypes: ["markdown-board", "image-viewer", "video-player"]
  }]);
  assert.deepEqual(contract.seats.map(({ id }) => id), ["owner-desk-seat"]);
  assert.equal(contract.visualDirection.audienceLayout, false);
  assert.equal(contract.boundaries.humanVisualAccepted, false);
  assert.equal(contract.boundaries.humanRightsAccepted, true);
  assert.equal(contract.boundaries.rightsApprovalStatus, RIGHTS_APPROVAL_STATUS);
  assert.equal(contract.boundaries.rightsApprovedOn, RIGHTS_APPROVED_ON);
  assert.equal(contract.boundaries.publicStagingRightsApproved, true);
  assert.equal(contract.boundaries.publicationReady, false);
});

test("release manifest derives all semantic positions through the coordinate adapter", async () => {
  const contract = await readJson(join(root, "source", "scene-contract.json"));
  const scene = await readJson(join(root, "assets", "scenes", SCENE_ID, VERSION, "scene.json"));
  assert.deepEqual(scene.spawnPoints[0].position, toRuntimePosition(contract.spawn.position));
  assert.deepEqual(scene.anchors.seatAnchors[0].position, toRuntimePosition(contract.seats[0].position));
  assert.deepEqual(scene.mediaSurfaces[0].transform, {
    ...toRuntimePosition(contract.mediaSurfaces[0].transform),
    yaw: contract.mediaSurfaces[0].transform.yaw,
    pitch: contract.mediaSurfaces[0].transform.pitch,
    roll: contract.mediaSurfaces[0].transform.roll
  });
});

test("release manifest uses the exact legacy workspace surface contract and clean mode", async () => {
  const scene = await readJson(join(root, "assets", "scenes", SCENE_ID, VERSION, "scene.json"));
  assert.equal(scene.renderMode, "clean");
  assert.deepEqual(scene.mediaSurfaces, [{
    surfaceId: "workspace-main",
    label: "Personal workspace",
    kind: "wall",
    widthM: 1.72,
    heightM: 0.97,
    widthPx: 1920,
    heightPx: 1080,
    transform: { x: -1.08, y: 1.56, z: -2.43, yaw: 0, pitch: 0, roll: 0 },
    visible: true,
    allowedObjectTypes: ["markdown-board", "image-viewer", "video-player"]
  }]);
  for (const field of ["input", "representation", "position", "pixelDimensions", "frontFace"]) {
    assert.equal(field in scene.mediaSurfaces[0], false, `${field} must not trigger the F3 media-surface contract`);
  }
});

test("release stays review-only with visual acceptance pending and staging rights approved", async () => {
  const [manifest, contractLock, candidateLock, assetLedger, generationLedger, releaseLedger, scene] = await Promise.all([
    readJson(join(root, "manifest.json")),
    readJson(join(root, "source", "scene-contract-lock.json")),
    readJson(join(root, "source", "review-candidate-lock.json")),
    readJson(join(root, "provenance", "asset-ledger.json")),
    readJson(join(root, "provenance", "generation-ledger.json")),
    readJson(join(root, "provenance", "release-artifact-ledger.json")),
    readJson(join(root, "assets", "scenes", SCENE_ID, VERSION, "scene.json"))
  ]);
  assert.equal(manifest.status, "review");
  assert.equal(manifest.acceptanceStatus, "pending-human-acceptance");
  assert.equal(manifest.visualAcceptanceStatus, "pending-human-acceptance");
  assert.equal(manifest.rightsApprovalStatus, RIGHTS_APPROVAL_STATUS);
  assert.equal(manifest.rightsApproved, true);
  assert.equal(manifest.publicationReady, false);
  assert.equal(manifest.releases[0].isCurrent, false);
  assert.equal(contractLock.acceptanceStatus, "pending-human-acceptance");
  assert.deepEqual(candidateLock.humanGates, { visual: "pending-human-acceptance", rights: RIGHTS_APPROVAL_STATUS, rightsApproved: true, rightsApprovedOn: RIGHTS_APPROVED_ON });
  assert.equal(assetLedger.rightsVerdict.decision, RIGHTS_APPROVAL_STATUS);
  assert.equal(generationLedger.rightsApproval.status, RIGHTS_APPROVAL_STATUS);
  assert.equal(releaseLedger.rights.decision, RIGHTS_APPROVAL_STATUS);
  assert.equal(scene.rights.license, RIGHTS_LICENSE_REF);
  assert.deepEqual(scene.rights.clearedFor, RIGHTS_ALLOWED_USES);
  assert.equal(scene.rights.rightsApproved, true);
  assert.equal(scene.rights.approvedOn, RIGHTS_APPROVED_ON);
  assert.equal(releaseLedger.rights.productionActivation, false);
  assert.equal(releaseLedger.rights.humanVisualAccepted, false);
  assert.equal(releaseLedger.publicationReady, false);
});

test("one release directory contains exactly four hash-locked files", async () => {
  const manifest = await readJson(join(root, "manifest.json"));
  const sceneRoot = join(root, "assets", "scenes", SCENE_ID);
  assert.deepEqual((await readdir(join(root, "assets", "scenes"))).sort(), [SCENE_ID]);
  assert.deepEqual((await readdir(sceneRoot)).sort(), [VERSION]);
  assert.deepEqual((await readdir(join(sceneRoot, VERSION))).sort(), RELEASE_FILES);
  for (const name of RELEASE_FILES) {
    assert.deepEqual(await fileRecord(join(sceneRoot, VERSION, name)), manifest.releases[0].files[name]);
  }
});

test("contract lock and four review images are canonical and exact", async () => {
  const contract = await readJson(join(root, "source", "scene-contract.json"));
  const lock = await readJson(join(root, "source", "scene-contract-lock.json"));
  const candidate = await readJson(join(root, "source", "review-candidate-lock.json"));
  assert.equal(lock.contractCanonicalSha256, canonicalSha256(contract));
  assert.deepEqual(candidate.reviewViews.map(({ id }) => id), REVIEW_VIEWS);
  for (const view of REVIEW_VIEWS) {
    const bytes = await readFile(join(root, "source", "review", `${view}.webp`));
    assert.deepEqual(webpDimensions(bytes), { width: 960, height: 540 });
  }
});
