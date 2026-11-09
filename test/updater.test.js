const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const U = require("../src/updater");

test("newer compares x.y.z numerically", () => {
  assert.ok(U.newer("1.1.0", "1.0.0"));
  assert.ok(U.newer("1.0.10", "1.0.9"));
  assert.ok(U.newer("2.0.0", "1.99.99"));
  assert.ok(!U.newer("1.0.0", "1.0.0"));
  assert.ok(!U.newer("1.0.9", "1.0.10"));
  assert.ok(!U.newer("garbage", "1.0.0"));
  assert.ok(!U.newer("1.2.0", undefined));
});

test("applyZip lays a GitHub-style ZIP over the folder and keeps node_modules, .git and local files", { skip: !fs.existsSync("/usr/bin/unzip") || !fs.existsSync("/usr/bin/rsync") || !fs.existsSync("/usr/bin/zip") }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tk-updtest-"));
  try {
    const src = path.join(tmp, "src", "tickerkite-main"), root = path.join(tmp, "app");
    fs.mkdirSync(path.join(src, "renderer"), { recursive: true });
    fs.mkdirSync(path.join(src, "node_modules", "x"), { recursive: true });
    fs.writeFileSync(path.join(src, "package.json"), '{"version":"1.1.0"}');
    fs.writeFileSync(path.join(src, "renderer", "new.js"), "new");
    fs.writeFileSync(path.join(src, "node_modules", "x", "index.js"), "from zip");
    fs.mkdirSync(path.join(root, "node_modules", "x"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), '{"version":"1.0.0"}');
    fs.writeFileSync(path.join(root, "node_modules", "x", "index.js"), "mine");
    fs.writeFileSync(path.join(root, "my-notes.txt"), "keep me");
    execFileSync("/usr/bin/zip", ["-qr", path.join(tmp, "u.zip"), "tickerkite-main"], { cwd: path.join(tmp, "src") });
    await U.applyZip(path.join(tmp, "u.zip"), root);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version, "1.1.0");
    assert.strictEqual(fs.readFileSync(path.join(root, "renderer", "new.js"), "utf8"), "new");
    assert.strictEqual(fs.readFileSync(path.join(root, "node_modules", "x", "index.js"), "utf8"), "mine");
    assert.strictEqual(fs.readFileSync(path.join(root, "my-notes.txt"), "utf8"), "keep me");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
