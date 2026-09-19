import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

import {
  REVIEW_RELEASE,
  REVIEW_RELEASE_VERSION,
  REVIEW_RUNTIME_CAPTURE_BINDING_FILE,
  REVIEW_RUNTIME_CAPTURE_ARTIFACT_FILES,
  REVIEW_RUNTIME_CAPTURE_RUNS,
  SCENE_ID,
  assert,
  assertUntrackedOutput,
  fileRecord,
  readJson
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");

function parseArguments(argv) {
  const options = { version: REVIEW_RELEASE_VERSION, run: null };
  for (let index = 0; index < argv.length; index += 1) {
    const [name, inlineValue] = argv[index].split("=", 2);
    assert(["--version", "--run"].includes(name), `unknown_argument:${argv[index]}`);
    const value = inlineValue ?? argv[++index];
    assert(typeof value === "string" && value.length > 0 && !value.startsWith("--"), `missing_argument_value:${name}`);
    if (name === "--version") options.version = value;
    else options.run = value;
  }
  assert(options.version === REVIEW_RELEASE_VERSION, `unsupported_capture_binding_version:${options.version}`);
  if (options.run !== null) assert(REVIEW_RUNTIME_CAPTURE_RUNS.includes(options.run), `invalid_capture_run:${options.run}`);
  return options;
}

async function normalizeDiagnostics(path) {
  const diagnostics = JSON.parse(await readFile(path, "utf8"));
  const sceneDebug = diagnostics.sceneDebug ?? diagnostics;
  if (typeof sceneDebug.bundleUrl === "string") sceneDebug.bundleUrl = "local-capture/scene.json";
  if (typeof sceneDebug.assetUrl === "string") sceneDebug.assetUrl = "local-capture/scene.glb";
  await writeFile(path, `${JSON.stringify(diagnostics, null, 2)}\n`);
}

const options = parseArguments(process.argv.slice(2));
const captureRootInput = process.env.SCENE_VISUAL_CAPTURE_ROOT ?? REVIEW_RELEASE.runtimeCapturePath;
const captureRoot = isAbsolute(captureRootInput) ? captureRootInput : resolve(root, captureRootInput);
const config = await readJson(join(root, REVIEW_RELEASE.visualParityConfigPath));
assert(config.schemaVersion === 1 && config.sceneId === SCENE_ID && config.releaseVersion === REVIEW_RELEASE_VERSION, "invalid_review_capture_config");
assert(config.capture.bindingFile === REVIEW_RUNTIME_CAPTURE_BINDING_FILE, "invalid_capture_binding_file");
assert(JSON.stringify(config.capture.repeatSets) === JSON.stringify(REVIEW_RUNTIME_CAPTURE_RUNS), "review_capture_run_set_drift");

const [releaseGlbRecord, releaseManifestRecord, platformPatchRecord] = await Promise.all([
  fileRecord(join(root, config.releaseGlb.path)),
  fileRecord(join(root, config.releaseManifest.path)),
  fileRecord(join(root, config.capture.platformPatch.path))
]);
assert(JSON.stringify(releaseGlbRecord) === JSON.stringify({ sha256: config.releaseGlb.sha256, sizeBytes: config.releaseGlb.sizeBytes }), "capture_binding_release_glb_drift");
assert(JSON.stringify(releaseManifestRecord) === JSON.stringify({ sha256: config.releaseManifest.sha256, sizeBytes: config.releaseManifest.sizeBytes }), "capture_binding_release_manifest_drift");
assert(platformPatchRecord.sha256 === config.capture.platformPatch.sha256, "capture_binding_platform_patch_drift");

const runs = options.run === null ? REVIEW_RUNTIME_CAPTURE_RUNS : [options.run];
for (const run of runs) {
  const outputDir = join(captureRoot, run);
  await assertUntrackedOutput(root, outputDir);
  await assertUntrackedOutput(root, join(outputDir, config.capture.runtimeDiagnosticsFile));
  await assertUntrackedOutput(root, join(outputDir, config.capture.bindingFile));
  for (const name of REVIEW_RUNTIME_CAPTURE_ARTIFACT_FILES) await fileRecord(join(outputDir, name));
}
for (const run of runs) {
  const outputDir = join(captureRoot, run);
  await mkdir(outputDir, { recursive: true });
  await normalizeDiagnostics(join(outputDir, config.capture.runtimeDiagnosticsFile));
  const captureFiles = {};
  for (const name of REVIEW_RUNTIME_CAPTURE_ARTIFACT_FILES) {
    assert(basename(name) === name, `invalid_capture_file_name:${name}`);
    captureFiles[name] = { path: name, ...await fileRecord(join(outputDir, name)) };
  }
  const binding = {
    schemaVersion: 1,
    kind: "version-bound-local-runtime-capture-record",
    sceneId: SCENE_ID,
    releaseVersion: REVIEW_RELEASE_VERSION,
    captureSet: run,
    scope: "technical-runtime-capture-only",
    provenanceScope: {
      candidateCiReplaysCapture: false,
      candidateCiValidatesCommittedArtifacts: true,
      independentVerification: "required-on-exact-merge-sha-staging"
    },
    humanVisualAccepted: false,
    rightsApproved: false,
    publicationReady: false,
    platformCommit: config.capture.platformCommit,
    platformPatch: config.capture.platformPatch,
    captureRunner: config.capture.runner,
    capturePolicy: config.capture.cleanVisualMode,
    normalization: {
      status: "applied",
      kind: "machine-local-url-replacement",
      fields: {
        bundleUrl: "local-capture/scene.json",
        assetUrl: "local-capture/scene.glb"
      },
      machineLocalUrlsRetained: false
    },
    releaseGlb: config.releaseGlb,
    releaseManifest: config.releaseManifest,
    captureFiles
  };
  const bindingPath = join(outputDir, config.capture.bindingFile);
  await writeFile(bindingPath, `${JSON.stringify(binding, null, 2)}\n`);
  process.stdout.write(`Capture binding ${REVIEW_RELEASE_VERSION}/${run}: ${bindingPath}\n`);
}
