import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  REVIEW_RELEASE,
  REVIEW_RELEASE_VERSION,
  REVIEW_RELEASE_VIEWS,
  REVIEW_RIGHTS_APPROVAL_STATUS,
  REVIEW_RUNTIME_CAPTURE_ARTIFACT_FILES,
  REVIEW_RUNTIME_CAPTURE_BINDING_FILE,
  REVIEW_RUNTIME_CAPTURE_RUNS,
  SCENE_ID,
  assert,
  fileRecord,
  pathTrackedInGit,
  pngDimensions,
  readJson
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const captureRoot = join(root, REVIEW_RELEASE.runtimeCapturePath);
const phashMarginAbsolute = 5;
const nccMarginAbsolute = 0.03;
const stabilityPolicy = Object.freeze({
  requiredCaptureSets: 3,
  imageBytesIdenticalAcrossRuns: true,
  pairwisePhashMax: 0,
  pairwiseNccMin: 1
});

function compare(metric, reference, actual) {
  const result = spawnSync("compare", ["-metric", metric, reference, actual, "null:"], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") throw new Error("imagemagick_compare_not_found");
  if (result.error || (result.status !== 0 && result.status !== 1)) throw new Error(`image_compare_failed:${metric}:${result.stderr.trim()}`);
  const value = Number.parseFloat(result.stderr.trim().split(/\s+/)[0] ?? "");
  assert(Number.isFinite(value), `invalid_image_metric:${metric}:${result.stderr.trim()}`);
  return value;
}

function imageMagickVersion() {
  const result = spawnSync("compare", ["-version"], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") throw new Error("imagemagick_compare_not_found");
  if (result.error || result.status !== 0) throw new Error(`imagemagick_version_failed:${result.error?.message ?? result.stderr.trim()}`);
  return result.stdout.split(/\r?\n/, 1)[0].replace(/^Version:\s*/, "").replace(/\s+https?:\/\/\S+.*$/, "").trim();
}

function floorHundredth(value) {
  return Math.floor((value + Number.EPSILON) * 100) / 100;
}

async function pathRecord(repositoryPath) {
  return { path: repositoryPath, ...await fileRecord(join(root, repositoryPath)) };
}

function assertRecord(actual, expected, code) {
  assert(actual?.sha256 === expected?.sha256 && actual?.sizeBytes === expected?.sizeBytes, code);
}

const [config, sceneManifest, sourceLock, acceptanceIndex, realityReport] = await Promise.all([
  readJson(join(root, REVIEW_RELEASE.visualParityConfigPath)),
  readJson(join(root, REVIEW_RELEASE.releasePath, "scene.json")),
  readJson(join(root, REVIEW_RELEASE.sourceLockPath)),
  readJson(join(root, "source", "release-acceptance-index.json")),
  readJson(join(root, REVIEW_RELEASE.provenancePath, "scene-reality-report.json"))
]);
assert(!pathTrackedInGit(root, REVIEW_RELEASE.sourcePath)
  && !pathTrackedInGit(root, REVIEW_RELEASE.provenancePath)
  && !pathTrackedInGit(root, REVIEW_RELEASE.runtimeCapturePath), "calibration_target_is_already_immutable_at_head");
assert(config.sceneId === SCENE_ID && config.releaseVersion === REVIEW_RELEASE_VERSION, "invalid_review_visual_config");
assert(JSON.stringify(config.capture.repeatSets) === JSON.stringify(REVIEW_RUNTIME_CAPTURE_RUNS), "review_capture_set_drift");
assert(JSON.stringify(config.views.map(({ id }) => id)) === JSON.stringify(REVIEW_RELEASE_VIEWS), "review_capture_view_set_drift");

const releaseGlbRecord = await pathRecord(`${REVIEW_RELEASE.releasePath}/scene.glb`);
const releaseManifestRecord = await pathRecord(`${REVIEW_RELEASE.releasePath}/scene.json`);
assertRecord(releaseGlbRecord, config.releaseGlb, "review_capture_release_glb_drift");
assertRecord(releaseManifestRecord, config.releaseManifest, "review_capture_release_manifest_drift");
const metricToolVersion = imageMagickVersion();
const runs = [];

for (const runId of REVIEW_RUNTIME_CAPTURE_RUNS) {
  const runPath = `${REVIEW_RELEASE.runtimeCapturePath}/${runId}`;
  const runDir = join(root, runPath);
  const bindingPath = `${runPath}/${REVIEW_RUNTIME_CAPTURE_BINDING_FILE}`;
  const diagnosticsPath = `${runPath}/${config.capture.runtimeDiagnosticsFile}`;
  const settingsPath = `${runPath}/${config.capture.renderSettingsFile}`;
  const [binding, diagnostics, settings] = await Promise.all([
    readJson(join(root, bindingPath)),
    readJson(join(root, diagnosticsPath)),
    readJson(join(root, settingsPath))
  ]);
  const sceneDebug = diagnostics.sceneDebug ?? diagnostics;
  assert(binding.schemaVersion === 1
    && binding.kind === "version-bound-local-runtime-capture-record"
    && binding.sceneId === SCENE_ID
    && binding.releaseVersion === REVIEW_RELEASE_VERSION
    && binding.captureSet === runId, `invalid_capture_binding:${runId}`);
  assert(binding.provenanceScope?.candidateCiReplaysCapture === false
    && binding.provenanceScope?.candidateCiValidatesCommittedArtifacts === true
    && binding.provenanceScope?.independentVerification === "required-on-exact-merge-sha-staging", `capture_provenance_scope_drift:${runId}`);
  assert(binding.platformCommit === config.capture.platformCommit
    && JSON.stringify(binding.platformPatch) === JSON.stringify(config.capture.platformPatch)
    && JSON.stringify(binding.captureRunner) === JSON.stringify(config.capture.runner)
    && JSON.stringify(binding.capturePolicy) === JSON.stringify(config.capture.cleanVisualMode), `capture_harness_binding_drift:${runId}`);
  assertRecord(binding.releaseGlb, releaseGlbRecord, `capture_binding_glb_drift:${runId}`);
  assertRecord(binding.releaseManifest, releaseManifestRecord, `capture_binding_manifest_drift:${runId}`);
  assert(binding.normalization?.machineLocalUrlsRetained === false
    && sceneDebug.bundleUrl === "local-capture/scene.json"
    && sceneDebug.assetUrl === "local-capture/scene.glb", `capture_url_normalization_drift:${runId}`);
  assert(sceneDebug.state === config.capture.requiredState
    && sceneDebug.failureReason === config.capture.requiredFailureReason
    && Array.isArray(sceneDebug.missingAssets)
    && sceneDebug.missingAssets.length === 0, `capture_runtime_load_failed:${runId}`);
  assert(sceneDebug.assetBytesLoaded === releaseGlbRecord.sizeBytes
    && sceneDebug.assetBytesExpected === releaseGlbRecord.sizeBytes, `capture_runtime_bytes_drift:${runId}`);
  assert(sceneDebug.renderProfile === config.capture.requiredRenderProfile
    && sceneDebug.lightMappedMaterialCount >= config.capture.minimumLightMappedMaterialCount, `capture_runtime_profile_drift:${runId}`);
  assert(sceneDebug.spawnPointId === config.capture.expectedSpawn.id
    && sceneDebug.spawnYaw === config.capture.expectedSpawn.yaw
    && sceneDebug.spawnApplied === config.capture.expectedSpawn.applied
    && JSON.stringify(sceneManifest.spawnPoints[0].position) === JSON.stringify(config.capture.expectedSpawn.position), `capture_spawn_drift:${runId}`);
  assert(JSON.stringify(settings) === JSON.stringify(config.capture.renderSettings), `capture_render_settings_drift:${runId}`);

  const views = [];
  for (const view of config.views) {
    const capturePath = `${runPath}/${view.captureFile}`;
    const captureBytes = await readFile(join(root, capturePath));
    assert(JSON.stringify(pngDimensions(captureBytes)) === JSON.stringify({ width: 960, height: 540 }), `capture_dimensions_drift:${runId}:${view.id}`);
    const capture = await pathRecord(capturePath);
    assertRecord(binding.captureFiles[view.captureFile], capture, `capture_binding_image_drift:${runId}:${view.id}`);
    views.push({
      id: view.id,
      phash: compare("PHASH", join(root, view.referencePath), join(root, capturePath)),
      ncc: compare("NCC", join(root, view.referencePath), join(root, capturePath)),
      capture
    });
  }
  for (const name of REVIEW_RUNTIME_CAPTURE_ARTIFACT_FILES.filter((name) => !name.endsWith(".png"))) {
    assertRecord(binding.captureFiles[name], await pathRecord(`${runPath}/${name}`), `capture_binding_artifact_drift:${runId}:${name}`);
  }
  runs.push({
    id: runId,
    path: runPath,
    binding: await pathRecord(bindingPath),
    diagnostics: {
      record: await pathRecord(diagnosticsPath),
      state: sceneDebug.state,
      failureReason: sceneDebug.failureReason,
      assetBytesLoaded: sceneDebug.assetBytesLoaded,
      assetBytesExpected: sceneDebug.assetBytesExpected,
      renderProfile: sceneDebug.renderProfile,
      spawnPointId: sceneDebug.spawnPointId,
      spawnYaw: sceneDebug.spawnYaw,
      spawnApplied: sceneDebug.spawnApplied,
      objectCount: sceneDebug.objectCount,
      meshCount: sceneDebug.meshCount,
      materialCount: sceneDebug.materialCount,
      texturedMaterialCount: sceneDebug.texturedMaterialCount,
      lightMappedMaterialCount: sceneDebug.lightMappedMaterialCount,
      geometryCount: sceneDebug.geometryCount,
      triangleEstimate: sceneDebug.triangleEstimate,
      textureCount: sceneDebug.textureCount,
      missingAssets: sceneDebug.missingAssets,
      loadMs: sceneDebug.loadMs,
      renderProfileApplyMs: sceneDebug.renderProfileApplyMs
    },
    settings: await pathRecord(settingsPath),
    aggregate: {
      phashTotal: views.reduce((total, view) => total + view.phash, 0),
      nccMean: views.reduce((total, view) => total + view.ncc, 0) / views.length
    },
    views
  });
}

const stableRuntimeFields = [
  "state",
  "failureReason",
  "assetBytesLoaded",
  "assetBytesExpected",
  "renderProfile",
  "spawnPointId",
  "spawnYaw",
  "spawnApplied",
  "objectCount",
  "meshCount",
  "materialCount",
  "texturedMaterialCount",
  "lightMappedMaterialCount",
  "geometryCount",
  "triangleEstimate",
  "textureCount",
  "missingAssets"
];
for (const field of stableRuntimeFields) {
  const values = runs.map((run) => run.diagnostics[field]);
  assert(values.every((value) => JSON.stringify(value) === JSON.stringify(values[0])), `unstable_runtime_diagnostic:${field}`);
}

const pairwise = [];
let maximumPairwisePhash = 0;
let minimumPairwiseNcc = 1;
for (let leftIndex = 0; leftIndex < runs.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < runs.length; rightIndex += 1) {
    const left = runs[leftIndex];
    const right = runs[rightIndex];
    const views = [];
    for (const view of config.views) {
      const leftView = left.views.find(({ id }) => id === view.id);
      const rightView = right.views.find(({ id }) => id === view.id);
      const phash = compare("PHASH", join(root, leftView.capture.path), join(root, rightView.capture.path));
      const ncc = compare("NCC", join(root, leftView.capture.path), join(root, rightView.capture.path));
      const byteIdentical = leftView.capture.sha256 === rightView.capture.sha256 && leftView.capture.sizeBytes === rightView.capture.sizeBytes;
      maximumPairwisePhash = Math.max(maximumPairwisePhash, phash);
      minimumPairwiseNcc = Math.min(minimumPairwiseNcc, ncc);
      views.push({ id: view.id, phash, ncc, byteIdentical });
    }
    pairwise.push({ left: left.id, right: right.id, views });
  }
}

const imagesByteIdentical = config.views.every((view) => {
  const records = runs.map((run) => run.views.find(({ id }) => id === view.id).capture);
  return records.every((record) => record.sha256 === records[0].sha256 && record.sizeBytes === records[0].sizeBytes);
});
const stable = runs.length === stabilityPolicy.requiredCaptureSets
  && imagesByteIdentical === stabilityPolicy.imageBytesIdenticalAcrossRuns
  && maximumPairwisePhash <= stabilityPolicy.pairwisePhashMax
  && minimumPairwiseNcc >= stabilityPolicy.pairwiseNccMin;

const stabilityEvidence = {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  releaseVersion: REVIEW_RELEASE_VERSION,
  status: stable ? "stable-three-runtime-capture-sets" : "unstable-runtime-captures-thresholds-not-established",
  platformCommit: config.capture.platformCommit,
  platformPatch: config.capture.platformPatch,
  releaseGlb: releaseGlbRecord,
  releaseManifest: releaseManifestRecord,
  metricTool: "ImageMagick compare",
  metricToolVersion,
  policy: stabilityPolicy,
  captureSets: runs.map(({ id, path, binding, diagnostics, settings, views }) => ({
    id,
    path,
    binding,
    diagnostics,
    settings,
    images: views.map(({ id: viewId, capture }) => ({ id: viewId, ...capture }))
  })),
  comparison: {
    imagesByteIdenticalAcrossRuns: imagesByteIdentical,
    maximumPairwisePhash,
    minimumPairwiseNcc,
    pairwise
  },
  thresholdsEstablished: stable,
  humanVisualAcceptance: "pending-human-acceptance",
  humanRightsApproval: REVIEW_RIGHTS_APPROVAL_STATUS,
  publicationReady: false
};
if (!stable) {
  await writeFile(join(root, REVIEW_RELEASE.provenancePath, "visual-stability.json"), `${JSON.stringify(stabilityEvidence, null, 2)}\n`);
  throw new Error("runtime_capture_stability_failed_thresholds_not_established");
}

const calibratedViews = config.views.map((view) => {
  const values = runs.map((run) => run.views.find(({ id }) => id === view.id));
  const observedPhashMax = Math.max(...values.map(({ phash }) => phash));
  const observedNccMin = Math.min(...values.map(({ ncc }) => ncc));
  return {
    ...view,
    thresholds: {
      status: "calibrated-from-three-byte-stable-runtime-capture-sets",
      phashMax: Math.ceil(observedPhashMax + phashMarginAbsolute),
      nccMin: floorHundredth(observedNccMin - nccMarginAbsolute),
      observedPhashMax,
      observedNccMin,
      phashMarginAbsolute,
      nccMarginAbsolute
    }
  };
});
const observedPhashTotalMax = Math.max(...runs.map(({ aggregate }) => aggregate.phashTotal));
const observedNccMeanMin = Math.min(...runs.map(({ aggregate }) => aggregate.nccMean));
const aggregateThresholds = {
  status: "calibrated-from-three-byte-stable-runtime-capture-sets",
  phashTotalMax: Math.ceil(observedPhashTotalMax + phashMarginAbsolute * config.views.length),
  nccMeanMin: floorHundredth(observedNccMeanMin - nccMarginAbsolute),
  observedPhashTotalMax,
  observedNccMeanMin,
  phashMarginAbsolute: phashMarginAbsolute * config.views.length,
  nccMarginAbsolute
};
const expectedRuntime = Object.fromEntries([
  "objectCount",
  "meshCount",
  "materialCount",
  "texturedMaterialCount",
  "lightMappedMaterialCount",
  "geometryCount",
  "triangleEstimate",
  "textureCount"
].map((field) => [field, runs[0].diagnostics[field]]));
const calibratedConfig = {
  ...config,
  status: "technical-runtime-capture-passed",
  capture: { ...config.capture, expectedRuntime },
  views: calibratedViews,
  aggregateThresholds,
  calibration: {
    status: "established-from-three-byte-stable-runtime-capture-sets",
    purpose: "post-capture-regression-baseline-not-independent-acceptance",
    captureSets: REVIEW_RUNTIME_CAPTURE_RUNS,
    sourceMetricThresholdFormula: {
      phashMax: "ceil(max(observed PHASH) + 5)",
      nccMin: "floor((min(observed NCC) - 0.03) * 100) / 100",
      aggregatePhashTotalMax: "ceil(max(observed PHASH total) + 5 * view count)",
      aggregateNccMeanMin: "floor((min(observed NCC mean) - 0.03) * 100) / 100"
    },
    evidenceMetricTolerance: {
      scope: "recorded-metric-comparison-only",
      phashAbsolute: 0.001,
      nccAbsolute: 0.000001
    },
    stabilityEvidencePath: `${REVIEW_RELEASE.provenancePath}/visual-stability.json`
  }
};
await writeFile(join(root, REVIEW_RELEASE.visualParityConfigPath), `${JSON.stringify(calibratedConfig, null, 2)}\n`);
const configRecord = await pathRecord(REVIEW_RELEASE.visualParityConfigPath);

const configSourceRecord = sourceLock.sourceFiles.find(({ path }) => path === REVIEW_RELEASE.visualParityConfigPath);
assert(configSourceRecord, "visual_config_source_lock_record_missing");
Object.assign(configSourceRecord, configRecord);
sourceLock.technicalRuntimeCapture = {
  status: "passed-three-byte-stable-runtime-capture-sets",
  captureRoot: REVIEW_RELEASE.runtimeCapturePath,
  captureSets: REVIEW_RUNTIME_CAPTURE_RUNS,
  visualEvidencePath: `${REVIEW_RELEASE.provenancePath}/visual-parity.json`,
  stabilityEvidencePath: `${REVIEW_RELEASE.provenancePath}/visual-stability.json`,
  humanVisualAcceptance: "pending-human-acceptance",
  humanRightsApproval: REVIEW_RIGHTS_APPROVAL_STATUS
};
await writeFile(join(root, REVIEW_RELEASE.sourceLockPath), `${JSON.stringify(sourceLock, null, 2)}\n`);
const sourceLockRecord = await pathRecord(REVIEW_RELEASE.sourceLockPath);
const indexRecord = acceptanceIndex.releases.find(({ version }) => version === REVIEW_RELEASE_VERSION);
assert(indexRecord, "review_acceptance_index_record_missing");
indexRecord.lockSha256 = sourceLockRecord.sha256;
indexRecord.visualParityConfigSha256 = configRecord.sha256;
indexRecord.technicalRuntimeCapture = "passed-three-byte-stable-runtime-capture-sets";
indexRecord.humanVisualAccepted = false;
await writeFile(join(root, "source", "release-acceptance-index.json"), `${JSON.stringify(acceptanceIndex, null, 2)}\n`);

realityReport.gates.runtimeCapture = "technical-runtime-capture-passed";
realityReport.gates.runtimeCaptureSets = REVIEW_RUNTIME_CAPTURE_RUNS.length;
await writeFile(join(root, REVIEW_RELEASE.provenancePath, "scene-reality-report.json"), `${JSON.stringify(realityReport, null, 2)}\n`);
await writeFile(join(root, REVIEW_RELEASE.provenancePath, "visual-stability.json"), `${JSON.stringify(stabilityEvidence, null, 2)}\n`);

const visualEvidence = {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  releaseVersion: REVIEW_RELEASE_VERSION,
  status: "technical-runtime-capture-passed",
  sourceLock: sourceLockRecord,
  config: configRecord,
  releaseGlb: releaseGlbRecord,
  releaseManifest: releaseManifestRecord,
  platformCommit: calibratedConfig.capture.platformCommit,
  platformPatch: calibratedConfig.capture.platformPatch,
  captureRunner: calibratedConfig.capture.runner,
  capturePolicy: calibratedConfig.capture.cleanVisualMode,
  renderSettings: calibratedConfig.capture.renderSettings,
  metricTool: "ImageMagick compare",
  metricToolVersion,
  thresholdCalibration: calibratedConfig.calibration,
  aggregateThresholds,
  captureSets: runs.map((run) => ({
    id: run.id,
    path: run.path,
    binding: run.binding,
    diagnostics: run.diagnostics,
    settings: run.settings,
    aggregate: run.aggregate,
    views: run.views.map((view) => {
      const threshold = calibratedViews.find(({ id }) => id === view.id).thresholds;
      return {
        id: view.id,
        phash: view.phash,
        ncc: view.ncc,
        threshold: { phashMax: threshold.phashMax, nccMin: threshold.nccMin },
        capture: view.capture,
        passed: view.phash <= threshold.phashMax && view.ncc >= threshold.nccMin
      };
    }),
    passed: run.aggregate.phashTotal <= aggregateThresholds.phashTotalMax
      && run.aggregate.nccMean >= aggregateThresholds.nccMeanMin
  })),
  stabilityEvidence: await pathRecord(`${REVIEW_RELEASE.provenancePath}/visual-stability.json`),
  passed: true,
  humanVisualAcceptance: "pending-human-acceptance",
  humanRightsApproval: REVIEW_RIGHTS_APPROVAL_STATUS,
  publicationReady: false
};
assert(visualEvidence.captureSets.every((run) => run.passed && run.views.every((view) => view.passed)), "calibrated_visual_threshold_failed");
await writeFile(join(root, REVIEW_RELEASE.provenancePath, "visual-parity.json"), `${JSON.stringify(visualEvidence, null, 2)}\n`);

process.stdout.write(`Calibrated ${REVIEW_RELEASE_VERSION} from three byte-stable runtime capture sets: PHASH max margin ${phashMarginAbsolute}, NCC margin ${nccMarginAbsolute}.\n`);
