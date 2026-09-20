import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import validator from "gltf-validator";

import {
  BLENDER_BINARY_SHA256,
  BLENDER_BUILD_HASH,
  BLENDER_VERSION,
  SCENE_ID,
  assert,
  fileRecord,
  glbStats,
  glbTextureRecords,
  pathTrackedInGit,
  readJson
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
  CURRENT_STATS
} from "./release-0.4.0.mjs";

const root = resolve(import.meta.dirname, "..");
const sourceDir = join(root, CURRENT_SOURCE_PATH);
const provenanceDir = join(root, CURRENT_PROVENANCE_PATH);
const releaseDir = join(root, CURRENT_RELEASE_PATH);
const runtimeDir = join(root, CURRENT_RUNTIME_CAPTURE_PATH);
const sourceLockPath = join(sourceDir, "review-source-lock.json");
const replaceUntracked = process.argv.includes("--replace-untracked");
assert(process.argv.slice(2).every((argument) => argument === "--replace-untracked"), "unknown_evidence_argument");

function posix(path) {
  return path.split(sep).join("/");
}

async function record(repositoryPath) {
  return { path: repositoryPath, ...await fileRecord(join(root, repositoryPath)) };
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(posix(relative(root, path)));
    else throw new Error(`unsupported_source_entry:${posix(relative(root, path))}`);
  }
  return files.sort();
}

async function records(paths) {
  return Promise.all(paths.map(record));
}

async function writeOrVerify(path, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  const existing = await readFile(path, "utf8").catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
  if (existing !== null) {
    if (existing !== bytes) {
      const repositoryPath = posix(relative(root, path));
      assert(replaceUntracked && !pathTrackedInGit(root, repositoryPath), `immutable_evidence_drift:${repositoryPath}`);
      await writeFile(path, bytes);
    }
    return;
  }
  const repositoryPath = posix(relative(root, path));
  assert(!pathTrackedInGit(root, repositoryPath), `tracked_evidence_missing:${repositoryPath}`);
  await writeFile(path, bytes, { flag: "wx" });
}

const releaseFiles = Object.fromEntries(await Promise.all(CURRENT_RELEASE_FILES.map(async (name) => [name, await fileRecord(join(releaseDir, name))])));
const glbPath = join(releaseDir, "scene.glb");
const glbBytes = await readFile(glbPath);
const glbJsonLength = glbBytes.readUInt32LE(12);
const glbJson = JSON.parse(glbBytes.subarray(20, 20 + glbJsonLength).toString("utf8").trimEnd());
const validation = await validator.validateBytes(glbBytes, { maxIssues: 100000 });
const textures = await glbTextureRecords(glbPath);

const glbInventory = {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  releaseVersion: CURRENT_RELEASE_VERSION,
  qualityOutcome: CURRENT_QUALITY_OUTCOME,
  glb: { path: `${CURRENT_RELEASE_PATH}/scene.glb`, ...releaseFiles["scene.glb"] },
  stats: await glbStats(glbPath),
  extensionsUsed: [...(glbJson.extensionsUsed ?? [])].sort(),
  textures,
  validation: {
    tool: "gltf-validator",
    errors: validation.issues.numErrors,
    warnings: validation.issues.numWarnings,
    result: validation.issues.numErrors === 0 && validation.issues.numWarnings === 0 ? "passed" : "failed"
  },
  budgets: {
    glbBytes: { actual: glbBytes.length, maximum: 15728640, withinBudget: glbBytes.length <= 15728640 },
    triangles: { actual: CURRENT_STATS.triangles, maximum: 90000, withinBudget: CURRENT_STATS.triangles <= 90000 },
    meshes: {
      actual: CURRENT_STATS.meshes,
      maximum: 250,
      withinBudget: false,
      disposition: "documented-unapproved-review-exception",
      blocksPublication: true
    },
    materials: { actual: CURRENT_STATS.materials, maximum: 96, withinBudget: CURRENT_STATS.materials <= 96 },
    textures: { actual: CURRENT_STATS.textures, maximum: 48, withinBudget: CURRENT_STATS.textures <= 48 }
  }
};
await writeOrVerify(join(provenanceDir, "glb-inventory.json"), glbInventory);

const qualityDisposition = {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  releaseVersion: CURRENT_RELEASE_VERSION,
  sharedQualityContractCommit: "8ba49739d44518a3e877bc93432be591ce2e72da",
  benchmark: {
    scene: "Warm Modern Meeting Room Candidate 01 0.3.3",
    commit: "5580a7b080cf6195e28ebc77b654fd71111b0cd1"
  },
  inspectedSourceRuntimePairs: CURRENT_REVIEW_VIEWS,
  verdicts: {
    inheritedQualityTarget: "REWORK_REQUIRED",
    sourceToRuntimeFidelity: "REWORK_REQUIRED",
    exactByteRegression: "passed",
    functionalNormalProductChecks: "passed"
  },
  unresolvedDefects: [
    {
      id: "Q1-runtime-material-response",
      evidence: [
        `${CURRENT_RUNTIME_CAPTURE_PATH}/clean/compare-role-views.png`,
        `${CURRENT_RUNTIME_CAPTURE_PATH}/clean/compare-detail-views.png`
      ],
      observation: "Browser wood is materially darker, redder, and more saturated than the paired Cycles source views; fine material response is flattened.",
      blocksReadyForUserReview: true
    },
    {
      id: "Q1-lightmap-seams",
      evidence: [
        `${CURRENT_RUNTIME_CAPTURE_PATH}/clean/compare-detail-views.png`,
        `${CURRENT_RUNTIME_CAPTURE_PATH}/clean/window-near.png`
      ],
      observation: "Visible wall/window and assembly seams remain in browser lighting transfer.",
      blocksReadyForUserReview: true
    },
    {
      id: "technical-mesh-budget",
      evidence: [`${CURRENT_PROVENANCE_PATH}/glb-inventory.json`],
      observation: "The release has 397 meshes against the inherited maximum of 250; no exception is approved.",
      blocksReadyForUserReview: true
    }
  ],
  measuredRoleEvidence: {
    geometry: `${CURRENT_PROVENANCE_PATH}/geometry-measurements.json`,
    support: `${CURRENT_PROVENANCE_PATH}/support-measurements.json`,
    scope: "Automated User/Builder/Physics measurements passed; they do not override unresolved visual defects or human gates."
  },
  humanGates: {
    visual: "pending-human-acceptance",
    rights: "pending-human-rights-approval",
    publicationReady: false,
    isCurrent: false
  }
};
await writeOrVerify(join(provenanceDir, "quality-disposition.json"), qualityDisposition);

const cleanRecords = await records(CURRENT_CLEAN_CAPTURE_FILES.map((name) => `${CURRENT_RUNTIME_CAPTURE_PATH}/clean/${name}`));
const normalRecords = await records(CURRENT_NORMAL_CAPTURE_FILES.map((name) => `${CURRENT_RUNTIME_CAPTURE_PATH}/normal/${name}`));
const [sceneDebug, normalEvidence] = await Promise.all([
  readJson(join(runtimeDir, "clean", "scene-debug.json")),
  readJson(join(runtimeDir, "normal", "normal-product-evidence.json"))
]);
const runtimeCaptureIndex = {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  releaseVersion: CURRENT_RELEASE_VERSION,
  platformCommit: CURRENT_PLATFORM_COMMIT,
  scope: "single-exact-byte-local-clean-and-normal-capture",
  repeatabilityClaim: "not-a-three-run-stability-claim",
  bindings: {
    releaseGlb: { path: `${CURRENT_RELEASE_PATH}/scene.glb`, ...releaseFiles["scene.glb"] },
    releaseManifest: { path: `${CURRENT_RELEASE_PATH}/scene.json`, ...releaseFiles["scene.json"] },
    captureConfig: await record(`${CURRENT_SOURCE_PATH}/capture-config.json`),
    captureHarness: await record(`${CURRENT_SOURCE_PATH}/runtime-harness.spec.ts`)
  },
  clean: {
    path: `${CURRENT_RUNTIME_CAPTURE_PATH}/clean`,
    files: cleanRecords,
    state: sceneDebug.state,
    failureReason: sceneDebug.failureReason,
    missingAssets: sceneDebug.missingAssets,
    assetBytesLoaded: sceneDebug.assetBytesLoaded,
    renderProfile: sceneDebug.renderProfile,
    meshCount: sceneDebug.meshCount,
    materialCount: sceneDebug.materialCount,
    lightMappedMaterialCount: sceneDebug.lightMappedMaterialCount,
    triangleEstimate: sceneDebug.triangleEstimate,
    spawnApplied: sceneDebug.spawnApplied
  },
  normal: {
    path: `${CURRENT_RUNTIME_CAPTURE_PATH}/normal`,
    files: normalRecords,
    platformCommit: normalEvidence.platformCommit,
    manifestSha256: normalEvidence.manifestSha256,
    glbSha256: normalEvidence.glbSha256,
    syntheticReviewPoseUsed: normalEvidence.syntheticReviewPoseUsed,
    verdict: normalEvidence.verdict
  },
  qualityOutcome: CURRENT_QUALITY_OUTCOME,
  humanVisualAcceptance: "pending-human-acceptance",
  humanRightsApproval: "pending-human-rights-approval",
  publicationReady: false
};
await writeOrVerify(join(provenanceDir, "runtime-capture-index.json"), runtimeCaptureIndex);

const sourcePaths = (await walk(sourceDir)).filter((path) => path !== `${CURRENT_SOURCE_PATH}/review-source-lock.json`);
const sourceLock = {
  schemaVersion: 1,
  status: "review-source-lock",
  sceneId: SCENE_ID,
  releaseVersion: CURRENT_RELEASE_VERSION,
  qualityOutcome: CURRENT_QUALITY_OUTCOME,
  sourceFiles: await records(sourcePaths),
  toolchain: {
    blenderVersion: BLENDER_VERSION,
    blenderBuildHash: BLENDER_BUILD_HASH,
    blenderBinarySha256: BLENDER_BINARY_SHA256,
    gltfExporter: "Khronos glTF Blender I/O v4.5.51",
    gltfTransform: "4.4.2",
    meshoptimizer: "1.0.1",
    imageMagick: "6.9.12-98 Q16"
  },
  reviewViews: CURRENT_REVIEW_FILES.map((name) => `${CURRENT_SOURCE_PATH}/review/${name}`),
  release: {
    path: CURRENT_RELEASE_PATH,
    files: releaseFiles,
    stats: CURRENT_STATS
  },
  reproducibility: {
    authoredSourceContainer: {
      path: `${CURRENT_SOURCE_PATH}/draft-scene.blend`,
      sha256: CURRENT_HASHES.authoredBlend,
      result: "locked-exact-bytes-not-claimed-reproducible-from-reauthoring"
    },
    bakedSourceContainer: {
      path: `${CURRENT_SOURCE_PATH}/baked-source-0.4.0.blend`,
      sha256: CURRENT_HASHES.bakedBlend,
      result: "locked-exact-bytes"
    },
    atlas: {
      path: `${CURRENT_SOURCE_PATH}/lightmap-0.4.0.png`,
      sha256: CURRENT_HASHES.atlas,
      result: "locked-exact-bytes-not-rebaked-by-ci"
    },
    releaseMaterialization: {
      scope: "two-independent-exports-from-accepted-baked-source-and-atlas-with-pinned-toolchain",
      runs: 2,
      rawGlbSha256: CURRENT_HASHES.rawGlb,
      finalGlbSha256: CURRENT_HASHES.finalGlb,
      result: "byte-identical-to-accepted-release"
    },
    reviewImages: {
      result: "locked-exact-bytes-not-regenerated-by-ci"
    }
  },
  humanGates: {
    visual: "pending-human-acceptance",
    rights: "pending-human-rights-approval",
    publicationReady: false
  }
};
await writeOrVerify(sourceLockPath, sourceLock);

const evidenceFiles = [
  "geometry-measurements.json",
  "glb-inventory.json",
  "quality-disposition.json",
  "runtime-capture-index.json",
  "support-measurements.json"
];
const releaseLedger = {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  releaseVersion: CURRENT_RELEASE_VERSION,
  status: "review",
  qualityOutcome: CURRENT_QUALITY_OUTCOME,
  sourceLock: await record(`${CURRENT_SOURCE_PATH}/review-source-lock.json`),
  evidence: await records(evidenceFiles.map((name) => `${CURRENT_PROVENANCE_PATH}/${name}`)),
  release: {
    path: CURRENT_RELEASE_PATH,
    files: releaseFiles,
    stats: CURRENT_STATS
  },
  gates: {
    exactByteMaterialization: "passed-two-run",
    gltfValidation: "passed-zero-errors-zero-warnings",
    geometryMeasurements: "passed",
    supportMeasurements: "passed",
    cleanRuntimeCapture: "passed",
    normalProductRuntimeChecks: "passed",
    inheritedQualityTarget: CURRENT_QUALITY_OUTCOME,
    meshBudget: "failed-unapproved-exception",
    humanVisualAcceptance: "pending-human-acceptance",
    humanRightsApproval: "pending-human-rights-approval",
    staging: "not-published",
    publicationReady: false,
    isCurrent: false
  }
};
await writeOrVerify(join(provenanceDir, "release-ledger.json"), releaseLedger);

process.stdout.write(`Wrote or verified ${SCENE_ID}@${CURRENT_RELEASE_VERSION} immutable review evidence.\n`);
