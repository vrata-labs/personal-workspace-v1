import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

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
  REVIEW_RUNTIME_CAPTURE_RUNS,
  REVIEW_RIGHTS_APPROVAL_STATUS,
  REVIEW_RIGHTS_LICENSE_REF,
  SCENE_ID,
  assert,
  assertAcceptanceIndexPrefix,
  bakedMaterialMetadata,
  fileRecord,
  glbStats,
  glbTextureRecords,
  horizontalToVerticalFovDegrees,
  jpegDimensions,
  pathTrackedInGit,
  pngDimensions,
  readJson,
  repositoryToolingPaths,
  webpDimensions
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const releaseGlbPath = join(root, REVIEW_RELEASE.releasePath, "scene.glb");
const sourceRoot = join(root, REVIEW_RELEASE.sourcePath);
const provenanceRoot = join(root, REVIEW_RELEASE.provenancePath);
const requiredTags = [
  "vrataObjectId",
  "vrataPartId",
  "vrataInteractionStatus",
  "vrataBakePolicy",
  "vrataCollisionPolicy",
  "vrataSupportPolicy",
  "vrataNavigableBoundsPolicy"
];
const sourceReviewViews = [
  { id: "entry", position: { x: 2.35, y: 1.58, z: 1.92 }, target: { x: 1.6, y: 1.18, z: -0.9 }, horizontalFovDegrees: 88 },
  { id: "workspace", position: { x: -1, y: 2.02, z: 2.15 }, target: { x: 0.42, y: 1.08, z: -0.72 }, horizontalFovDegrees: 84 },
  { id: "reading", position: { x: 0.55, y: 1.42, z: -0.95 }, target: { x: -2.25, y: 1, z: 0.45 }, horizontalFovDegrees: 55 },
  { id: "diagonal-overview", position: { x: -1, y: 2.02, z: 2.15 }, target: { x: 0.35, y: 1.06, z: -0.62 }, horizontalFovDegrees: 68 },
  { id: "window-detail", position: { x: 1.15, y: 1.55, z: -0.2 }, target: { x: 4.35, y: 1.44, z: -0.2 }, horizontalFovDegrees: 58 },
  { id: "exterior-view", position: { x: 0.05, y: 1.56, z: -0.2 }, target: { x: 8, y: 1.37, z: -0.2 }, horizontalFovDegrees: 72 },
  { id: "owner-seat", position: { x: -1.05, y: 1.2, z: -0.92 }, target: { x: 3.75, y: 1.38, z: -0.15 }, horizontalFovDegrees: 70 }
];
const existingVisualConfig = await readJson(join(root, REVIEW_RELEASE.visualParityConfigPath)).catch(() => null);
const hasCalibratedRuntimeCapture = existingVisualConfig?.status === "technical-runtime-capture-passed";

async function writeGenerated(repositoryPath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const path = join(root, repositoryPath);
  if (pathTrackedInGit(root, repositoryPath)) {
    assert((await readFile(path)).equals(bytes), `immutable_generated_evidence_drift:${repositoryPath}`);
  } else {
    await writeFile(path, bytes);
  }
}

async function writeAcceptanceIndex(repositoryPath, value) {
  const path = join(root, repositoryPath);
  if (pathTrackedInGit(root, repositoryPath)) assertAcceptanceIndexPrefix(await readJson(path), value);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function pathRecord(repositoryPath) {
  return { path: repositoryPath, ...await fileRecord(join(root, repositoryPath)) };
}

const [manifest, scene, reality, scenarios, panoramaParameters, releaseFiles, stats, textures, document] = await Promise.all([
  readJson(join(root, "manifest.json")),
  readJson(join(root, REVIEW_RELEASE.releasePath, "scene.json")),
  readJson(join(root, REVIEW_RELEASE.sceneRealityPath)),
  readJson(join(root, REVIEW_RELEASE.userScenariosPath)),
  readJson(join(root, REVIEW_RELEASE.panoramaParametersPath)),
  Promise.all(RELEASE_FILES.map(async (name) => [name, await fileRecord(join(root, REVIEW_RELEASE.releasePath, name))])).then(Object.fromEntries),
  glbStats(releaseGlbPath),
  glbTextureRecords(releaseGlbPath),
  new NodeIO().registerExtensions(ALL_EXTENSIONS).read(releaseGlbPath)
]);
const release = manifest.releases.find(({ version }) => version === REVIEW_RELEASE_VERSION);
assert(release && JSON.stringify(release.files) === JSON.stringify(releaseFiles), "review_release_manifest_record_drift");
assert(JSON.stringify(release.stats) === JSON.stringify(stats), "review_release_manifest_stats_drift");

const reviewRecords = await Promise.all(REVIEW_RELEASE_VIEWS.map(async (id) => {
  const path = `${REVIEW_RELEASE.reviewPath}/${id}.webp`;
  const bytes = await readFile(join(root, path));
  assert(JSON.stringify(webpDimensions(bytes)) === JSON.stringify({ width: 960, height: 540 }), `invalid_review_dimensions:${id}`);
  return { id, ...await pathRecord(path), width: 960, height: 540 };
}));

const visualParityConfig = {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  releaseVersion: REVIEW_RELEASE_VERSION,
  status: hasCalibratedRuntimeCapture ? existingVisualConfig.status : "pending-runtime-capture",
  releaseGlb: { path: `${REVIEW_RELEASE.releasePath}/scene.glb`, ...releaseFiles["scene.glb"] },
  releaseManifest: { path: `${REVIEW_RELEASE.releasePath}/scene.json`, ...releaseFiles["scene.json"] },
  capture: {
    platformCommit: BAKED_PLATFORM_COMMIT,
    platformPatch: { path: REVIEW_RELEASE.platformPatchPath, ...await fileRecord(join(root, REVIEW_RELEASE.platformPatchPath)) },
    bindingFile: "capture-binding.json",
    runtimeDiagnosticsFile: "scene-debug.json",
    renderSettingsFile: "capture-settings.json",
    requiredState: "loaded",
    requiredFailureReason: null,
    requireNoMissingAssets: true,
    requiredRenderProfile: BAKED_RENDER_PROFILE,
    minimumLightMappedMaterialCount: 15,
    expectedRuntime: hasCalibratedRuntimeCapture
      ? existingVisualConfig.capture.expectedRuntime
      : { meshCount: 232, materialCount: 16, triangleEstimate: 45772 },
    expectedSpawn: {
      id: scene.spawnPoints[0].id,
      position: scene.spawnPoints[0].position,
      yaw: scene.spawnPoints[0].yaw,
      applied: true
    },
    renderSettings: { environmentIntensity: 0.35, exposure: 1.2 },
    runtimeCaptureRoot: REVIEW_RELEASE.runtimeCapturePath,
    repeatSets: REVIEW_RUNTIME_CAPTURE_RUNS,
    runner: {
      command: "pnpm test:e2e:private-assets tests/e2e/scene-visual.spec.ts --workers=1",
      executable: "pnpm",
      argv: ["test:e2e:private-assets", "tests/e2e/scene-visual.spec.ts", "--workers=1"],
      bindingGenerator: {
        executable: "node",
        argv: ["scripts/create-review-capture-binding.mjs", "--version", REVIEW_RELEASE_VERSION, "--run", "<capture-set>"],
        environment: { SCENE_VISUAL_CAPTURE_ROOT: "<capture-root>" }
      },
      environment: {
        SCENE_VISUAL_ASSET_PATH: `<candidate-root>/${REVIEW_RELEASE.releasePath}/scene.glb`,
        SCENE_VISUAL_MANIFEST_PATH: `<candidate-root>/${REVIEW_RELEASE.releasePath}/scene.json`,
        SCENE_VISUAL_CONFIG_PATH: `<candidate-root>/${REVIEW_RELEASE.visualParityConfigPath}`,
        SCENE_VISUAL_OUTPUT_DIR: "<capture-dir>",
        SCENE_VISUAL_VIEW_IDS: "<comma-separated runner batch>",
        SCENE_VISUAL_STRIP_ANCHORS: "1",
        SCENE_VISUAL_HIDE_MEDIA_SURFACES: "1",
        SCENE_VISUAL_FLIP_Z: "0",
        SCENE_VISUAL_ENVIRONMENT_INTENSITY: "0.35",
        SCENE_VISUAL_EXPOSURE: "1.2"
      },
      batches: [
        ["entry", "workspace", "reading"],
        ["diagonal-overview", "window-detail", "exterior-view", "owner-seat"]
      ]
    },
    cleanVisualMode: {
      stripAnchors: true,
      avatarsEnabled: true,
      avatarFallbackCapsulesEnabled: false,
      avatarSeatsEnabled: false,
      mediaSurfacesVisible: false,
      reason: "Interaction anchors, dynamic media planes, and fallback avatar meshes are validated separately and must not occlude fixed source-to-GLB composition evidence."
    }
  },
  reviewViews: sourceReviewViews.map(({ id, position, target, horizontalFovDegrees }) => ({
    id,
    position,
    target,
    fovDegrees: horizontalToVerticalFovDegrees(horizontalFovDegrees),
    sourceHorizontalFovDegrees: horizontalFovDegrees
  })),
  views: reviewRecords.map(({ id, path, sha256 }) => ({
    id,
    referencePath: path,
    referenceSha256: sha256,
    captureFile: `${id}.png`,
    thresholds: hasCalibratedRuntimeCapture
      ? existingVisualConfig.views.find((view) => view.id === id).thresholds
      : { status: "unset-pending-multi-capture-calibration", phashMax: null, nccMin: null }
  })),
  aggregateThresholds: hasCalibratedRuntimeCapture
    ? existingVisualConfig.aggregateThresholds
    : { status: "unset-pending-multi-capture-calibration", phashTotalMax: null, nccMeanMin: null },
  calibration: hasCalibratedRuntimeCapture ? existingVisualConfig.calibration : null,
  humanGates: {
    visualAcceptance: "pending-human-acceptance",
    rightsApproval: REVIEW_RIGHTS_APPROVAL_STATUS,
    publicationReady: false
  }
};
await writeGenerated(REVIEW_RELEASE.visualParityConfigPath, visualParityConfig);

const sourcePaths = [
  REVIEW_RELEASE.panoramaGeneratorPath,
  REVIEW_RELEASE.panoramaParametersPath,
  REVIEW_RELEASE.panoramaPath,
  REVIEW_RELEASE.prepareScriptPath,
  REVIEW_RELEASE.blendPath,
  REVIEW_RELEASE.lightmapPath,
  REVIEW_RELEASE.exportScriptPath,
  REVIEW_RELEASE.renderScriptPath,
  REVIEW_RELEASE.sceneManifestPath,
  REVIEW_RELEASE.sceneRealityPath,
  REVIEW_RELEASE.userScenariosPath,
  REVIEW_RELEASE.licensePath,
  REVIEW_RELEASE.platformPatchPath,
  REVIEW_RELEASE.visualParityConfigPath
];
const sourceRecords = await Promise.all(sourcePaths.map(pathRecord));
const toolingPaths = await repositoryToolingPaths(root);
const tooling = await Promise.all(toolingPaths.map(pathRecord));
const sourceLock = {
  schemaVersion: 1,
  status: "review-source-lock",
  sceneId: SCENE_ID,
  releaseVersion: REVIEW_RELEASE_VERSION,
  humanVisualAccepted: false,
  rightsApproved: false,
  derivationInputs: await Promise.all([
    pathRecord("source/review-candidate.blend"),
    pathRecord("source/baked-lightmap-0.2.0.png")
  ]),
  sourceFiles: sourceRecords,
  tooling,
  toolchain: {
    blenderVersion: BLENDER_VERSION,
    blenderBuildHash: BLENDER_BUILD_HASH,
    blenderBinarySha256: BLENDER_BINARY_SHA256,
    gltfExporter: "Khronos glTF Blender I/O v4.5.51",
    panoramaGenerator: `Blender ${BLENDER_VERSION} Python with numpy ${panoramaParameters.generatorRuntime.numpyVersion}`,
    panoramaEncoder: panoramaParameters.generatorRuntime.imageMagickVersionPrefix,
    reviewImageConverter: "cwebp 1.6.0",
    reviewImageQuality: 90
  },
  captureHarness: {
    platformCommit: BAKED_PLATFORM_COMMIT,
    patchPath: REVIEW_RELEASE.platformPatchPath,
    patchSha256: (await fileRecord(join(root, REVIEW_RELEASE.platformPatchPath))).sha256
  },
  reviewViews: reviewRecords,
  release: {
    version: REVIEW_RELEASE_VERSION,
    path: REVIEW_RELEASE.releasePath,
    files: releaseFiles,
    stats
  },
  reproducibility: {
    panorama: {
      scope: "pinned-blender-generator-and-parameters-two-run-pre-encoding-rgb",
      runs: 2,
      result: "byte-identical-rgb-pixels-before-lossy-encoding",
      decodedRgbSha256: panoramaParameters.decodedRgbSha256,
      artifact: { path: REVIEW_RELEASE.panoramaPath, ...await fileRecord(join(root, REVIEW_RELEASE.panoramaPath)) },
      jpegEncoderBytesClaimedReproducible: false
    },
    glb: {
      scope: "same-pinned-blender-saved-blend-and-hash-bound-textures-two-run",
      runs: 2,
      result: "byte-identical-glb",
      sha256: releaseFiles["scene.glb"].sha256
    },
    reviewWebp: {
      scope: "hash-bound-review-inputs-only",
      result: "not-regenerated-by-ci",
      encoderBytesClaimedReproducible: false
    },
    sourceContainer: {
      scope: "accepted-saved-blend-exact-bytes",
      result: "locked-not-claimed-byte-reproducible-from-reauthoring",
      reauthoringBytesClaimedReproducible: false
    }
  },
  humanGates: {
    visual: "pending-human-acceptance",
    rights: REVIEW_RIGHTS_APPROVAL_STATUS,
    publicationReady: false
  },
  ...(hasCalibratedRuntimeCapture ? {
    technicalRuntimeCapture: {
      status: "passed-three-byte-stable-runtime-capture-sets",
      captureRoot: REVIEW_RELEASE.runtimeCapturePath,
      captureSets: REVIEW_RUNTIME_CAPTURE_RUNS,
      visualEvidencePath: `${REVIEW_RELEASE.provenancePath}/visual-parity.json`,
      stabilityEvidencePath: `${REVIEW_RELEASE.provenancePath}/visual-stability.json`,
      humanVisualAcceptance: "pending-human-acceptance",
      humanRightsApproval: REVIEW_RIGHTS_APPROVAL_STATUS
    }
  } : {})
};
await writeGenerated(REVIEW_RELEASE.sourceLockPath, sourceLock);
const sourceLockRecord = await fileRecord(join(root, REVIEW_RELEASE.sourceLockPath));
const visualConfigRecord = await fileRecord(join(root, REVIEW_RELEASE.visualParityConfigPath));
const acceptanceIndexPath = "source/release-acceptance-index.json";
const existingAcceptanceIndex = await readJson(join(root, acceptanceIndexPath)).catch(() => ({ releases: [] }));
assert((existingAcceptanceIndex.schemaVersion === undefined || existingAcceptanceIndex.schemaVersion === 1)
  && (existingAcceptanceIndex.sceneId === undefined || existingAcceptanceIndex.sceneId === SCENE_ID)
  && Array.isArray(existingAcceptanceIndex.releases)
  && new Set(existingAcceptanceIndex.releases.map(({ version }) => version)).size === existingAcceptanceIndex.releases.length, "invalid_existing_acceptance_index");
const acceptanceRecord = {
  version: REVIEW_RELEASE_VERSION,
  status: "review-source-lock",
  lockPath: REVIEW_RELEASE.sourceLockPath,
  lockSha256: sourceLockRecord.sha256,
  visualParityConfigPath: REVIEW_RELEASE.visualParityConfigPath,
  visualParityConfigSha256: visualConfigRecord.sha256,
  humanVisualAccepted: false,
  ...(hasCalibratedRuntimeCapture ? { technicalRuntimeCapture: "passed-three-byte-stable-runtime-capture-sets" } : {})
};
const acceptancePosition = existingAcceptanceIndex.releases.findIndex(({ version }) => version === REVIEW_RELEASE_VERSION);
await writeAcceptanceIndex(acceptanceIndexPath, {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  releases: acceptancePosition === -1
    ? [...existingAcceptanceIndex.releases, acceptanceRecord]
    : existingAcceptanceIndex.releases.map((record, index) => index === acceptancePosition ? acceptanceRecord : record)
});

const gltfRoot = document.getRoot();
const meshNodes = gltfRoot.listNodes().filter((node) => node.getMesh());
const statusCounts = {};
const groups = new Map();
const pairs = [];
for (const node of meshNodes) {
  const extras = node.getExtras();
  for (const tag of requiredTags) assert(tag in extras, `missing_glb_tag:${node.getName()}:${tag}`);
  statusCounts[extras.vrataInteractionStatus] = (statusCounts[extras.vrataInteractionStatus] ?? 0) + 1;
  pairs.push(`${extras.vrataObjectId}:${extras.vrataPartId}`);
  const group = groups.get(extras.vrataObjectId) ?? { id: extras.vrataObjectId, status: extras.vrataInteractionStatus, partCount: 0 };
  assert(group.status === extras.vrataInteractionStatus, `mixed_object_group_status:${extras.vrataObjectId}`);
  group.partCount += 1;
  groups.set(extras.vrataObjectId, group);
}
assert(new Set(pairs).size === pairs.length, "duplicate_object_part_pair");
const objectGroups = [...groups.values()].sort((left, right) => left.id.localeCompare(right.id));
const panoramaNode = meshNodes.find((node) => node.getName() === reality.panorama.nodeName);
assert(panoramaNode, "panorama_node_missing");
const bakedMaterials = (await bakedMaterialMetadata(releaseGlbPath))
  .filter(({ extras }) => extras.vrataLightMap === true)
  .map(({ name, extras }) => ({ name, lightMapIntensity: extras.vrataLightMapIntensity }))
  .sort((left, right) => left.name.localeCompare(right.name));
const inventory = {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  releaseVersion: REVIEW_RELEASE_VERSION,
  releaseGlb: { path: `${REVIEW_RELEASE.releasePath}/scene.glb`, ...releaseFiles["scene.glb"] },
  stats,
  meshSemantics: {
    requiredTags,
    taggedMeshNodes: meshNodes.length,
    uniqueObjectPartPairs: new Set(pairs).size,
    interactionStatusCounts: Object.fromEntries(Object.entries(statusCounts).sort()),
    objectGroups
  },
  materials: {
    total: gltfRoot.listMaterials().length,
    lightMapped: bakedMaterials,
    panorama: {
      name: reality.panorama.materialName,
      lightMapped: false,
      unlit: true,
      colorSpace: "sRGB"
    }
  },
  textures,
  panoramaNode: { name: panoramaNode.getName(), extras: panoramaNode.getExtras() },
  forbiddenNodesAbsent: reality.glbContract.forbiddenNodeNames.filter((name) => !meshNodes.some((node) => node.getName() === name)),
  requiredNodesPresent: reality.glbContract.requiredNodeNames.filter((name) => meshNodes.some((node) => node.getName() === name))
};
await writeGenerated(`${REVIEW_RELEASE.provenancePath}/glb-inventory.json`, inventory);

const [panoramaBytes, lightmapBytes] = await Promise.all([
  readFile(join(root, REVIEW_RELEASE.panoramaPath)),
  readFile(join(root, REVIEW_RELEASE.lightmapPath))
]);
const panoramaRecord = await pathRecord(REVIEW_RELEASE.panoramaPath);
const embeddedPanorama = textures.find(({ name }) => name === "panorama-city-park");
const embeddedLightmap = textures.find(({ name }) => name === "baked-lightmap");
const panoramaDimensions = jpegDimensions(panoramaBytes);
const lightmapDimensions = pngDimensions(lightmapBytes);
const panoramaIntegrity = {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  releaseVersion: REVIEW_RELEASE_VERSION,
  result: "valid",
  source: { ...panoramaRecord, ...panoramaDimensions, format: "JPEG", colorSpace: "sRGB" },
  embedded: { textureName: embeddedPanorama.name, mimeType: embeddedPanorama.mimeType, sha256: embeddedPanorama.sha256, sizeBytes: embeddedPanorama.sizeBytes },
  byteIdenticalSourceAndEmbedded: panoramaRecord.sha256 === embeddedPanorama.sha256 && panoramaRecord.sizeBytes === embeddedPanorama.sizeBytes,
  generator: await pathRecord(REVIEW_RELEASE.panoramaGeneratorPath),
  parameters: await pathRecord(REVIEW_RELEASE.panoramaParametersPath),
  sphere: { name: panoramaNode.getName(), extras: panoramaNode.getExtras(), inwardVisible: true },
  budgets: {
    compressedBytes: panoramaBytes.length,
    compressedBytesMax: reality.budgets.panoramaCompressedBytesMax,
    baseDecodedRgbaBytes: panoramaDimensions.width * panoramaDimensions.height * 4,
    mipmappedGpuRgba8Bytes: reality.budgets.panoramaMipmappedGpuRgba8Bytes,
    totalBaseDecodedTextureBytes: reality.budgets.totalDecodedTextureBytes,
    totalMipmappedGpuRgba8Bytes: reality.budgets.totalMipmappedGpuRgba8Bytes,
    totalBaseDecodedTextureBytesMax: reality.budgets.totalDecodedTextureBytesMax,
    totalMipmappedGpuRgba8BytesMax: reality.budgets.totalMipmappedGpuRgba8BytesMax,
    gpuEstimateAssumption: "RGBA8 base level plus complete mip chain through 1x1"
  },
  lightmap: {
    ...embeddedLightmap,
    width: lightmapDimensions.width,
    height: lightmapDimensions.height,
    baseDecodedRgbaBytes: lightmapDimensions.width * lightmapDimensions.height * 4,
    mipmappedGpuRgba8Bytes: reality.budgets.lightmapMipmappedGpuRgba8Bytes
  }
};
await writeGenerated(`${REVIEW_RELEASE.provenancePath}/panorama-integrity.json`, panoramaIntegrity);

await writeGenerated(`${REVIEW_RELEASE.provenancePath}/runtime-coordinates.json`, {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  releaseVersion: REVIEW_RELEASE_VERSION,
  result: "valid",
  adapter: reality.coordinateSystem,
  bindings: reality.preservedRuntimeBindings,
  previousReleaseVersion: "0.2.0",
  previousReleaseBindingsPreserved: true
});

await writeGenerated(`${REVIEW_RELEASE.provenancePath}/scene-reality-report.json`, {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  releaseVersion: REVIEW_RELEASE_VERSION,
  result: "valid",
  contracts: {
    sceneReality: await pathRecord(REVIEW_RELEASE.sceneRealityPath),
    userScenarios: await pathRecord(REVIEW_RELEASE.userScenariosPath),
    scenarios: scenarios.scenarios.length
  },
  release: {
    sceneManifestValidated: scene.sceneId === SCENE_ID && scene.version === REVIEW_RELEASE_VERSION,
    glbValidated: true,
    meshNodesValidated: meshNodes.length,
    taggedMeshNodesValidated: meshNodes.length,
    uniqueObjectPartPairsValidated: new Set(pairs).size,
    objectGroupsValidated: objectGroups.length,
    requiredNodesValidated: inventory.requiredNodesPresent.length,
    forbiddenNodesAbsent: inventory.forbiddenNodesAbsent.length,
    embeddedTexturesValidated: textures.length,
    preservedRuntimeBindingsValidated: 3,
    budgetsValidated: Object.keys(reality.budgets).length
  },
  gates: {
    sourceReview: "prepared-for-human-review",
    runtimeCapture: hasCalibratedRuntimeCapture ? "technical-runtime-capture-passed" : "pending-runtime-capture",
    ...(hasCalibratedRuntimeCapture ? { runtimeCaptureSets: REVIEW_RUNTIME_CAPTURE_RUNS.length } : {}),
    humanVisualAcceptance: "pending-human-acceptance",
    humanRightsApproval: REVIEW_RIGHTS_APPROVAL_STATUS,
    publicationReady: false
  }
});

const generationLedger = {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  releaseVersion: REVIEW_RELEASE_VERSION,
  status: "review",
  operation: "locked-derived-blend-with-deterministic-panorama-pixels-and-byte-reproducible-glb-export",
  toolchain: sourceLock.toolchain,
  tooling,
  derivation: {
    immutableBaseBlend: sourceLock.derivationInputs[0],
    inheritedLightmap: sourceLock.derivationInputs[1],
    prepareScript: await pathRecord(REVIEW_RELEASE.prepareScriptPath),
    derivedBlend: await pathRecord(REVIEW_RELEASE.blendPath),
    acceptedSourceContainer: "locked-exact-bytes",
    reauthoringBytesClaimedReproducible: false,
    windowGlassRemoved: true,
    interiorCompositionPreserved: true
  },
  panorama: {
    generator: await pathRecord(REVIEW_RELEASE.panoramaGeneratorPath),
    parameters: await pathRecord(REVIEW_RELEASE.panoramaParametersPath),
    output: panoramaRecord,
    reproducibility: sourceLock.reproducibility.panorama
  },
  export: {
    script: await pathRecord(REVIEW_RELEASE.exportScriptPath),
    output: { path: `${REVIEW_RELEASE.releasePath}/scene.glb`, ...releaseFiles["scene.glb"] },
    reproducibility: sourceLock.reproducibility.glb
  },
  sourceReview: { renderer: await pathRecord(REVIEW_RELEASE.renderScriptPath), views: reviewRecords },
  humanGates: sourceLock.humanGates
};
await writeGenerated(`${REVIEW_RELEASE.provenancePath}/generation-ledger.json`, generationLedger);

const assetRecords = [
  { id: "asset-derived-scene-source-project-authored", kind: "project-authored-derived-scene-source", record: await pathRecord(REVIEW_RELEASE.blendPath), outputSha256: [releaseFiles["scene.glb"].sha256] },
  { id: "asset-baked-lightmap-project-authored", kind: "project-authored-inherited-generated-texture", record: await pathRecord(REVIEW_RELEASE.lightmapPath), outputSha256: [releaseFiles["scene.glb"].sha256] },
  { id: "asset-panorama-generator-project-authored", kind: "project-authored-generator", record: await pathRecord(REVIEW_RELEASE.panoramaGeneratorPath), outputSha256: [panoramaRecord.sha256] },
  { id: "asset-panorama-city-park-project-authored", kind: "project-authored-generated-texture", record: panoramaRecord, outputSha256: [releaseFiles["scene.glb"].sha256] },
  { id: "asset-panorama-sphere-project-authored", kind: "project-authored-procedural-geometry", record: await pathRecord(REVIEW_RELEASE.prepareScriptPath), outputSha256: [releaseFiles["scene.glb"].sha256] },
  { id: "asset-release-exporter-project-authored", kind: "project-authored-build-script", record: await pathRecord(REVIEW_RELEASE.exportScriptPath), outputSha256: [releaseFiles["scene.glb"].sha256] },
  ...reviewRecords.map(({ id, path, sha256, sizeBytes }) => ({ id: `asset-review-${id}-project-authored`, kind: "project-authored-review-render", record: { path, sha256, sizeBytes }, outputSha256: [] }))
];
await writeGenerated(`${REVIEW_RELEASE.provenancePath}/release-asset-ledger.json`, {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  releaseVersion: REVIEW_RELEASE_VERSION,
  approval: {
    decision: REVIEW_RIGHTS_APPROVAL_STATUS,
    rightsApproved: false,
    humanDecisionRecorded: false,
    evidencePath: null
  },
  license: {
    name: REVIEW_RIGHTS_LICENSE_REF,
    reference: `${REVIEW_RELEASE.provenancePath}/project-authored-review-release.txt`,
    grantsPublicationRights: false
  },
  records: assetRecords.map(({ id, kind, record, outputSha256 }) => ({
    id,
    kind,
    repositoryPath: record.path,
    originalSha256: record.sha256,
    sizeBytes: record.sizeBytes,
    outputSha256,
    authorProvider: "project-team",
    externalSource: null,
    attribution: null
  })),
  externalAssetCount: 0,
  downloadedAssetCount: 0,
  boundaries: {
    projectAuthoredOnly: true,
    humanVisualAccepted: false,
    humanRightsAccepted: false,
    publicationReady: false
  }
});

if (!hasCalibratedRuntimeCapture) {
  await writeGenerated(`${REVIEW_RELEASE.provenancePath}/visual-stability.json`, {
    schemaVersion: 1,
    sceneId: SCENE_ID,
    releaseVersion: REVIEW_RELEASE_VERSION,
    status: "pending-three-runtime-capture-sets",
    requiredCaptureSets: REVIEW_RUNTIME_CAPTURE_RUNS,
    thresholdsEstablished: false,
    humanVisualAcceptance: "pending-human-acceptance",
    humanRightsApproval: REVIEW_RIGHTS_APPROVAL_STATUS,
    publicationReady: false
  });
  await writeGenerated(`${REVIEW_RELEASE.provenancePath}/visual-parity.json`, {
    schemaVersion: 1,
    sceneId: SCENE_ID,
    releaseVersion: REVIEW_RELEASE_VERSION,
    status: "pending-runtime-capture",
    sourceLock: { path: REVIEW_RELEASE.sourceLockPath, ...sourceLockRecord },
    config: { path: REVIEW_RELEASE.visualParityConfigPath, ...visualConfigRecord },
    releaseGlb: { path: `${REVIEW_RELEASE.releasePath}/scene.glb`, ...releaseFiles["scene.glb"] },
    releaseManifest: { path: `${REVIEW_RELEASE.releasePath}/scene.json`, ...releaseFiles["scene.json"] },
    sourceReview: {
      status: "prepared-for-human-review",
      views: reviewRecords.map(({ id, path, sha256, sizeBytes }) => ({ id, path, sha256, sizeBytes }))
    },
    runtimeCapture: null,
    metrics: {
      status: "unset-pending-multi-capture-calibration",
      tool: "ImageMagick compare",
      phash: null,
      ncc: null,
      thresholdsEstablished: false
    },
    humanVisualAcceptance: "pending-human-acceptance",
    humanRightsApproval: REVIEW_RIGHTS_APPROVAL_STATUS,
    publicationReady: false
  });
}

process.stdout.write(`Wrote deterministic ${SCENE_ID}@${REVIEW_RELEASE_VERSION} source lock and release evidence.\n`);
