import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  PLATFORM_COMMIT,
  RIGHTS_ALLOWED_USES,
  RIGHTS_APPROVAL_STATUS,
  RIGHTS_APPROVED_ON,
  RIGHTS_LICENSE_REF,
  REVIEW_VIEWS,
  SCENE_ID,
  VERSION,
  canonicalSha256,
  fileRecord,
  glbStats,
  hashFile,
  readJson,
  toRuntimePosition
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const blender = process.env.BLENDER_BIN?.trim() || "blender";
const cwebp = process.env.CWEBP_BIN ?? "cwebp";
const sourceDir = join(root, "source");
const buildDir = join(root, "build");
const authorPngDir = join(buildDir, "author-review-png");
const reviewPngDir = join(buildDir, "review-png");
const reviewDir = join(sourceDir, "review");
const blendPath = join(sourceDir, "review-candidate.blend");
const releaseDir = join(root, "assets", "scenes", SCENE_ID, VERSION);
const firstGlb = join(buildDir, "scene.first.glb");
const secondGlb = join(buildDir, "scene.second.glb");

function run(command, args, code) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${code}:${result.status}`);
}

function runText(command, args, code) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${code}:${result.status}:${result.stderr}`);
  return result.stdout.trim();
}

function requireBlender() {
  const result = spawnSync(blender, ["--version"], { cwd: root, encoding: "utf8" });
  if (result.error?.code === "ENOENT") {
    throw new Error("blender_not_found: set BLENDER_BIN=/path/to/blender or install blender on PATH");
  }
  if (result.error || result.status !== 0) {
    throw new Error(`blender_unavailable: set BLENDER_BIN=/path/to/blender or provide a working blender on PATH (${result.error?.message ?? result.stderr?.trim() ?? result.status})`);
  }
  return result.stdout.trim().split("\n")[0];
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function exportSavedBlend(output) {
  run(blender, [
    "--background",
    blendPath,
    "--python",
    join(sourceDir, "export_scene.py"),
    "--",
    "--output",
    output
  ], "saved_blend_export_failed");
}

const blenderVersion = requireBlender();
await rm(buildDir, { recursive: true, force: true });
await mkdir(authorPngDir, { recursive: true });
await mkdir(reviewPngDir, { recursive: true });
await mkdir(reviewDir, { recursive: true });
await mkdir(releaseDir, { recursive: true });

run(blender, [
  "--background",
  "--factory-startup",
  "--python",
  join(sourceDir, "author_scene.py"),
  "--",
  "--blend-output",
  blendPath,
  "--review-output-dir",
  authorPngDir,
  "--glb-output",
  join(buildDir, "author-session.glb")
], "scene_authoring_failed");

run(blender, [
  "--background",
  blendPath,
  "--python",
  join(sourceDir, "render_review.py"),
  "--",
  "--output-dir",
  reviewPngDir
], "saved_blend_review_failed");

for (const view of REVIEW_VIEWS) {
  run(cwebp, ["-quiet", "-q", "90", join(reviewPngDir, `${view}.png`), "-o", join(reviewDir, `${view}.webp`)], `cwebp_failed:${view}`);
}

await exportSavedBlend(firstGlb);
await exportSavedBlend(secondGlb);
const firstHash = await hashFile(firstGlb);
const secondHash = await hashFile(secondGlb);
if (firstHash !== secondHash) throw new Error(`same_host_two_run_mismatch:${firstHash}:${secondHash}`);

const releaseGlbPath = join(releaseDir, "scene.glb");
const previewPath = join(releaseDir, "preview.webp");
await copyFile(firstGlb, releaseGlbPath);
await copyFile(join(reviewDir, "entry.webp"), previewPath);

const licenseText = `# Personal Workspace v1 Candidate Asset Notice\n\nAll geometry, materials, composition, source code, and review imagery were authored specifically for Vrata. The GLB contains no downloaded assets, external references, branding, private third-party material, or image-to-3D output.\n\nLicense reference: ${RIGHTS_LICENSE_REF}.\n\nHuman rights owner verdict recorded on ${RIGHTS_APPROVED_ON}: ${RIGHTS_APPROVAL_STATUS}.\n\nAllowed uses: staging, public web runtime, screenshots, optimization, derivative builds, and redistribution in a publicly downloadable scene bundle.\n\nThis rights approval does not grant human visual acceptance, activate the scene in production, make the release current, or mark it publication-ready. The release remains in review with visual acceptance pending-human-acceptance and publicationReady=false.\n`;
await writeFile(join(releaseDir, "LICENSES.md"), licenseText);

const contract = await readJson(join(sourceDir, "scene-contract.json"));
const sceneManifest = {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  version: VERSION,
  label: "Personal Workspace",
  source: "Vrata project-authored Blender source",
  status: "review",
  acceptanceStatus: "pending-human-acceptance",
  visualAcceptanceStatus: "pending-human-acceptance",
  rightsApprovalStatus: RIGHTS_APPROVAL_STATUS,
  rightsApproved: true,
  publicationReady: false,
  glbPath: "scene.glb",
  renderMode: "clean",
  spawnPoints: [{
    id: contract.spawn.id,
    position: toRuntimePosition(contract.spawn.position),
    openRadiusM: contract.spawn.openRadiusM
  }],
  bounds: {
    width: contract.room.widthM,
    height: contract.room.heightM,
    depth: contract.room.depthM
  },
  anchors: {
    teleportFloorY: 0,
    seatAnchors: contract.seats.map((seat) => ({
      id: seat.id,
      role: seat.role,
      position: toRuntimePosition(seat.position),
      yaw: seat.yaw,
      seatHeight: seat.seatHeight,
      radius: seat.radius
    }))
  },
  mediaSurfaces: contract.mediaSurfaces.map((surface) => ({
    surfaceId: surface.surfaceId,
    label: surface.label,
    kind: surface.kind,
    widthM: surface.widthM,
    heightM: surface.heightM,
    widthPx: surface.widthPx,
    heightPx: surface.heightPx,
    transform: {
      ...toRuntimePosition(surface.transform),
      yaw: surface.transform.yaw,
      pitch: surface.transform.pitch,
      roll: surface.transform.roll
    },
    visible: surface.visible,
    allowedObjectTypes: surface.allowedObjectTypes
  })),
  preview: "preview.webp",
  visual: { intentionalDark: false },
  rights: {
    owner: "vrata",
    license: RIGHTS_LICENSE_REF,
    approvalStatus: RIGHTS_APPROVAL_STATUS,
    rightsApproved: true,
    approvedOn: RIGHTS_APPROVED_ON,
    approvedBy: "human-rights-owner",
    clearedFor: RIGHTS_ALLOWED_USES,
    sourceAssets: [
      { id: "scene-geometry", type: "mesh", author: "Vrata project team", licenseRef: "LICENSES.md" },
      { id: "scene-materials", type: "material", author: "Vrata project team", licenseRef: "LICENSES.md" },
      { id: "review-imagery", type: "image", author: "Vrata project team", licenseRef: "LICENSES.md" }
    ]
  },
  notes: "Review candidate with rights approved for public staging review; human visual acceptance remains pending and production activation/publication readiness remain false."
};
await writeJson(join(releaseDir, "scene.json"), sceneManifest);

const stats = await glbStats(releaseGlbPath);
const releaseFiles = Object.fromEntries(await Promise.all(
  ["scene.json", "scene.glb", "preview.webp", "LICENSES.md"].map(async (name) => [name, await fileRecord(join(releaseDir, name))])
));
const scriptFiles = ["author_scene.py", "export_scene.py", "render_review.py"];
const sourceRecords = await Promise.all([
  ["scene-contract", "source/scene-contract.json"],
  ...scriptFiles.map((name) => [`scene-script-${name.replace(/[_\.]/g, "-")}`, `source/${name}`])
].map(async ([id, path]) => ({
  id,
  kind: "project-authored-source",
  repositoryPath: path,
  sha256: (await fileRecord(join(root, path))).sha256,
  externalSource: null,
  licenseRef: "provenance/licenses/project-authored-public-staging-review.txt",
  approvalStatus: RIGHTS_APPROVAL_STATUS
})));

const cwebpVersion = runText(cwebp, ["-version"], "cwebp_version_failed").split("\n")[0];
const reviewRecords = Object.fromEntries(await Promise.all(
  REVIEW_VIEWS.map(async (id) => [id, await fileRecord(join(reviewDir, `${id}.webp`))])
));
const blendRecord = await fileRecord(blendPath);

await writeJson(join(root, "provenance", "asset-ledger.json"), {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  status: "review",
  acceptanceStatus: "pending-human-acceptance",
  records: sourceRecords,
  externalAssetCount: 0,
  downloadedAssetCount: 0,
  rightsVerdict: {
    decision: RIGHTS_APPROVAL_STATUS,
    rightsApproved: true,
    approvedOn: RIGHTS_APPROVED_ON,
    approvedBy: "human-rights-owner",
    licenseRef: "provenance/licenses/project-authored-public-staging-review.txt",
    allowedUses: RIGHTS_ALLOWED_USES,
    productionActivation: false,
    humanVisualAccepted: false,
    publicationReady: false
  },
  boundaries: { projectAuthoredOnly: true, humanVisualAccepted: false, humanRightsAccepted: true, publicStagingRightsApproved: true, publicationReady: false }
});

await writeJson(join(root, "provenance", "generation-ledger.json"), {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  status: "review",
  operation: "deterministic-scene-specific-blender-authoring-and-export",
  toolchain: {
    blenderVersion,
    blenderBuildHash: "84afd5f785f7",
    blenderBinarySha256: await hashFile(blender),
    cwebpVersion,
    cwebpQuality: 90,
    platformValidatorCommit: PLATFORM_COMMIT
  },
  sourceBlend: { path: "source/review-candidate.blend", ...blendRecord },
  outputs: {
    releaseGlb: { path: `assets/scenes/${SCENE_ID}/${VERSION}/scene.glb`, ...releaseFiles["scene.glb"] },
    reviewViews: REVIEW_VIEWS.map((id) => ({ id, path: `source/review/${id}.webp`, ...reviewRecords[id] }))
  },
  reproducibility: {
    scope: "same-host-same-saved-blend-same-blender-binary-two-run",
    runs: 2,
    result: "byte-identical-glb",
    sha256: firstHash
  },
  humanAcceptance: "pending-human-acceptance",
  rightsApproval: {
    status: RIGHTS_APPROVAL_STATUS,
    rightsApproved: true,
    approvedOn: RIGHTS_APPROVED_ON,
    licenseRef: "provenance/licenses/project-authored-public-staging-review.txt",
    allowedUses: RIGHTS_ALLOWED_USES,
    productionActivation: false,
    humanVisualAccepted: false,
    publicationReady: false
  }
});

await writeJson(join(root, "provenance", "release-artifact-ledger.json"), {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  releaseVersion: VERSION,
  releaseStatus: "review",
  acceptanceStatus: "pending-human-acceptance",
  visualAcceptanceStatus: "pending-human-acceptance",
  rightsApprovalStatus: RIGHTS_APPROVAL_STATUS,
  rightsApproved: true,
  publicationReady: false,
  files: releaseFiles,
  stats,
  rights: {
    externalAssets: 0,
    originRecord: "provenance/asset-ledger.json",
    licenseRef: "provenance/licenses/project-authored-public-staging-review.txt",
    decision: RIGHTS_APPROVAL_STATUS,
    rightsApproved: true,
    approvedOn: RIGHTS_APPROVED_ON,
    approvedBy: "human-rights-owner",
    allowedUses: RIGHTS_ALLOWED_USES,
    productionActivation: false,
    humanVisualAccepted: false,
    publicationReady: false
  }
});

await writeJson(join(sourceDir, "scene-contract-lock.json"), {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  status: "review",
  acceptanceStatus: "pending-human-acceptance",
  platformValidatorCommit: PLATFORM_COMMIT,
  contractCanonicalSha256: canonicalSha256(contract),
  contractFileSha256: (await fileRecord(join(sourceDir, "scene-contract.json"))).sha256,
  coordinateAdapter: "x=x,y=y,z=-z",
  budgets: contract.budgets,
  boundaries: {
    contractLockedForReview: true,
    humanVisualAccepted: false,
    humanRightsAccepted: true,
    rightsApprovalStatus: RIGHTS_APPROVAL_STATUS,
    rightsApprovedOn: RIGHTS_APPROVED_ON,
    publicStagingRightsApproved: true,
    publicationReady: false
  }
});

await writeJson(join(sourceDir, "review-candidate-lock.json"), {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  version: VERSION,
  status: "pending-human-acceptance",
  source: {
    blendPath: "source/review-candidate.blend",
    ...blendRecord,
    scripts: Object.fromEntries(await Promise.all(scriptFiles.map(async (name) => [name, await fileRecord(join(sourceDir, name))])))
  },
  reviewViews: REVIEW_VIEWS.map((id) => ({ id, path: `source/review/${id}.webp`, ...reviewRecords[id] })),
  release: {
    path: `assets/scenes/${SCENE_ID}/${VERSION}`,
    status: "review",
    acceptanceStatus: "pending-human-acceptance",
    visualAcceptanceStatus: "pending-human-acceptance",
    rightsApprovalStatus: RIGHTS_APPROVAL_STATUS,
    rightsApproved: true,
    publicationReady: false,
    files: releaseFiles,
    stats
  },
  runtimeCoordinates: {
    transform: "x=x,y=y,z=-z",
    appliedTo: ["spawn:main", "seat:owner-desk-seat", "media-surface:workspace-main"]
  },
  reproducibility: {
    scope: "same-host-same-saved-blend-same-blender-binary-two-run",
    runs: 2,
    result: "byte-identical-glb",
    sha256: firstHash
  },
  humanGates: {
    visual: "pending-human-acceptance",
    rights: RIGHTS_APPROVAL_STATUS,
    rightsApproved: true,
    rightsApprovedOn: RIGHTS_APPROVED_ON
  }
});

await writeJson(join(root, "manifest.json"), {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  blenderVersion: "4.5.12 LTS",
  blenderBuildHash: "84afd5f785f7",
  platformValidatorCommit: PLATFORM_COMMIT,
  status: "review",
  acceptanceStatus: "pending-human-acceptance",
  visualAcceptanceStatus: "pending-human-acceptance",
  rightsApprovalStatus: RIGHTS_APPROVAL_STATUS,
  rightsApproved: true,
  publicationReady: false,
  releases: [{
    sceneId: SCENE_ID,
    version: VERSION,
    releasePath: `assets/scenes/${SCENE_ID}/${VERSION}`,
    status: "review",
    acceptanceStatus: "pending-human-acceptance",
    visualAcceptanceStatus: "pending-human-acceptance",
    rightsApprovalStatus: RIGHTS_APPROVAL_STATUS,
    rightsApproved: true,
    isCurrent: false,
    publicationReady: false,
    files: releaseFiles,
    stats
  }]
});

process.stdout.write(`Built ${SCENE_ID}@${VERSION}\nGLB SHA-256 ${firstHash}\nStats ${JSON.stringify(stats)}\n`);
