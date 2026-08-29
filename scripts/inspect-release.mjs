import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { SCENE_ID, VERSION, glbStats } from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
const asset = join(root, "assets", "scenes", SCENE_ID, VERSION, "scene.glb");
const result = spawnSync("gltf-transform", ["inspect", asset], { cwd: root, encoding: "utf8" });
if (result.status !== 0) throw new Error(`gltf_transform_inspect_failed:${result.status}:${result.stderr}`);
await mkdir(join(root, "build"), { recursive: true });
await writeFile(join(root, "build", "gltf-transform-inspect.txt"), result.stdout);
await writeFile(join(root, "build", "inspection.json"), `${JSON.stringify(await glbStats(asset), null, 2)}\n`);
process.stdout.write(result.stdout);
process.stdout.write("Inspection artifacts: build/gltf-transform-inspect.txt, build/inspection.json\n");
