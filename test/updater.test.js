import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  safeSourcePath,
  gitBlobSha,
  updateInstallation,
  restart,
} from "../server.js";
const sha = "a".repeat(40),
  treeSha = "b".repeat(40);
const source = {
  "server.js": "// replacement entrypoint",
  "package.json": JSON.stringify({ name: "cosmicdesk" }),
  "package-lock.json": "{}",
  "src/app.js": "// app",
  "src/migrate.js": "// migrations",
  "public/style.css": "body{color:navy}",
};
function fixture(extra = {}) {
  const files = { ...source, ...extra };
  const entries = Object.entries(files).map(([name, value]) => ({
    path: name,
    type: "blob",
    mode: "100644",
    size: Buffer.byteLength(value),
    sha: gitBlobSha(Buffer.from(value)),
  }));
  return {
    getJson: async (url) =>
      url.endsWith("commits/main")
        ? { sha, commit: { tree: { sha: treeSha } } }
        : { tree: entries, truncated: false },
    getBytes: async (url) =>
      Buffer.from(files[decodeURIComponent(url.split("/" + sha + "/")[1])]),
    run: async (command, args, cwd) => {
      assert.equal(command, "npm");
      assert.deepEqual(args, ["ci", "--omit=dev", "--no-audit", "--no-fund"]);
      await fs.mkdir(path.join(cwd, "node_modules"), { recursive: true });
      await fs.writeFile(path.join(cwd, "node_modules", "installed"), "new");
    },
    log: () => {},
  };
}
async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cosmicdesk-update-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test("updater protects configuration, environment and runtime paths", () => {
  for (const name of [
    "config.js",
    ".env",
    ".env.local",
    "uploads/file.txt",
    "data/db",
    "logs/app.log",
    ".git/config",
    "node_modules/a",
    "../server.js",
    "/server.js",
    "C:/app",
    "src/../../config.js",
    "src\\app.js",
    ".cosmicdesk-version.json",
  ])
    assert.equal(safeSourcePath(name), false, name);
  for (const name of [
    "server.js",
    "src/app.js",
    ".github/workflows/checks.yml",
    "config.example.js",
  ])
    assert.equal(safeSourcePath(name), true, name);
});
test("staged update works without Git and preserves local configuration and data", async (t) => {
  const root = await temp(t);
  await fs.writeFile(path.join(root, "server.js"), "old entrypoint");
  await fs.writeFile(path.join(root, "config.js"), "private config");
  await fs.writeFile(path.join(root, ".env"), "private environment");
  await fs.mkdir(path.join(root, "uploads"));
  await fs.writeFile(path.join(root, "uploads", "receipt.txt"), "keep");
  await fs.mkdir(path.join(root, "node_modules"));
  await fs.writeFile(path.join(root, "node_modules", "installed"), "old");
  const result = await updateInstallation({
    root,
    ...fixture({
      "config.js": "overwrite?",
      ".env": "overwrite?",
      "uploads/receipt.txt": "overwrite?",
    }),
  });
  assert.equal(result.updated, true);
  assert.equal(
    await fs.readFile(path.join(root, "server.js"), "utf8"),
    source["server.js"],
  );
  assert.equal(
    await fs.readFile(path.join(root, "config.js"), "utf8"),
    "private config",
  );
  assert.equal(
    await fs.readFile(path.join(root, ".env"), "utf8"),
    "private environment",
  );
  assert.equal(
    await fs.readFile(path.join(root, "uploads", "receipt.txt"), "utf8"),
    "keep",
  );
  assert.equal(
    await fs.readFile(path.join(root, "node_modules", "installed"), "utf8"),
    "new",
  );
  assert.equal(
    await fs.readFile(
      path.join(root, ".cosmicdesk-update", "backup", "server.js"),
      "utf8",
    ),
    "old entrypoint",
  );
  const again = fixture();
  again.getBytes = () => {
    throw Error("must not download");
  };
  assert.equal((await updateInstallation({ root, ...again })).updated, false);
});
test("failed downloads or dependency installation do not replace installed app", async (t) => {
  const root = await temp(t);
  await fs.writeFile(path.join(root, "server.js"), "installed");
  const wrong = fixture();
  wrong.getBytes = async () => Buffer.from("corrupt");
  await assert.rejects(updateInstallation({ root, ...wrong }), /checksum/);
  const install = fixture();
  install.run = async () => {
    throw Error("npm unavailable");
  };
  await assert.rejects(
    updateInstallation({ root, ...install }),
    /npm unavailable/,
  );
  assert.equal(
    await fs.readFile(path.join(root, "server.js"), "utf8"),
    "installed",
  );
});
test("unsupported trees and linked destinations are refused before activation", async (t) => {
  const root = await temp(t);
  const incomplete = fixture();
  incomplete.getJson = async (url) =>
    url.endsWith("commits/main")
      ? { sha, commit: { tree: { sha: treeSha } } }
      : { truncated: true, tree: [] };
  await assert.rejects(
    updateInstallation({ root, ...incomplete }),
    /Incomplete/,
  );
  await fs.mkdir(path.join(root, "public"));
  await fs.mkdir(path.join(root, "public", "style.css"));
  await assert.rejects(
    updateInstallation({ root, ...fixture() }),
    /not a regular file/,
  );
});
test("active updater lock stops a second updater", async (t) => {
  const root = await temp(t);
  await fs.writeFile(
    path.join(root, ".cosmicdesk-update.lock"),
    String(process.pid),
  );
  await assert.rejects(updateInstallation({ root, ...fixture() }), {
    code: "UPDATE_LOCKED",
  });
});
test("restart falls back offline, runs migrations, then starts the installed app", async (t) => {
  const root = await temp(t);
  await fs.mkdir(path.join(root, "node_modules"));
  const calls = [];
  await restart({
    root,
    env: {},
    update: async () => {
      throw Error("offline");
    },
    run: async (cmd, args) => calls.push(args[0]),
    launch: async () => calls.push("serve"),
    log: () => {},
  });
  assert.deepEqual(calls, ["src/migrate.js", "serve"]);
});
test("migration failure and active update locks prevent app startup", async (t) => {
  const root = await temp(t);
  await fs.mkdir(path.join(root, "node_modules"));
  let launched = false;
  const opts = {
    root,
    env: { COSMICDESK_AUTO_UPDATE: "0" },
    run: async () => {
      throw Error("migration failed");
    },
    launch: async () => {
      launched = true;
    },
    log: () => {},
  };
  await assert.rejects(restart(opts), /migration failed/);
  assert.equal(launched, false);
  await assert.rejects(
    restart({
      ...opts,
      env: {},
      update: async () => {
        throw Object.assign(Error("locked"), { code: "UPDATE_LOCKED" });
      },
    }),
    /locked/,
  );
  assert.equal(launched, false);
});
test("activation failure restores both source and installed dependencies", async (t) => {
  const root = await temp(t);
  await fs.writeFile(path.join(root, "server.js"), "working app");
  await fs.mkdir(path.join(root, "node_modules"));
  await fs.writeFile(
    path.join(root, "node_modules", "installed"),
    "working dependencies",
  );
  const options = fixture();
  const install = options.run;
  options.run = async (...args) => {
    await install(...args);
    await fs.mkdir(path.join(root, ".cosmicdesk-version.json"));
  };
  await assert.rejects(
    updateInstallation({ root, ...options }),
    (error) => error.activationStarted === true,
  );
  assert.equal(
    await fs.readFile(path.join(root, "server.js"), "utf8"),
    "working app",
  );
  assert.equal(
    await fs.readFile(path.join(root, "node_modules", "installed"), "utf8"),
    "working dependencies",
  );
  await assert.rejects(fs.stat(path.join(root, "src", "app.js")), {
    code: "ENOENT",
  });
});
