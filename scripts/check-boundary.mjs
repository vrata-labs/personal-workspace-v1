import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

import {
  PUBLISHED_BAKED_VERSIONS,
  RELEASE_FILES,
  RELEASE_VERSIONS,
  REVIEW_RELEASE,
  REVIEW_RELEASE_VIEWS,
  REVIEW_RUNTIME_CAPTURE_RUNS,
  REVIEW_VIEWS,
  RUNTIME_CAPTURE_FILES,
  SCENE_ID,
  assert,
  assertReviewOnlyGates,
  bakedReleaseBinaryPaths,
  bakedReleasePaths,
  readJson
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const binaryExtensions = new Set([".blend", ".glb", ".webp", ".png", ".jpg", ".jpeg", ".fbx", ".gltf"]);
const machineLocalPathRoots = ["tmp", "home", "mnt", "Users", "private/tmp"].map((path) => `/${path}/`);
const windowsLocalPathPattern = /(?:^|[\s"'=(])[A-Za-z]:[\\/]/m;
const allowedBinaries = new Set([
  "source/review-candidate.blend",
  ...REVIEW_VIEWS.map((view) => `source/review/${view}.webp`),
  ...bakedReleaseBinaryPaths(),
  REVIEW_RELEASE.blendPath,
  REVIEW_RELEASE.lightmapPath,
  REVIEW_RELEASE.panoramaPath,
  ...REVIEW_RELEASE_VIEWS.map((view) => `${REVIEW_RELEASE.reviewPath}/${view}.webp`),
  ...REVIEW_RUNTIME_CAPTURE_RUNS.flatMap((run) => REVIEW_RELEASE_VIEWS.map((view) => `${REVIEW_RELEASE.runtimeCapturePath}/${run}/${view}.png`)),
  ...RELEASE_VERSIONS.flatMap((version) => [
    `assets/scenes/${SCENE_ID}/${version}/scene.glb`,
    `assets/scenes/${SCENE_ID}/${version}/preview.webp`
  ])
]);
const historicalRightsJsonPaths = new Set([
  "source/scene-contract.json",
  "source/scene-contract-lock.json",
  "source/review-candidate-lock.json",
  "provenance/asset-ledger.json",
  "provenance/generation-ledger.json",
  "provenance/release-artifact-ledger.json",
  "provenance/metadata-release-0.1.1.json",
  "provenance/baked-lightmap-0.2.0.json"
]);

function posix(path) {
  return path.split(sep).join("/");
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "build"].includes(entry.name)) continue;
    assert(entry.name !== "__pycache__", `forbidden_python_cache:${posix(relative(root, join(directory, entry.name)))}`);
    assert(!entry.name.endsWith(".pyc"), `forbidden_python_bytecode:${posix(relative(root, join(directory, entry.name)))}`);
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else output.push(path);
  }
  return output;
}

const sceneRoots = (await readdir(join(root, "assets", "scenes"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
assert(JSON.stringify(sceneRoots) === JSON.stringify([SCENE_ID]), `single_scene_boundary_violated:${sceneRoots.join(",")}`);

for (const version of PUBLISHED_BAKED_VERSIONS) {
  const paths = bakedReleasePaths(version);
  const bakedEvidence = await readJson(join(root, paths.evidencePath));
  assert(bakedEvidence.releaseVersion === version
    && bakedEvidence.source?.exporter?.path === paths.exportScriptPath
    && bakedEvidence.source?.atlas?.path === paths.lightmapPath
    && bakedEvidence.source?.runtimeReview?.path === paths.runtimeReviewPath
    && bakedEvidence.runtimeCapture?.path === paths.runtimeCapturePath
    && bakedEvidence.release?.path === paths.releasePath, `baked_evidence_repository_path_drift:${version}`);
  assert(JSON.stringify(Object.keys(bakedEvidence.release.files).sort()) === JSON.stringify(RELEASE_FILES), `baked_evidence_release_file_set_drift:${version}`);
  assert(JSON.stringify(Object.keys(bakedEvidence.runtimeCapture.files)) === JSON.stringify(RUNTIME_CAPTURE_FILES), `runtime_capture_evidence_file_set_drift:${version}`);
}

for (const path of await walk(root)) {
  const repositoryPath = posix(relative(root, path));
  if (binaryExtensions.has(extname(repositoryPath).toLowerCase())) {
    assert(allowedBinaries.has(repositoryPath), `unapproved_binary:${repositoryPath}`);
    continue;
  }
  const text = await readFile(path, "utf8").catch(() => "");
  assert(!machineLocalPathRoots.some((pathRoot) => text.includes(pathRoot)) && !windowsLocalPathPattern.test(text), `machine_local_absolute_path:${repositoryPath}`);
  if (extname(repositoryPath).toLowerCase() === ".json") {
    const allowApprovedRights = historicalRightsJsonPaths.has(repositoryPath)
      || repositoryPath.startsWith(`assets/scenes/${SCENE_ID}/0.1.`)
      || repositoryPath.startsWith(`assets/scenes/${SCENE_ID}/0.2.`)
      || repositoryPath.startsWith("provenance/runtime-capture-0.2.0/");
    assertReviewOnlyGates(JSON.parse(text), repositoryPath, {
      allowApprovedRights,
      allowHistoricalManifestRecords: repositoryPath === "manifest.json"
    });
  }
  if (/^(source|provenance|assets)\//.test(repositoryPath)) {
    assert(!/(sensetower|warm-modern-meeting-room|https?:\/\/)/i.test(text), `restricted_or_external_reference:${repositoryPath}`);
  }
}

const reviewBlendText = (await readFile(join(root, REVIEW_RELEASE.blendPath))).toString("latin1");
assert(!machineLocalPathRoots.some((pathRoot) => reviewBlendText.includes(pathRoot))
  && !windowsLocalPathPattern.test(reviewBlendText), `machine_local_absolute_path:${REVIEW_RELEASE.blendPath}`);
assert(!/https?:\/\//i.test(reviewBlendText)
  && !reviewBlendText.includes("0dac0b05ae44d0d8663c049cdde90b2ced7ef559_1_500x500.jpg"), `external_reference_in_blend:${REVIEW_RELEASE.blendPath}`);

process.stdout.write("Single-scene, authored-asset, and portability boundary is valid.\n");
