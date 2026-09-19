import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  REVIEW_RELEASE,
  REVIEW_RELEASE_VERSION,
  REVIEW_RELEASE_VIEWS,
  REVIEW_RIGHTS_APPROVAL_STATUS,
  REVIEW_RUNTIME_CAPTURE_ARTIFACT_FILES,
  REVIEW_RUNTIME_CAPTURE_FILES,
  REVIEW_RUNTIME_CAPTURE_RUNS,
  SCENE_ID,
  assert,
  assertScratchOutput,
  fileRecord,
  pngDimensions,
  readJson
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const reportPath = resolve(root, process.env.SCENE_VISUAL_REPORT_PATH ?? `build/visual-parity-${REVIEW_RELEASE_VERSION}.json`);
await assertScratchOutput(root, reportPath);

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

function withinTolerance(actual, expected, tolerance) {
  return Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance;
}

function floorHundredth(value) {
  return Math.floor((value + Number.EPSILON) * 100) / 100;
}

function assertRecord(actual, expected, code) {
  assert(actual?.sha256 === expected?.sha256 && actual?.sizeBytes === expected?.sizeBytes, code);
}

async function pathRecord(repositoryPath) {
  return { path: repositoryPath, ...await fileRecord(join(root, repositoryPath)) };
}

async function assertPathRecord(record, code) {
  assert(record?.path && !record.path.startsWith("/") && !record.path.includes("..") && !record.path.includes("\\"), `${code}:path`);
  assertRecord(await pathRecord(record.path), record, code);
}

const [config, evidence, stability, sceneManifest] = await Promise.all([
  readJson(join(root, REVIEW_RELEASE.visualParityConfigPath)),
  readJson(join(root, REVIEW_RELEASE.provenancePath, "visual-parity.json")),
  readJson(join(root, REVIEW_RELEASE.provenancePath, "visual-stability.json")),
  readJson(join(root, REVIEW_RELEASE.releasePath, "scene.json"))
]);
const metricToolVersion = imageMagickVersion();
const tolerance = config.calibration?.evidenceMetricTolerance;
assert(config.schemaVersion === 1
  && config.sceneId === SCENE_ID
  && config.releaseVersion === REVIEW_RELEASE_VERSION
  && config.status === "technical-runtime-capture-passed", "invalid_review_visual_config_identity");
assert(JSON.stringify(config.capture.repeatSets) === JSON.stringify(REVIEW_RUNTIME_CAPTURE_RUNS), "review_visual_capture_set_drift");
assert(JSON.stringify(config.views.map(({ id }) => id)) === JSON.stringify(REVIEW_RELEASE_VIEWS), "review_visual_view_set_drift");
assert(config.calibration.status === "established-from-three-byte-stable-runtime-capture-sets"
  && config.calibration.purpose === "post-capture-regression-baseline-not-independent-acceptance"
  && JSON.stringify(config.calibration.captureSets) === JSON.stringify(REVIEW_RUNTIME_CAPTURE_RUNS)
  && tolerance.scope === "recorded-metric-comparison-only"
  && tolerance.phashAbsolute === 0.001
  && tolerance.nccAbsolute === 0.000001, "review_visual_calibration_policy_drift");
assert(config.humanGates.visualAcceptance === "pending-human-acceptance"
  && config.humanGates.rightsApproval === REVIEW_RIGHTS_APPROVAL_STATUS
  && config.humanGates.publicationReady === false, "review_visual_human_gate_drift");

const [releaseGlbRecord, releaseManifestRecord, platformPatchRecord] = await Promise.all([
  pathRecord(`${REVIEW_RELEASE.releasePath}/scene.glb`),
  pathRecord(`${REVIEW_RELEASE.releasePath}/scene.json`),
  pathRecord(REVIEW_RELEASE.platformPatchPath)
]);
assertRecord(config.releaseGlb, releaseGlbRecord, "review_visual_glb_config_drift");
assertRecord(config.releaseManifest, releaseManifestRecord, "review_visual_manifest_config_drift");
assertRecord(config.capture.platformPatch, platformPatchRecord, "review_visual_patch_config_drift");

assert(evidence.schemaVersion === 1
  && evidence.sceneId === SCENE_ID
  && evidence.releaseVersion === REVIEW_RELEASE_VERSION
  && evidence.status === "technical-runtime-capture-passed"
  && evidence.passed === true, "invalid_review_visual_evidence_identity");
assert(evidence.platformCommit === config.capture.platformCommit
  && JSON.stringify(evidence.platformPatch) === JSON.stringify(config.capture.platformPatch)
  && JSON.stringify(evidence.captureRunner) === JSON.stringify(config.capture.runner)
  && JSON.stringify(evidence.capturePolicy) === JSON.stringify(config.capture.cleanVisualMode)
  && JSON.stringify(evidence.renderSettings) === JSON.stringify(config.capture.renderSettings), "review_visual_evidence_harness_drift");
assert(/^ImageMagick\s+\S+/.test(evidence.metricToolVersion)
  && evidence.metricTool === "ImageMagick compare", "review_visual_evidence_tool_missing");
assert(evidence.humanVisualAcceptance === "pending-human-acceptance"
  && evidence.humanRightsApproval === REVIEW_RIGHTS_APPROVAL_STATUS
  && evidence.publicationReady === false, "review_visual_evidence_human_gate_drift");
for (const record of [evidence.sourceLock, evidence.config, evidence.releaseGlb, evidence.releaseManifest, evidence.stabilityEvidence]) {
  await assertPathRecord(record, `review_visual_evidence_record_drift:${record?.path ?? "missing"}`);
}
assertRecord(evidence.config, await pathRecord(REVIEW_RELEASE.visualParityConfigPath), "review_visual_evidence_config_drift");
assertRecord(evidence.releaseGlb, releaseGlbRecord, "review_visual_evidence_glb_drift");
assertRecord(evidence.releaseManifest, releaseManifestRecord, "review_visual_evidence_manifest_drift");

assert(stability.schemaVersion === 1
  && stability.sceneId === SCENE_ID
  && stability.releaseVersion === REVIEW_RELEASE_VERSION
  && stability.status === "stable-three-runtime-capture-sets"
  && stability.thresholdsEstablished === true, "invalid_review_visual_stability_identity");
assert(JSON.stringify(stability.policy) === JSON.stringify({
  requiredCaptureSets: 3,
  imageBytesIdenticalAcrossRuns: true,
  pairwisePhashMax: 0,
  pairwiseNccMin: 1
}), "review_visual_stability_policy_drift");
assert(stability.comparison.imagesByteIdenticalAcrossRuns === true
  && stability.comparison.maximumPairwisePhash === 0
  && stability.comparison.minimumPairwiseNcc === 1, "review_visual_stability_result_drift");
assert(stability.platformCommit === config.capture.platformCommit
  && JSON.stringify(stability.platformPatch) === JSON.stringify(config.capture.platformPatch), "review_visual_stability_harness_drift");
assertRecord(stability.releaseGlb, releaseGlbRecord, "review_visual_stability_glb_drift");
assertRecord(stability.releaseManifest, releaseManifestRecord, "review_visual_stability_manifest_drift");
assert(stability.humanVisualAcceptance === "pending-human-acceptance"
  && stability.humanRightsApproval === REVIEW_RIGHTS_APPROVAL_STATUS
  && stability.publicationReady === false, "review_visual_stability_human_gate_drift");

const runResults = [];
for (const runId of REVIEW_RUNTIME_CAPTURE_RUNS) {
  const runPath = `${REVIEW_RELEASE.runtimeCapturePath}/${runId}`;
  const runDir = join(root, runPath);
  const entries = (await readdir(runDir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  assert(JSON.stringify(entries) === JSON.stringify([...REVIEW_RUNTIME_CAPTURE_FILES].sort()), `review_capture_file_set_drift:${runId}`);
  const [binding, diagnostics, settings] = await Promise.all([
    readJson(join(runDir, "capture-binding.json")),
    readJson(join(runDir, config.capture.runtimeDiagnosticsFile)),
    readJson(join(runDir, config.capture.renderSettingsFile))
  ]);
  const sceneDebug = diagnostics.sceneDebug ?? diagnostics;
  assert(binding.schemaVersion === 1
    && binding.kind === "version-bound-local-runtime-capture-record"
    && binding.sceneId === SCENE_ID
    && binding.releaseVersion === REVIEW_RELEASE_VERSION
    && binding.captureSet === runId
    && binding.scope === "technical-runtime-capture-only"
    && binding.humanVisualAccepted === false
    && binding.rightsApproved === false
    && binding.publicationReady === false, `review_capture_binding_identity_drift:${runId}`);
  assert(binding.provenanceScope?.candidateCiReplaysCapture === false
    && binding.provenanceScope?.candidateCiValidatesCommittedArtifacts === true
    && binding.provenanceScope?.independentVerification === "required-on-exact-merge-sha-staging", `review_capture_provenance_scope_drift:${runId}`);
  assert(binding.platformCommit === config.capture.platformCommit
    && JSON.stringify(binding.platformPatch) === JSON.stringify(config.capture.platformPatch)
    && JSON.stringify(binding.captureRunner) === JSON.stringify(config.capture.runner)
    && JSON.stringify(binding.capturePolicy) === JSON.stringify(config.capture.cleanVisualMode), `review_capture_binding_harness_drift:${runId}`);
  assertRecord(binding.releaseGlb, releaseGlbRecord, `review_capture_binding_glb_drift:${runId}`);
  assertRecord(binding.releaseManifest, releaseManifestRecord, `review_capture_binding_manifest_drift:${runId}`);
  assert(binding.normalization.status === "applied"
    && binding.normalization.kind === "machine-local-url-replacement"
    && binding.normalization.machineLocalUrlsRetained === false
    && sceneDebug.bundleUrl === "local-capture/scene.json"
    && sceneDebug.assetUrl === "local-capture/scene.glb", `review_capture_normalization_drift:${runId}`);
  assert(!/(?:https?:\/\/(?:127\.0\.0\.1|localhost)|\/(?:tmp|home|mnt)\/|[A-Za-z]:[\\/])/.test(JSON.stringify({ binding, diagnostics })), `review_capture_machine_local_value:${runId}`);
  assert(JSON.stringify(settings) === JSON.stringify(config.capture.renderSettings), `review_capture_settings_drift:${runId}`);
  assert(sceneDebug.state === config.capture.requiredState
    && sceneDebug.failureReason === config.capture.requiredFailureReason
    && Array.isArray(sceneDebug.missingAssets)
    && sceneDebug.missingAssets.length === 0
    && sceneDebug.assetBytesLoaded === releaseGlbRecord.sizeBytes
    && sceneDebug.assetBytesExpected === releaseGlbRecord.sizeBytes
    && sceneDebug.renderProfile === config.capture.requiredRenderProfile
    && sceneDebug.lightMappedMaterialCount >= config.capture.minimumLightMappedMaterialCount, `review_capture_runtime_load_drift:${runId}`);
  for (const [field, expected] of Object.entries(config.capture.expectedRuntime)) {
    assert(sceneDebug[field] === expected, `review_capture_runtime_stat_drift:${runId}:${field}`);
  }
  assert(sceneDebug.spawnPointId === config.capture.expectedSpawn.id
    && sceneDebug.spawnYaw === config.capture.expectedSpawn.yaw
    && sceneDebug.spawnApplied === config.capture.expectedSpawn.applied
    && JSON.stringify(sceneManifest.spawnPoints[0].position) === JSON.stringify(config.capture.expectedSpawn.position), `review_capture_spawn_drift:${runId}`);
  assert(JSON.stringify(Object.keys(binding.captureFiles)) === JSON.stringify(REVIEW_RUNTIME_CAPTURE_ARTIFACT_FILES), `review_capture_binding_file_set_drift:${runId}`);
  for (const name of REVIEW_RUNTIME_CAPTURE_ARTIFACT_FILES) {
    const record = await fileRecord(join(runDir, name));
    assert(binding.captureFiles[name]?.path === name, `review_capture_binding_file_path_drift:${runId}:${name}`);
    assertRecord(binding.captureFiles[name], record, `review_capture_binding_file_record_drift:${runId}:${name}`);
  }

  const evidenceRun = evidence.captureSets.find(({ id }) => id === runId);
  const stabilityRun = stability.captureSets.find(({ id }) => id === runId);
  assert(evidenceRun?.path === runPath && stabilityRun?.path === runPath, `review_capture_evidence_run_missing:${runId}`);
  for (const record of [evidenceRun.binding, evidenceRun.diagnostics.record, evidenceRun.settings, stabilityRun.binding, stabilityRun.diagnostics.record, stabilityRun.settings]) {
    await assertPathRecord(record, `review_capture_evidence_artifact_drift:${runId}:${record?.path ?? "missing"}`);
  }
  assertRecord(evidenceRun.binding, await pathRecord(`${runPath}/capture-binding.json`), `review_capture_evidence_binding_drift:${runId}`);
  const views = [];
  for (const view of config.views) {
    const capturePath = `${runPath}/${view.captureFile}`;
    const captureRecord = await pathRecord(capturePath);
    assert(JSON.stringify(pngDimensions(await readFile(join(root, capturePath)))) === JSON.stringify({ width: 960, height: 540 }), `review_capture_dimensions_drift:${runId}:${view.id}`);
    const evidenceView = evidenceRun.views.find(({ id }) => id === view.id);
    const stabilityView = stabilityRun.images.find(({ id }) => id === view.id);
    assertRecord(evidenceView?.capture, captureRecord, `review_capture_visual_record_drift:${runId}:${view.id}`);
    assertRecord(stabilityView, captureRecord, `review_capture_stability_record_drift:${runId}:${view.id}`);
    const phash = compare("PHASH", join(root, view.referencePath), join(root, capturePath));
    const ncc = compare("NCC", join(root, view.referencePath), join(root, capturePath));
    assert(withinTolerance(phash, evidenceView?.phash, tolerance.phashAbsolute)
      && withinTolerance(ncc, evidenceView?.ncc, tolerance.nccAbsolute), `review_capture_metric_drift:${runId}:${view.id}:${phash}:${ncc}`);
    assert(phash <= view.thresholds.phashMax && ncc >= view.thresholds.nccMin, `review_capture_view_threshold_failed:${runId}:${view.id}:${phash}:${ncc}`);
    views.push({ id: view.id, phash, ncc, capture: captureRecord, passed: true });
  }
  const aggregate = {
    phashTotal: views.reduce((total, view) => total + view.phash, 0),
    nccMean: views.reduce((total, view) => total + view.ncc, 0) / views.length
  };
  assert(withinTolerance(aggregate.phashTotal, evidenceRun.aggregate.phashTotal, tolerance.phashAbsolute * views.length)
    && withinTolerance(aggregate.nccMean, evidenceRun.aggregate.nccMean, tolerance.nccAbsolute), `review_capture_aggregate_evidence_drift:${runId}`);
  assert(aggregate.phashTotal <= config.aggregateThresholds.phashTotalMax
    && aggregate.nccMean >= config.aggregateThresholds.nccMeanMin
    && evidenceRun.passed === true, `review_capture_aggregate_threshold_failed:${runId}`);
  runResults.push({ id: runId, aggregate, views, passed: true });
}

const pairwiseResults = [];
for (let leftIndex = 0; leftIndex < REVIEW_RUNTIME_CAPTURE_RUNS.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < REVIEW_RUNTIME_CAPTURE_RUNS.length; rightIndex += 1) {
    const left = REVIEW_RUNTIME_CAPTURE_RUNS[leftIndex];
    const right = REVIEW_RUNTIME_CAPTURE_RUNS[rightIndex];
    const recordedPair = stability.comparison.pairwise.find((pair) => pair.left === left && pair.right === right);
    assert(recordedPair, `review_capture_stability_pair_missing:${left}:${right}`);
    const views = [];
    for (const view of config.views) {
      const leftPath = join(root, REVIEW_RELEASE.runtimeCapturePath, left, view.captureFile);
      const rightPath = join(root, REVIEW_RELEASE.runtimeCapturePath, right, view.captureFile);
      const [leftRecord, rightRecord] = await Promise.all([fileRecord(leftPath), fileRecord(rightPath)]);
      const byteIdentical = leftRecord.sha256 === rightRecord.sha256 && leftRecord.sizeBytes === rightRecord.sizeBytes;
      const phash = compare("PHASH", leftPath, rightPath);
      const ncc = compare("NCC", leftPath, rightPath);
      const recorded = recordedPair.views.find(({ id }) => id === view.id);
      assert(byteIdentical
        && recorded?.byteIdentical === true
        && withinTolerance(phash, recorded.phash, tolerance.phashAbsolute)
        && withinTolerance(ncc, recorded.ncc, tolerance.nccAbsolute)
        && phash <= stability.policy.pairwisePhashMax
        && ncc >= stability.policy.pairwiseNccMin, `review_capture_stability_failed:${left}:${right}:${view.id}`);
      views.push({ id: view.id, phash, ncc, byteIdentical });
    }
    pairwiseResults.push({ left, right, views, passed: true });
  }
}

for (const view of config.views) {
  const observed = evidence.captureSets.map((run) => run.views.find(({ id }) => id === view.id));
  const observedPhashMax = Math.max(...observed.map(({ phash }) => phash));
  const observedNccMin = Math.min(...observed.map(({ ncc }) => ncc));
  assert(view.thresholds.status === "calibrated-from-three-byte-stable-runtime-capture-sets"
    && withinTolerance(view.thresholds.observedPhashMax, observedPhashMax, tolerance.phashAbsolute)
    && withinTolerance(view.thresholds.observedNccMin, observedNccMin, tolerance.nccAbsolute)
    && view.thresholds.phashMarginAbsolute === 5
    && view.thresholds.nccMarginAbsolute === 0.03
    && view.thresholds.phashMax === Math.ceil(observedPhashMax + 5)
    && view.thresholds.nccMin === floorHundredth(observedNccMin - 0.03), `review_capture_threshold_calibration_drift:${view.id}`);
}
const observedPhashTotalMax = Math.max(...evidence.captureSets.map(({ aggregate }) => aggregate.phashTotal));
const observedNccMeanMin = Math.min(...evidence.captureSets.map(({ aggregate }) => aggregate.nccMean));
assert(config.aggregateThresholds.status === "calibrated-from-three-byte-stable-runtime-capture-sets"
  && config.aggregateThresholds.phashMarginAbsolute === 35
  && config.aggregateThresholds.nccMarginAbsolute === 0.03
  && config.aggregateThresholds.phashTotalMax === Math.ceil(observedPhashTotalMax + 35)
  && config.aggregateThresholds.nccMeanMin === floorHundredth(observedNccMeanMin - 0.03), "review_capture_aggregate_calibration_drift");

const report = {
  schemaVersion: 1,
  sceneId: SCENE_ID,
  releaseVersion: REVIEW_RELEASE_VERSION,
  metricTool: "ImageMagick compare",
  metricToolVersion,
  evidenceMetricToolVersion: evidence.metricToolVersion,
  config: await pathRecord(REVIEW_RELEASE.visualParityConfigPath),
  captureSets: runResults,
  pairwiseStability: pairwiseResults,
  thresholds: {
    views: Object.fromEntries(config.views.map(({ id, thresholds }) => [id, { phashMax: thresholds.phashMax, nccMin: thresholds.nccMin }])),
    aggregate: config.aggregateThresholds
  },
  passed: true,
  humanVisualAcceptance: "pending-human-acceptance",
  humanRightsApproval: REVIEW_RIGHTS_APPROVAL_STATUS,
  publicationReady: false
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Technical visual parity passed for ${REVIEW_RELEASE_VERSION}: 3 version-bound capture sets, 21 source comparisons, and 21 byte-identical pairwise comparisons.\n`);
