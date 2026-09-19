import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { assertScratchOutput, assertUntrackedOutput } from "../scripts/lib.mjs";

const root = resolve(import.meta.dirname, "..");

test("write guards reject missing tracked files, symlinks and unavailable Git before writing", async () => {
  await mkdir(join(root, "build"), { recursive: true });
  const temporary = await mkdtemp(join(root, "build/write-safety-"));
  const fixture = join(temporary, "repository");
  function git(args) {
    const result = spawnSync("git", args, { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  function python(path, expected, scratch = false) {
    const result = spawnSync("python3", ["-B", "-c", "import runpy, sys; runpy.run_path(sys.argv[1])['assert_output'](sys.argv[2], root=sys.argv[3], scratch=sys.argv[4]=='true')",
      join(root, "source/write_safety.py"), path, fixture, String(scratch)], { encoding: "utf8" });
    if (expected) {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, expected);
    } else assert.equal(result.status, 0, result.stderr);
  }
  try {
    git(["clone", "--shared", "--no-checkout", root, fixture]);
    git(["-C", fixture, "read-tree", "HEAD"]);
    await assert.rejects(assertUntrackedOutput(fixture, "README.md"), /tracked_output_forbidden/);
    const pinned = join(fixture, "source/releases/0.3.0/pinned.png");
    await mkdir(join(fixture, "source/releases/0.3.0"), { recursive: true });
    await writeFile(pinned, "accepted");
    git(["-C", fixture, "add", "source/releases/0.3.0/pinned.png"]);
    await rm(pinned);
    await assert.rejects(assertUntrackedOutput(fixture, pinned), /tracked_output_forbidden/);
    python(pinned, /tracked_output_forbidden/);
    await mkdir(join(fixture, "build"), { recursive: true });
    const fresh = join(fixture, "build/new/report.json");
    await assertScratchOutput(fixture, fresh);
    python(fresh, null, true);
    await assert.rejects(assertScratchOutput(fixture, "provenance/generation-ledger.json"), /report_output_must_be_under_build/);
    python(join(fixture, "assets/scenes/scene/0.2.0/scene.glb"), /output_path_forbidden/, true);
    await symlink(join(fixture, "source"), join(fixture, "build/redirect"));
    await assert.rejects(assertScratchOutput(fixture, "build/redirect/output.json"), /output_symlink_forbidden/);
    python(join(fixture, "build/redirect/output.json"), /output_symlink_forbidden/, true);
    git(["-C", fixture, "symbolic-ref", "HEAD", "refs/heads/missing"]);
    await assert.rejects(assertUntrackedOutput(fixture, "build/new.json"), /git_head_path_query_failed/);
    python(join(fixture, "build/new.json"), /git_head_output_query_failed/, true);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("capture generator rejects binding path traversal before any write", () => {
  const configPath = join(root, "source/releases/0.3.0/visual-parity-config.json");
  const generatorUrl = pathToFileURL(join(root, "scripts/create-review-capture-binding.mjs")).href;
  for (const bindingFile of ["../../generation-ledger.json", "../run-2/capture-binding.json"]) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import fs from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      const originalRead = fs.promises.readFile;
      fs.promises.readFile = async (path, ...args) => {
        const result = await originalRead(path, ...args);
        if (String(path) !== ${JSON.stringify(configPath)}) return result;
        const config = JSON.parse(result);
        config.capture.bindingFile = ${JSON.stringify(bindingFile)};
        return JSON.stringify(config);
      };
      fs.promises.writeFile = async () => { throw new Error("unexpected_write"); };
      syncBuiltinESMExports();
      process.argv = [process.execPath, "capture-binding-test"];
      await import(${JSON.stringify(generatorUrl)});
    `], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid_capture_binding_file/);
    assert.doesNotMatch(result.stderr, /unexpected_write/);
  }
});
