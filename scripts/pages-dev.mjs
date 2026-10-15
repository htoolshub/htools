import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { delimiter, dirname, resolve } from "node:path";
import {
  DEFAULT_PAGES_HOST,
  DEFAULT_PAGES_PORT,
  probeHtoolsPreview
} from "./lib/preview-guard.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function runChild(command, args, options = {}) {
  return new Promise((resolveExit) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        PATH: [dirname(process.execPath), process.env.PATH]
          .filter(Boolean)
          .join(delimiter)
      },
      stdio: "inherit",
      ...options
    });

    child.once("error", (error) => {
      console.error(`[HTools] 无法启动命令：${error.message}`);
      resolveExit(1);
    });
    child.once("exit", (code, signal) => {
      resolveExit(code ?? (signal ? 1 : 0));
    });
  });
}

function runBuild() {
  if (process.env.npm_execpath) {
    return runChild(process.execPath, [process.env.npm_execpath, "run", "build"]);
  }

  const bundledNpm = resolve(
    dirname(process.execPath),
    process.platform === "win32" ? "node_modules/npm/bin/npm-cli.js" : "npm"
  );

  if (existsSync(bundledNpm)) {
    return process.platform === "win32"
      ? runChild(process.execPath, [bundledNpm, "run", "build"])
      : runChild(bundledNpm, ["run", "build"]);
  }

  return runChild("npm", ["run", "build"], {
    shell: process.platform === "win32"
  });
}

function startWrangler(host, port) {
  const wranglerBin = resolve(
    projectRoot,
    "node_modules",
    "wrangler",
    "bin",
    "wrangler.js"
  );

  return runChild(process.execPath, [
    wranglerBin,
    "pages",
    "dev",
    "dist",
    "--d1",
    "DB",
    "--ip",
    host,
    "--port",
    String(port),
    "--compatibility-date=2026-06-30",
    "--binding",
    "AI=local-preview-ai"
  ]);
}

function printOccupiedError(result, error = console.error) {
  if (result.status === "occupied-unresponsive") {
    error(
      `[HTools] ${result.origin} 存在监听但没有响应。请先关闭卡住的本地预览进程，再重新运行 npm run pages:dev。`
    );
    return;
  }

  error(
    `[HTools] ${result.origin} 已被其他 HTTP 服务占用。请释放端口后再重新运行 npm run pages:dev。`
  );
}

export async function runPagesDev({
  host = DEFAULT_PAGES_HOST,
  port = DEFAULT_PAGES_PORT,
  probe = () => probeHtoolsPreview({ host, port }),
  build = runBuild,
  start = () => startWrangler(host, port),
  log = console.log,
  error = console.error
} = {}) {
  const initial = await probe();

  if (
    initial.status === "occupied-http-other" ||
    initial.status === "occupied-unresponsive"
  ) {
    printOccupiedError(initial, error);
    return 1;
  }

  if (initial.status === "healthy-htools") {
    log(`[HTools] 检测到已运行的本地预览，正在构建最新代码…`);
  }

  const buildExitCode = await build();
  if (buildExitCode !== 0) {
    return buildExitCode;
  }

  const afterBuild = await probe();

  if (afterBuild.status === "healthy-htools") {
    log(`[HTools] 本地预览已更新并继续运行：${afterBuild.origin}`);
    return 0;
  }

  if (
    afterBuild.status === "occupied-http-other" ||
    afterBuild.status === "occupied-unresponsive"
  ) {
    printOccupiedError(afterBuild, error);
    return 1;
  }

  log(`[HTools] 正在启动本地预览：http://${host}:${port}`);
  const startExitCode = await start();

  if (startExitCode !== 0) {
    const afterExit = await probe();

    if (afterExit.status === "healthy-htools") {
      log(`[HTools] 已有另一组 HTools 预览完成启动，继续复用：${afterExit.origin}`);
      return 0;
    }

    if (afterExit.status !== "free") {
      printOccupiedError(afterExit, error);
    }
  }

  return startExitCode;
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";

if (entryPath === import.meta.url) {
  process.exitCode = await runPagesDev();
}
