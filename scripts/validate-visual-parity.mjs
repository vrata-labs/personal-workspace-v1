import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import { BAKED_RELEASE, BAKED_RELEASE_VERSION, REVIEW_VIEWS, assert, fileRecord, readJson } from "./lib.mjs";
import { FINAL_TECHNICAL_VISUAL_PARITY_POLICY } from "./visual-parity-config.mjs";

const root = resolve(import.meta.dirname, "..");
const outputDir = resolve(root, process.env.SCENE_VISUAL_OUTPUT_DIR ?? BAKED_RELEASE.runtimeCapturePath);
const reportPath = resolve(root, process.env.SCENE_VISUAL_REPORT_PATH ?? `build/visual-parity-${BAKED_RELEASE_VERSION}.json`);
const evidence = await readJson(join(root, "provenance", `baked-lightmap-${BAKED_RELEASE_VERSION}.json`));

function repositoryPath(path) {
  return relative(root, path).split(sep).join("/");
}

function compare(metric, reference, actual) {
  const result = spawnSync("compare", ["-metric", metric, reference, actual, "null:"], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) throw new Error(`image_compare_failed:${metric}:${result.stderr.trim()}`);
  const value = Number.parseFloat(result.stderr.trim().split(/\s+/)[0] ?? "");
  if (!Number.isFinite(value)) throw new Error(`invalid_image_metric:${metric}:${result.stderr.trim()}`);
  return value;
}

function imageMagickVersion() {
  const result = spawnSync("compare", ["-version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`imagemagick_version_failed:${result.error?.message ?? result.stderr.trim()}`);
  return result.stdout.split(/\r?\n/, 1)[0].replace(/^Version:\s*/, "").trim();
}

function withinTolerance(actual, expected, tolerance) {
  return Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance;
}

const results = [];
const metricToolVersion = imageMagickVersion();
const tolerance = FINAL_TECHNICAL_VISUAL_PARITY_POLICY.evidenceMetricTolerance;
assert(JSON.stringify(Object.keys(FINAL_TECHNICAL_VISUAL_PARITY_POLICY.views)) === JSON.stringify(REVIEW_VIEWS), "visual_policy_view_set_drift");
assert(JSON.stringify(evidence.visualParity.policy) === JSON.stringify(FINAL_TECHNICAL_VISUAL_PARITY_POLICY), "visual_policy_provenance_drift");
assert(/^ImageMagick\s+\S+/.test(evidence.visualParity.toolVersion), "visual_tool_version_missing");
for (const [view, threshold] of Object.entries(FINAL_TECHNICAL_VISUAL_PARITY_POLICY.views)) {
  const reference = join(root, "source", "review", `${view}.webp`);
  const actual = join(outputDir, `${view}.png`);
  await Promise.all([readFile(reference), readFile(actual)]);
  const expectedFile = evidence.runtimeCapture.files[`${view}.png`];
  assert(expectedFile?.path === repositoryPath(actual), `runtime_capture_path_drift:${view}`);
  const actualRecord = await fileRecord(actual);
  assert(actualRecord.sha256 === expectedFile.sha256 && actualRecord.sizeBytes === expectedFile.sizeBytes, `runtime_capture_record_drift:${view}`);
  const phash = compare("PHASH", reference, actual);
  const ncc = compare("NCC", reference, actual);
  const expectedMetric = evidence.visualParity.views.find(({ id }) => id === view);
  assert(withinTolerance(phash, expectedMetric?.phash, tolerance.phashAbsolute)
    && withinTolerance(ncc, expectedMetric?.ncc, tolerance.nccAbsolute), `visual_metric_drift:${view}:${phash}:${ncc}`);
  results.push({ view, phash, ncc, threshold, passed: phash <= threshold.phashMax && ncc >= threshold.nccMin });
}

const phashTotal = results.reduce((total, result) => total + result.phash, 0);
const nccMean = results.reduce((total, result) => total + result.ncc, 0) / results.length;
const { aggregate } = FINAL_TECHNICAL_VISUAL_PARITY_POLICY;
assert(withinTolerance(phashTotal, evidence.visualParity.aggregate.phashTotal, tolerance.phashAbsolute * results.length)
  && withinTolerance(nccMean, evidence.visualParity.aggregate.nccMean, tolerance.nccAbsolute), `visual_aggregate_drift:${phashTotal}:${nccMean}`);
const report = {
  schemaVersion: 1,
  metricTool: "ImageMagick compare",
  metricToolVersion,
  evidenceMetricToolVersion: evidence.visualParity.toolVersion,
  policy: FINAL_TECHNICAL_VISUAL_PARITY_POLICY,
  outputDirectory: repositoryPath(outputDir),
  aggregate: { phashTotal, nccMean },
  views: results,
  passed: results.every(({ passed }) => passed) && phashTotal <= aggregate.phashTotalMax && nccMean >= aggregate.nccMeanMin
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) throw new Error(`visual_parity_failed:${reportPath}`);
process.stdout.write(`Technical visual parity passed: PHASH total ${phashTotal.toFixed(5)}, NCC mean ${nccMean.toFixed(8)}\n`);
