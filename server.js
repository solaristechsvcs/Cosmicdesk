import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY = "solaristechsvcs/Cosmicdesk";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATE = ".cosmicdesk-version.json";
const WORK = ".cosmicdesk-update";
const LOCK = ".cosmicdesk-update.lock";
const MAX_FILE = 5 * 1024 * 1024;
const MAX_TOTAL = 50 * 1024 * 1024;

export function safeSourcePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    value.includes(":") ||
    value.startsWith("/")
  )
    return false;
  const parts = value.split("/");
  if (parts.some((p) => !p || p === "." || p === "..")) return false;
  return !parts.some(
    (p) =>
      /^\.(git|env)(\.|$)/i.test(p) ||
      /^\.cosmicdesk-/i.test(p) ||
      ["node_modules", "uploads", "data", "logs", "config.js"].includes(
        p.toLowerCase(),
      ),
  );
}
export function gitBlobSha(bytes) {
  return createHash("sha1")
    .update(Buffer.from("blob " + bytes.length + "\0"))
    .update(bytes)
    .digest("hex");
}
async function exists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
export async function runCommand(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32" && command === "npm",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(command + " failed (" + (signal || code) + ")")),
    );
  });
}
async function getResponse(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "CosmicDesk-restart-updater",
      Accept: "application/vnd.github+json",
    },
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("GitHub returned HTTP " + response.status);
  return response;
}
async function json(url) {
  return (await getResponse(url)).json();
}
async function bytes(url) {
  const response = await getResponse(url);
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_FILE) throw new Error("Source file exceeds update limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function assertRegularDestination(root, relative) {
  let target = root;
  for (const component of relative.split("/")) {
    target = path.join(target, component);
    try {
      const entry = await fs.lstat(target);
      if (entry.isSymbolicLink())
        throw new Error("Refusing to replace symbolic link: " + relative);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
}
async function atomicWrite(target, content) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = target + ".cosmicdesk-temp";
  await fs.writeFile(tmp, content);
  try {
    await fs.rename(tmp, target);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
async function acquireLock(root) {
  const lock = path.join(root, LOCK);
  try {
    const handle = await fs.open(lock, "wx");
    await handle.writeFile(String(process.pid));
    await handle.close();
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const pid = Number(await fs.readFile(lock, "utf8"));
    if (!Number.isInteger(pid) || pid < 1)
      throw Object.assign(
        new Error(
          "Invalid update lock. Stop other server instances before removing " +
            LOCK,
        ),
        { code: "UPDATE_LOCKED" },
      );
    try {
      process.kill(pid, 0);
      throw Object.assign(
        new Error("Another CosmicDesk update is running (PID " + pid + ")."),
        { code: "UPDATE_LOCKED" },
      );
    } catch (check) {
      if (check.code !== "ESRCH") throw check;
    }
    await fs.unlink(lock);
    return acquireLock(root);
  }
  return () => fs.rm(lock, { force: true });
}
/** Stage and verify a pinned main revision before changing installed source. No Git binary required. */
export async function updateInstallation({
  root = ROOT,
  getJson = json,
  getBytes = bytes,
  run = runCommand,
  log = console.log,
} = {}) {
  const release = await acquireLock(root);
  const work = path.join(root, WORK),
    stage = path.join(work, "stage"),
    backup = path.join(work, "backup");
  let activationStarted = false;
  try {
    let previous = null;
    try {
      previous = JSON.parse(await fs.readFile(path.join(root, STATE), "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT")
        throw new Error("Invalid updater state: " + e.message);
    }
    const head = await getJson(
      "https://api.github.com/repos/" + REPOSITORY + "/commits/main",
    );
    if (
      !/^[a-f0-9]{40}$/.test(head.sha) ||
      !/^[a-f0-9]{40}$/.test(head.commit?.tree?.sha)
    )
      throw new Error("Invalid GitHub revision");
    if (previous?.commit === head.sha) {
      log("[update] Already running main " + head.sha.slice(0, 7));
      return { updated: false, commit: head.sha };
    }
    const tree = await getJson(
      "https://api.github.com/repos/" +
        REPOSITORY +
        "/git/trees/" +
        head.commit.tree.sha +
        "?recursive=1",
    );
    if (tree.truncated || !Array.isArray(tree.tree) || tree.tree.length > 1000)
      throw new Error("Incomplete or oversized source tree");
    const files = tree.tree.filter(
      (entry) => entry.type === "blob" && safeSourcePath(entry.path),
    );
    if (
      files.some((entry) => entry.mode !== "100644" && entry.mode !== "100755")
    )
      throw new Error("Source tree contains unsupported file types");
    if (
      ![
        "server.js",
        "package.json",
        "package-lock.json",
        "src/app.js",
        "src/migrate.js",
      ].every((required) => files.some((entry) => entry.path === required))
    )
      throw new Error("Source tree is missing required app files");
    await fs.rm(work, { recursive: true, force: true });
    await fs.mkdir(stage, { recursive: true });
    await fs.mkdir(backup, { recursive: true });
    let total = 0;
    log(
      "[update] Downloading main " +
        head.sha.slice(0, 7) +
        " (" +
        files.length +
        " files)",
    );
    for (const entry of files) {
      if (entry.size > MAX_FILE)
        throw new Error("Source file too large: " + entry.path);
      const content = await getBytes(
        "https://raw.githubusercontent.com/" +
          REPOSITORY +
          "/" +
          head.sha +
          "/" +
          entry.path.split("/").map(encodeURIComponent).join("/"),
      );
      total += content.length;
      if (total > MAX_TOTAL) throw new Error("Update exceeds total size limit");
      if (gitBlobSha(content) !== entry.sha)
        throw new Error("Source checksum mismatch: " + entry.path);
      await fs.mkdir(path.dirname(path.join(stage, entry.path)), {
        recursive: true,
      });
      await fs.writeFile(path.join(stage, entry.path), content);
    }
    const pkg = JSON.parse(
      await fs.readFile(path.join(stage, "package.json"), "utf8"),
    );
    if (pkg.name !== "cosmicdesk")
      throw new Error("Unexpected package in update");
    log("[update] Installing production dependencies in staging");
    await run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], stage);
    if (!(await exists(path.join(stage, "node_modules"))))
      throw new Error("Dependency installation did not create node_modules");
    const obsolete = Array.isArray(previous?.files)
      ? previous.files.filter(
          (name) => safeSourcePath(name) && !files.some((f) => f.path === name),
        )
      : [];
    const changed = [...files.map((f) => f.path), ...obsolete];
    const existed = new Set();
    for (const name of changed) {
      await assertRegularDestination(root, name);
      if (await exists(path.join(root, name))) {
        if (!(await fs.lstat(path.join(root, name))).isFile())
          throw new Error("Source path is not a regular file: " + name);
        existed.add(name);
        await fs.mkdir(path.dirname(path.join(backup, name)), {
          recursive: true,
        });
        await fs.copyFile(path.join(root, name), path.join(backup, name));
      }
    }
    const modules = path.join(root, "node_modules"),
      oldModules = path.join(work, "previous-node_modules");
    if ((await exists(modules)) && !(await fs.lstat(modules)).isDirectory())
      throw new Error("node_modules is not a regular directory");
    let movedOld = false,
      movedNew = false;
    activationStarted = true;
    try {
      for (const entry of files)
        await atomicWrite(
          path.join(root, entry.path),
          await fs.readFile(path.join(stage, entry.path)),
        );
      for (const name of obsolete)
        await fs.rm(path.join(root, name), { force: true });
      if (await exists(modules)) {
        await fs.rename(modules, oldModules);
        movedOld = true;
      }
      await fs.rename(path.join(stage, "node_modules"), modules);
      movedNew = true;
      await atomicWrite(
        path.join(root, STATE),
        JSON.stringify(
          {
            commit: head.sha,
            files: files.map((f) => f.path),
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        ) + "\n",
      );
    } catch (error) {
      log("[update] Activation failed; restoring previous files");
      for (const name of changed) {
        if (existed.has(name))
          await atomicWrite(
            path.join(root, name),
            await fs.readFile(path.join(backup, name)),
          );
        else await fs.rm(path.join(root, name), { force: true });
      }
      if (movedNew) await fs.rm(modules, { recursive: true, force: true });
      if (movedOld) await fs.rename(oldModules, modules);
      throw error;
    }
    log(
      "[update] Installed " +
        head.sha.slice(0, 7) +
        "; configuration and data preserved",
    );
    return { updated: true, commit: head.sha };
  } catch (error) {
    error.activationStarted = activationStarted;
    throw error;
  } finally {
    await release();
  }
}
export async function restart({
  root = ROOT,
  env = process.env,
  update = updateInstallation,
  launch = launchServer,
  run = runCommand,
  log = console.log,
} = {}) {
  if (env.COSMICDESK_AUTO_UPDATE !== "0") {
    try {
      await update({ root, run, log });
    } catch (error) {
      if (error.activationStarted || error.code === "UPDATE_LOCKED")
        throw error;
      log("[update] Update unavailable: " + error.message);
      log("[update] Continuing with the installed version");
    }
  } else log("[update] Automatic updates disabled");
  if (!(await exists(path.join(root, "node_modules"))))
    await run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], root);
  log("[startup] Applying database migrations");
  await run(process.execPath, ["src/migrate.js"], root);
  await launch(root, env);
}
export async function launchServer(root, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["server.js", "--serve"], {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    const forward = (signal) => {
      if (!child.killed) child.kill(signal);
    };
    const term = () => forward("SIGTERM"),
      interrupt = () => forward("SIGINT");
    process.on("SIGTERM", term);
    process.on("SIGINT", interrupt);
    const cleanup = () => {
      process.off("SIGTERM", term);
      process.off("SIGINT", interrupt);
    };
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("exit", (code, signal) => {
      cleanup();
      if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") resolve();
      else reject(new Error("CosmicDesk exited with code " + code));
    });
  });
}
async function serve() {
  const [
    { default: config },
    { default: mysql },
    { default: session },
    { default: MySQLStoreFactory },
    { createApp },
  ] = await Promise.all([
    import("./config.js"),
    import("mysql2/promise"),
    import("express-session"),
    import("express-mysql-session"),
    import("./src/app.js"),
  ]);
  if (
    !config.sessionSecret ||
    config.sessionSecret.length < 32 ||
    config.sessionSecret.startsWith("REPLACE")
  )
    throw new Error("Set a unique sessionSecret of at least 32 characters");
  const pool = mysql.createPool({
    ...config.mysql,
    connectionLimit: 10,
    waitForConnections: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  await pool.execute("SELECT help_topic_id FROM tickets LIMIT 0");
  const Store = MySQLStoreFactory(session),
    store = new Store({ ...config.mysql, createDatabaseTable: true });
  const app = createApp({ config, pool, store });
  const server = app.listen(config.port, config.host || "0.0.0.0", () =>
    console.log("CosmicDesk ready on port " + config.port),
  );
  const shutdown = () =>
    server.close(async () => {
      await store.close();
      await pool.end();
      process.exit(0);
    });
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  try {
    if (process.argv.includes("--serve")) await serve();
    else await restart();
  } catch (error) {
    console.error("[startup] " + error.message);
    process.exitCode = 1;
  }
}
