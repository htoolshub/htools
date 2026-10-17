import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createServer } from "node:net";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const projectTmpRoot = resolve(projectRoot, "tmp");
const regressionRoot = resolve(projectTmpRoot, "browser-regression");
const runtimeRoot = resolve(regressionRoot, "runtime");
const artifactRoot = resolve(regressionRoot, "artifacts");
const wranglerPath = resolve(projectRoot, "node_modules/wrangler/bin/wrangler.js");

const HOUR_MS = 60 * 60 * 1000;
const MB = 1024 * 1024;
const DEFAULT_ORIGIN = "http://127.0.0.1:8788";
const STALE_RUNTIME_AGE_MS = 6 * HOUR_MS;
const STALE_LEGACY_PROFILE_AGE_MS = 24 * HOUR_MS;
const KEEP_SUCCESSFUL_RUNS = 1;
const KEEP_FAILED_RUNS = 2;

export const REGRESSION_VIEWPORTS = [
  { name: "desktop-wide", width: 2560, height: 1440, mobile: false },
  { name: "desktop", width: 1920, height: 1080, mobile: false },
  { name: "desktop-compact", width: 1366, height: 768, mobile: false },
  { name: "mobile", width: 419, height: 790, mobile: true }
];

const PUBLIC_ROUTES = [
  { name: "home", path: "/", admin: false },
  { name: "articles", path: "/articles", admin: false },
  { name: "submit", path: "/submit", admin: false }
];

const ADMIN_ROUTES = [
  { name: "admin-tools", path: "/admin/tools", admin: true },
  { name: "admin-articles", path: "/admin/articles", admin: true },
  { name: "admin-content", path: "/admin/content", admin: true },
  { name: "admin-push", path: "/admin/push", admin: true },
  { name: "admin-import-export", path: "/admin/import-export", admin: true },
  { name: "admin-link-check", path: "/admin/check", admin: true },
  { name: "admin-settings-site", path: "/admin/settings/site", admin: true },
  {
    name: "admin-settings-services",
    path: "/admin/settings/services",
    admin: true
  },
  {
    name: "admin-settings-management",
    path: "/admin/settings/management",
    admin: true
  }
];

const ROUTE_SCOPES = {
  smoke: [
    PUBLIC_ROUTES[0],
    PUBLIC_ROUTES[1],
    ADMIN_ROUTES[0],
    ADMIN_ROUTES[3],
    ADMIN_ROUTES[7]
  ],
  full: [...PUBLIC_ROUTES, ...ADMIN_ROUTES]
};

function printHelp() {
  console.log(`HTools 浏览器回归

用法：
  node scripts/browser-regression.mjs run [选项]
  node scripts/browser-regression.mjs flows [选项]
  node scripts/browser-regression.mjs clean [--all]

选项：
  --scope=full|smoke       默认 full
  --origin=http://...      默认 ${DEFAULT_ORIGIN}
  --routes=/,/admin/tools  只检查指定路径
  --no-screenshots         只生成 JSON 报告
  --all                    clean 时同时删除历史截图与报告
  --help                   显示帮助

flows 会使用随机端口、临时 Pages 与独立 D1 执行关键操作，结束后自动清理。

管理员页面优先使用 HTOOLS_BROWSER_TOKEN；未提供时读取 .dev.vars 中的
ADMIN_PASSWORD 登录。Edge 路径可通过 EDGE_PATH 覆盖。`);
}

export function parseCliArgs(argv) {
  const args = [...argv];
  const options = {
    command: "run",
    scope: "full",
    origin: DEFAULT_ORIGIN,
    routes: null,
    screenshots: true,
    cleanAll: false,
    help: false
  };

  if (args[0] === "run" || args[0] === "flows" || args[0] === "clean") {
    options.command = args.shift();
  }

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--no-screenshots") {
      options.screenshots = false;
      continue;
    }
    if (arg === "--all") {
      options.cleanAll = true;
      continue;
    }
    if (arg.startsWith("--scope=")) {
      options.scope = arg.slice("--scope=".length);
      continue;
    }
    if (arg.startsWith("--origin=")) {
      options.origin = arg.slice("--origin=".length).replace(/\/+$/, "");
      continue;
    }
    if (arg.startsWith("--routes=")) {
      options.routes = arg
        .slice("--routes=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      continue;
    }
    throw new Error(`不支持的参数：${arg}`);
  }

  if (!Object.hasOwn(ROUTE_SCOPES, options.scope)) {
    throw new Error(`不支持的回归范围：${options.scope}`);
  }

  let origin;
  try {
    origin = new URL(options.origin);
  } catch {
    throw new Error(`无效的预览地址：${options.origin}`);
  }
  if (!/^https?:$/.test(origin.protocol)) {
    throw new Error("预览地址只支持 HTTP 或 HTTPS。");
  }
  options.origin = origin.origin;

  if (options.routes) {
    options.routes = options.routes.map((route) => {
      const normalized = route.startsWith("/") ? route : `/${route}`;
      return {
        name: sanitizeName(normalized === "/" ? "home" : normalized.slice(1)),
        path: normalized,
        admin: normalized === "/admin" || normalized.startsWith("/admin/")
      };
    });
  } else {
    options.routes = ROUTE_SCOPES[options.scope];
  }

  return options;
}

function sanitizeName(value) {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "page";
}

export function isSafeChildPath(parent, target) {
  const parentPath = resolve(parent);
  const targetPath = resolve(target);
  const child = relative(parentPath, targetPath);
  return Boolean(child) && !child.startsWith("..") && !isAbsolute(child);
}

export async function safeRemove(parent, target) {
  if (!isSafeChildPath(parent, target)) {
    throw new Error(`拒绝删除非子路径：${target}`);
  }
  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 250
  });
}

async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function directorySize(path) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(child);
    } else if (entry.isFile()) {
      total += (await stat(child)).size;
    }
  }
  return total;
}

async function isEdgeProfileDirectory(path) {
  return (
    (await pathExists(join(path, "Local State"))) &&
    ((await pathExists(join(path, "Default"))) ||
      (await pathExists(join(path, "DevToolsActivePort"))))
  );
}

async function cleanupStaleRuntime(now = Date.now()) {
  const entries = await readdir(runtimeRoot, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const target = join(runtimeRoot, entry.name);
    const info = await stat(target);
    if (now - info.mtimeMs < STALE_RUNTIME_AGE_MS) continue;
    try {
      const marker = JSON.parse(await readFile(join(target, "run.json"), "utf8"));
      if (Number.isInteger(marker.pid) && isProcessAlive(marker.pid)) continue;
    } catch {
      // Missing or invalid markers are stale candidates once the age limit is met.
    }
    try {
      await safeRemove(runtimeRoot, target);
      removed += 1;
    } catch (error) {
      console.warn(`[HTools] 无法清理仍被占用的运行目录：${target}\n${error.message}`);
    }
  }
  return removed;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function cleanupLegacyProfiles(now = Date.now()) {
  const entries = await readdir(projectTmpRoot, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (entry.name === basename(regressionRoot) || entry.name === "node-runtime") continue;
    const target = join(projectTmpRoot, entry.name);
    const info = await stat(target);
    if (now - info.mtimeMs < STALE_LEGACY_PROFILE_AGE_MS) continue;
    if (!(await isEdgeProfileDirectory(target))) continue;
    try {
      await safeRemove(projectTmpRoot, target);
      removed += 1;
    } catch (error) {
      console.warn(`[HTools] 旧浏览器目录仍被占用，已跳过：${target}\n${error.message}`);
    }
  }
  return removed;
}

async function readArtifactStatus(path) {
  try {
    const report = JSON.parse(await readFile(join(path, "report.json"), "utf8"));
    return report.status === "passed" ? "passed" : "failed";
  } catch {
    return "failed";
  }
}

async function pruneArtifacts({ removeAll = false, currentRun = "" } = {}) {
  const entries = await readdir(artifactRoot, { withFileTypes: true }).catch(() => []);
  const runs = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const path = join(artifactRoot, entry.name);
    const info = await stat(path);
    runs.push({
      name: entry.name,
      path,
      mtimeMs: info.mtimeMs,
      status: await readArtifactStatus(path),
      bytes: await directorySize(path)
    });
  }

  runs.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const keep = new Set(currentRun ? [currentRun] : []);

  if (!removeAll) {
    for (const status of ["passed", "failed"]) {
      const limit = status === "passed" ? KEEP_SUCCESSFUL_RUNS : KEEP_FAILED_RUNS;
      for (const run of runs.filter((item) => item.status === status).slice(0, limit)) {
        keep.add(run.name);
      }
    }
  }

  for (const run of runs) {
    if (keep.has(run.name)) continue;
    await safeRemove(artifactRoot, run.path);
  }

  const keptRuns = runs.filter((run) => keep.has(run.name));
  const total = keptRuns.reduce((sum, run) => sum + run.bytes, 0);

  return { kept: keep.size, bytes: total };
}

async function getAdminToken(origin, requiresAdmin) {
  if (!requiresAdmin) return "";
  if (process.env.HTOOLS_BROWSER_TOKEN) return process.env.HTOOLS_BROWSER_TOKEN;

  const devVarsPath = resolve(projectRoot, ".dev.vars");
  const devVars = parseEnv(
    await readFile(devVarsPath, "utf8").catch(() => "")
  );
  const password = process.env.ADMIN_PASSWORD || devVars.ADMIN_PASSWORD;
  if (!password) {
    throw new Error(
      "回归范围包含后台页面，但未提供 HTOOLS_BROWSER_TOKEN，.dev.vars 中也没有 ADMIN_PASSWORD。"
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || typeof payload.token !== "string" || !payload.token) {
      throw new Error(
        payload.message ||
          "管理员自动登录失败；若本地开启 Turnstile，请通过 HTOOLS_BROWSER_TOKEN 提供有效会话。"
      );
    }
    return payload.token;
  } finally {
    clearTimeout(timeout);
  }
}

async function findEdgeExecutable() {
  const candidates = [];
  if (process.env.EDGE_PATH) candidates.push(process.env.EDGE_PATH);

  if (process.platform === "win32") {
    const programFilesX86 = process.env["ProgramFiles(x86)"];
    const programFiles = process.env.ProgramFiles;
    const localAppData = process.env.LOCALAPPDATA;
    if (programFilesX86) {
      candidates.push(join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
    if (programFiles) {
      candidates.push(join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
    if (localAppData) {
      candidates.push(join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    );
  } else {
    candidates.push(
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium"
    );
  }

  for (const candidate of candidates) {
    if (candidate && (await pathExists(candidate))) return candidate;
  }
  throw new Error("未找到 Edge；请通过 EDGE_PATH 指定浏览器可执行文件。");
}

function wait(delayMs) {
  return new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
}

async function waitForFile(path, child, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await pathExists(path)) return;
    if (child.exitCode !== null) {
      throw new Error(`Edge 在调试端口就绪前退出，代码 ${child.exitCode}。`);
    }
    await wait(100);
  }
  throw new Error("等待 Edge 调试端口超时。");
}

function appendTail(current, chunk, limit = 120000) {
  const next = current + String(chunk);
  return next.length > limit ? next.slice(-limit) : next;
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();

    socket.addEventListener("message", (event) => this.handleMessage(event.data));
    socket.addEventListener("close", () => {
      for (const { reject, timeout } of this.pending.values()) {
        clearTimeout(timeout);
        reject(new Error("Edge 调试连接已关闭。"));
      }
      this.pending.clear();
    });
  }

  static async connect(url, timeoutMs = 10000) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, rejectOpen) => {
      const timeout = setTimeout(() => rejectOpen(new Error("连接 Edge 调试端口超时。")), timeoutMs);
      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolveOpen();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        rejectOpen(new Error("无法连接 Edge 调试端口。"));
      }, { once: true });
    });
    return new CdpClient(socket);
  }

  handleMessage(raw) {
    const message = JSON.parse(String(raw));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(message.error.message || "CDP 命令失败。"));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    const listeners = this.listeners.get(message.method);
    if (!listeners) return;
    for (const listener of listeners) listener(message.params ?? {});
  }

  send(method, params = {}, timeoutMs = 15000) {
    const id = this.nextId++;
    return new Promise((resolveSend, rejectSend) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectSend(new Error(`${method} 执行超时。`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  waitFor(method, timeoutMs = 15000) {
    return new Promise((resolveEvent, rejectEvent) => {
      const remove = this.on(method, (params) => {
        clearTimeout(timeout);
        remove();
        resolveEvent(params);
      });
      const timeout = setTimeout(() => {
        remove();
        rejectEvent(new Error(`等待 ${method} 超时。`));
      }, timeoutMs);
    });
  }

  close() {
    this.socket.close();
  }
}

// VS Code 会给子进程带上 Windows 兼容层变量 __COMPAT_LAYER；Edge 检测到后会退出并重启自身，
// 脚本会误判为启动失败，重启出的 Edge 无人关闭并锁住临时目录。测试浏览器不需要兼容层，启动前直接去掉。
export function createEdgeEnvironment(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => key.toUpperCase() !== "__COMPAT_LAYER")
  );
}

export async function launchEdge(profilePath) {
  const executable = await findEdgeExecutable();
  await mkdir(profilePath, { recursive: true });
  const args = [
    "--headless=new",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${profilePath}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--metrics-recording-only",
    "--disable-default-apps",
    "--disable-features=msEdgeSidebarV2,EdgeShoppingAssistant,OptimizationGuideModelDownloading,MediaRouter",
    `--disk-cache-size=${16 * MB}`,
    `--media-cache-size=${8 * MB}`,
    "about:blank"
  ];

  const child = spawn(executable, args, {
    cwd: projectRoot,
    env: createEdgeEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let stderrTail = "";
  child.stderr.on("data", (chunk) => {
    stderrTail = appendTail(stderrTail, chunk);
  });

  const activePortPath = join(profilePath, "DevToolsActivePort");
  try {
    await waitForFile(activePortPath, child);
    const [portText] = (await readFile(activePortPath, "utf8")).trim().split(/\r?\n/);
    const port = Number(portText);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error("Edge 返回了无效调试端口。");
    }
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    const version = await response.json();
    const browserClient = await CdpClient.connect(version.webSocketDebuggerUrl);
    return { child, port, browserClient, stderr: () => stderrTail };
  } catch (error) {
    child.kill();
    throw new Error(`${error.message}${stderrTail ? `\n${stderrTail}` : ""}`);
  }
}

export async function openPage(browser) {
  const { targetId } = await browser.browserClient.send("Target.createTarget", {
    url: "about:blank"
  });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    const response = await fetch(`http://127.0.0.1:${browser.port}/json/list`);
    const targets = await response.json();
    const target = targets.find((item) => item.id === targetId);
    if (target?.webSocketDebuggerUrl) {
      return {
        targetId,
        client: await CdpClient.connect(target.webSocketDebuggerUrl)
      };
    }
    await wait(100);
  }
  throw new Error("无法连接 Edge 页面调试目标。");
}

export async function navigate(client, url) {
  const loaded = client.waitFor("Page.loadEventFired", 20000);
  const result = await client.send("Page.navigate", { url }, 20000);
  if (result.errorText) throw new Error(`页面加载失败：${result.errorText}`);
  await loaded;
}

export async function evaluate(client, expression, { awaitPromise = false } = {}) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise
  }, 20000);
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.exception?.value ||
      result.exceptionDetails.text ||
      "页面脚本执行失败。"
    );
  }
  return result.result?.value;
}

async function waitForPageSettled(client, timeoutMs = 12000) {
  return evaluate(
    client,
    `(() => new Promise((resolve) => {
      const startedAt = Date.now();
      const minimumReadyAt = startedAt + 900;
      let stableSince = 0;
      const isVisible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const check = () => {
        const skeletons = Array.from(document.querySelectorAll('[class*="skeleton"], [aria-busy="true"]')).filter(isVisible);
        const ready =
          Date.now() >= minimumReadyAt &&
          document.readyState === "complete" &&
          skeletons.length === 0;
        if (ready) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= 450) {
            resolve({ timedOut: false, skeletons: 0 });
            return;
          }
        } else {
          stableSince = 0;
        }
        if (Date.now() - startedAt >= ${timeoutMs}) {
          resolve({ timedOut: true, skeletons: skeletons.length });
          return;
        }
        setTimeout(check, 100);
      };
      check();
    }))()`,
    { awaitPromise: true }
  );
}

async function inspectPage(client, admin) {
  return evaluate(
    client,
    `(() => {
      const isVisible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const root = document.documentElement;
      const brokenImages = Array.from(document.images)
        .filter((image) => image.complete && image.src && image.naturalWidth === 0 && isVisible(image))
        .map((image) => image.currentSrc || image.src)
        .slice(0, 8);
      const visibleSkeletons = Array.from(document.querySelectorAll('[class*="skeleton"], [aria-busy="true"]')).filter(isVisible).length;
      const adminLogin = Array.from(document.querySelectorAll('.auth-shell .auth-form, .auth-shell .auth-card')).find(isVisible);
      return {
        title: document.title,
        url: location.href,
        bodyTextLength: (document.body?.innerText || "").trim().length,
        horizontalOverflow: root.scrollWidth > window.innerWidth + 2,
        scrollWidth: root.scrollWidth,
        viewportWidth: window.innerWidth,
        visibleSkeletons,
        brokenImages,
        adminLoginVisible: ${admin ? "Boolean(adminLogin)" : "false"}
      };
    })()`
  );
}

async function setViewport(client, viewport) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile
  });
  await client.send("Emulation.setTouchEmulationEnabled", {
    enabled: viewport.mobile,
    maxTouchPoints: viewport.mobile ? 5 : 1
  });
}

async function captureScreenshot(client, path) {
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  }, 30000);
  await writeFile(path, Buffer.from(result.data, "base64"));
}

export async function closeBrowser(browser) {
  if (!browser) return;
  try {
    await browser.browserClient.send("Browser.close", {}, 3000);
  } catch {
    // Browser.close normally closes the websocket before all clients settle.
  }

  if (browser.child.exitCode !== null) return;
  const exited = await Promise.race([
    new Promise((resolveExit) => browser.child.once("exit", () => resolveExit(true))),
    wait(3000).then(() => false)
  ]);
  if (exited) return;

  if (process.platform === "win32" && browser.child.pid) {
    await new Promise((resolveKill) => {
      const taskkill = spawn(
        "taskkill",
        ["/PID", String(browser.child.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true }
      );
      taskkill.once("exit", resolveKill);
      taskkill.once("error", resolveKill);
    });
  } else {
    browser.child.kill("SIGKILL");
  }
}

function createRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function runRegression(options) {
  await mkdir(runtimeRoot, { recursive: true });
  await mkdir(artifactRoot, { recursive: true });

  const staleRuntimeRemoved = await cleanupStaleRuntime();
  const legacyProfilesRemoved = await cleanupLegacyProfiles();
  await pruneArtifacts();
  const tmpBytesBefore = await directorySize(projectTmpRoot);

  const runId = createRunId();
  const runPath = join(runtimeRoot, runId);
  const profilePath = join(runPath, "profile");
  const artifactsPath = join(artifactRoot, runId);
  await mkdir(runPath, { recursive: true });
  await writeFile(
    join(runPath, "run.json"),
    `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`
  );
  await mkdir(artifactsPath, { recursive: true });

  const requiresAdmin = options.routes.some((route) => route.admin);
  let browser;
  let page;
  const results = [];
  let runError = null;
  let interruptedSignal = "";
  const handleSignal = (signal) => {
    interruptedSignal = signal;
    if (browser?.child.exitCode === null) browser.child.kill();
  };
  const handleSigint = () => handleSignal("SIGINT");
  const handleSigterm = () => handleSignal("SIGTERM");
  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);

  console.log(
    `[HTools] 浏览器回归开始：${options.routes.length} 个页面 × ${REGRESSION_VIEWPORTS.length} 个尺寸。`
  );

  try {
    const adminToken = await getAdminToken(options.origin, requiresAdmin);
    if (interruptedSignal) throw new Error(`浏览器回归被 ${interruptedSignal} 中断。`);
    browser = await launchEdge(profilePath);
    page = await openPage(browser);
    const client = page.client;
    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Network.enable")
    ]);

    const runtimeErrors = [];
    const requests = new Map();
    const localRequestFailures = [];
    client.on("Runtime.exceptionThrown", (event) => {
      runtimeErrors.push(event.exceptionDetails?.text || "Uncaught exception");
    });
    client.on("Network.requestWillBeSent", (event) => {
      requests.set(event.requestId, {
        url: event.request?.url || "",
        type: event.type || ""
      });
    });
    client.on("Network.loadingFailed", (event) => {
      const request = requests.get(event.requestId);
      if (!request) return;
      if (!request.url.startsWith(options.origin)) return;
      if (!["Document", "XHR", "Fetch"].includes(request.type)) return;
      localRequestFailures.push(`${request.type} ${request.url}: ${event.errorText}`);
    });
    client.on("Network.responseReceived", (event) => {
      const response = event.response;
      if (!response?.url?.startsWith(options.origin)) return;
      if (!["Document", "XHR", "Fetch"].includes(event.type)) return;
      if (response.status >= 400) {
        localRequestFailures.push(`${event.type} ${response.url}: HTTP ${response.status}`);
      }
    });

    await setViewport(client, REGRESSION_VIEWPORTS[0]);
    await navigate(client, `${options.origin}/`);
    if (adminToken) {
      await evaluate(
        client,
        `localStorage.setItem("htools_token", ${JSON.stringify(adminToken)})`
      );
    }

    for (const viewport of REGRESSION_VIEWPORTS) {
      await setViewport(client, viewport);
      for (const route of options.routes) {
        const startedAt = Date.now();
        runtimeErrors.length = 0;
        localRequestFailures.length = 0;
        requests.clear();

        const url = new URL(route.path, options.origin).href;
        let settled = { timedOut: false, skeletons: 0 };
        let inspection = null;
        const issues = [];

        try {
          await navigate(client, url);
          settled = await waitForPageSettled(client);
          inspection = await inspectPage(client, route.admin);
          if (settled.timedOut || inspection.visibleSkeletons > 0) {
            issues.push(`页面未结束骨架加载（${inspection.visibleSkeletons}）`);
          }
          if (inspection.horizontalOverflow) {
            issues.push(
              `页面横向溢出：${inspection.scrollWidth}px > ${inspection.viewportWidth}px`
            );
          }
          if (inspection.bodyTextLength < 20) issues.push("页面正文内容异常为空");
          if (inspection.adminLoginVisible) issues.push("后台会话未生效，仍显示登录表单");
          if (runtimeErrors.length) issues.push(...runtimeErrors.map((item) => `脚本异常：${item}`));
          if (localRequestFailures.length) issues.push(...localRequestFailures);
        } catch (error) {
          issues.push(error.message);
        }

        const screenshotName = `${viewport.width}x${viewport.height}__${route.name}.png`;
        if (options.screenshots) {
          try {
            await captureScreenshot(client, join(artifactsPath, screenshotName));
          } catch (error) {
            issues.push(`截图失败：${error.message}`);
          }
        }

        results.push({
          viewport,
          route,
          url,
          durationMs: Date.now() - startedAt,
          screenshot: options.screenshots ? screenshotName : null,
          settled,
          inspection,
          issues
        });
        console.log(
          `[${issues.length ? "失败" : "通过"}] ${viewport.width}×${viewport.height} ${route.path}`
        );
      }
    }
  } catch (error) {
    runError = error;
  } finally {
    process.removeListener("SIGINT", handleSigint);
    process.removeListener("SIGTERM", handleSigterm);
    page?.client.close();
    await closeBrowser(browser);
    try {
      await safeRemove(runtimeRoot, runPath);
    } catch (error) {
      runError ??= new Error(`浏览器已关闭，但临时配置清理失败：${error.message}`);
    }
    if (interruptedSignal) {
      runError ??= new Error(`浏览器回归被 ${interruptedSignal} 中断，临时目录已清理。`);
      runError.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
    }
  }

  const failedChecks = results.filter((result) => result.issues.length > 0);
  const status = runError || failedChecks.length ? "failed" : "passed";
  const report = {
    version: 1,
    status,
    runId,
    origin: options.origin,
    scope: options.scope,
    startedWithTmpBytes: tmpBytesBefore,
    cleanup: { staleRuntimeRemoved, legacyProfilesRemoved },
    summary: {
      pages: options.routes.length,
      viewports: REGRESSION_VIEWPORTS.length,
      checks: results.length,
      passed: results.length - failedChecks.length,
      failed: failedChecks.length
    },
    error: runError?.message || null,
    results
  };
  await writeFile(join(artifactsPath, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await pruneArtifacts({ currentRun: runId });
  const tmpBytesAfter = await directorySize(projectTmpRoot);

  console.log(
    `[HTools] 回归${status === "passed" ? "通过" : "失败"}：` +
      `${report.summary.passed}/${report.summary.checks}，` +
      `tmp ${(tmpBytesAfter / MB).toFixed(1)}MB。`
  );
  console.log(`[HTools] 报告：${join(artifactsPath, "report.json")}`);

  if (runError) throw runError;
  if (failedChecks.length) {
    throw new Error(`有 ${failedChecks.length} 项浏览器回归未通过，请查看报告和截图。`);
  }
}

const CRITICAL_FLOW_PASSWORD = "htools-browser-regression";
const CRITICAL_FLOW_TOKEN = "123456789:htools_browser_regression_token";
const CRITICAL_FLOW_TARGET = "-1001234567890";

async function getFreePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
  if (!port) throw new Error("Unable to allocate an isolated browser regression port.");
  return port;
}

async function stopIsolatedPagesDev(child) {
  if (!child || child.exitCode !== null) return;

  if (process.platform === "win32" && child.pid) {
    await new Promise((resolveKill) => {
      const taskkill = spawn(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true }
      );
      taskkill.once("exit", resolveKill);
      taskkill.once("error", resolveKill);
    });
    return;
  }

  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolveExit) => child.once("exit", () => resolveExit(true))),
    wait(5000).then(() => false)
  ]);
  if (!exited && child.exitCode === null) child.kill("SIGKILL");
}

async function startIsolatedPagesDev(persistPath) {
  const port = await getFreePort();
  const inspectorPort = await getFreePort();
  const args = [
    wranglerPath,
    "pages",
    "dev",
    resolve(projectRoot, "dist"),
    "--d1",
    "DB",
    "--persist-to",
    persistPath,
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--inspector-port",
    String(inspectorPort),
    "--compatibility-date",
    "2026-06-30",
    "--binding",
    `ADMIN_PASSWORD=${CRITICAL_FLOW_PASSWORD}`,
    "--binding",
    "AI=browser-regression-ai",
    "--binding",
    `TGTOKEN=${CRITICAL_FLOW_TOKEN}`,
    "--binding",
    "IMGBED_TOKEN=browser-regression-image-token",
    "--binding",
    "TGID=",
    "--binding",
    "TURNSTILE_SITE_KEY=",
    "--binding",
    "TURNSTILE_SECRET_KEY=",
    "--log-level",
    "error"
  ];
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: { ...process.env, CI: "true", NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs = appendTail(logs, chunk);
  });
  child.stderr.on("data", (chunk) => {
    logs = appendTail(logs, chunk);
  });

  const origin = `http://127.0.0.1:${port}`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60000) {
    if (child.exitCode !== null) {
      throw new Error(`Isolated Wrangler Pages exited before startup.\n${logs}`);
    }
    try {
      const response = await fetch(`${origin}/api/tools`);
      if (response.ok) return { child, origin, logs: () => logs };
    } catch {
      // Wrangler is still starting.
    }
    await wait(250);
  }

  await stopIsolatedPagesDev(child);
  throw new Error(`Timed out starting isolated Wrangler Pages.\n${logs}`);
}

async function seedCriticalFlowData(origin) {
  const loginResponse = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: CRITICAL_FLOW_PASSWORD })
  });
  const login = await loginResponse.json().catch(() => ({}));
  if (!loginResponse.ok || typeof login.token !== "string" || !login.token) {
    throw new Error("Unable to authenticate the isolated browser regression fixture.");
  }

  const now = new Date().toISOString();
  const backup = {
    source: "htools-backup",
    version: "4",
    data: {
      tools: [
        {
          id: "critical-recovery-tool",
          name: "Recovery Tool",
          description: "Telegram message recovery fixture",
          url: "https://example.com/recovery-tool",
          demo_url: "",
          image: "",
          category: "Web Framework",
          tags: "[]",
          github_language: "",
          github_license: "",
          featured: 0,
          created_at: now,
          updated_at: now
        },
        {
          id: "critical-target-tool",
          name: "Target Changed Tool",
          description: "Telegram target change recovery fixture",
          url: "https://example.com/target-changed-tool",
          demo_url: "",
          image: "",
          category: "Web Framework",
          tags: "[]",
          github_language: "",
          github_license: "",
          featured: 0,
          created_at: now,
          updated_at: now
        }
      ],
      articles: [],
      contentSources: [
        {
          id: "critical-flow-source",
          title: "Regression Feed",
          url: "https://example.com/regression-feed.xml",
          site_url: "https://example.com",
          description: "Browser regression content source",
          category: "Regression",
          tags: "[]",
          enabled: 0,
          created_at: now,
          updated_at: now,
          last_synced_at: now
        }
      ],
      contentItems: [
        {
          id: "critical-flow-content",
          source_id: "critical-flow-source",
          external_id: "critical-flow-entry",
          title: "Regression Content",
          summary: "Browser regression content summary",
          content: "Browser regression content body",
          url: "https://example.com/regression-content",
          author: "HTools",
          cover_image: "",
          category: "Regression",
          tags: "[]",
          published_at: now,
          synced_at: now,
          created_at: now,
          updated_at: now,
          article_id: null
        }
      ],
      telegramMessages: [
        {
          id: "critical-recovery-message",
          resource_type: "tool",
          resource_id: "critical-recovery-tool",
          custom_title: "Recovery Tool",
          resource_data: JSON.stringify({
            type: "tool",
            id: "critical-recovery-tool",
            title: "Recovery Tool",
            description: "Telegram message recovery fixture",
            url: "https://example.com/recovery-tool",
            demoUrl: "",
            image: "",
            category: "Web Framework",
            tags: ["Web Framework"]
          }),
          category: "__telegram_tool__",
          chat_id: CRITICAL_FLOW_TARGET,
          target_ref: CRITICAL_FLOW_TARGET,
          message_id: "42",
          message_markdown: "**Recovery Tool**\n\n> Telegram message recovery fixture\n\n项目地址：[https://example.com/recovery-tool](https://example.com/recovery-tool)\n\n#Web_Framework",
          media_enabled: 1,
          media_url: "https://example.com/recovery-preview.png",
          last_pushed_hash: "recovery-hash",
          sent_at: now,
          updated_at: now
        },
        {
          id: "critical-target-message",
          resource_type: "tool",
          resource_id: "critical-target-tool",
          custom_title: "Target Changed Tool",
          resource_data: JSON.stringify({
            type: "tool",
            id: "critical-target-tool",
            title: "Target Changed Tool",
            description: "Telegram target change recovery fixture",
            url: "https://example.com/target-changed-tool",
            demoUrl: "",
            image: "",
            category: "Web Framework",
            tags: ["Web Framework"]
          }),
          category: "__telegram_tool__",
          chat_id: "-1009876543210",
          target_ref: "-1009876543210",
          message_id: "84",
          message_markdown: "**Target Changed Tool**\n\n> Telegram target change recovery fixture\n\n项目地址：[https://example.com/target-changed-tool](https://example.com/target-changed-tool)\n\n#Web_Framework",
          media_enabled: 1,
          media_url: "https://example.com/target-preview.png",
          last_pushed_hash: "target-hash",
          sent_at: now,
          updated_at: now
        }
      ],
      settings: [
        {
          key: "telegram_settings",
          value: JSON.stringify({
            enabled: true,
            target: CRITICAL_FLOW_TARGET,
            footerMarkdown: ""
          }),
          updated_at: now
        },
        {
          key: "admin_category_settings",
          value: JSON.stringify({
            tools: ["Web Framework"],
            articles: ["Regression"],
            push: ["Regression"],
            content: ["Regression"]
          }),
          updated_at: now
        },
        {
          key: "ai_settings",
          value: JSON.stringify({
            enabled: false,
            model: "@cf/qwen/qwen3-30b-a3b-fp8"
          }),
          updated_at: now
        }
      ]
    }
  };
  const restoreResponse = await fetch(`${origin}/api/admin/backup`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${login.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(backup)
  });
  if (!restoreResponse.ok) {
    throw new Error(
      `Unable to seed isolated browser regression data: ${await restoreResponse.text()}`
    );
  }
}

async function installCriticalFlowHelpers(client) {
  await evaluate(client, `(() => {
    const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const text = (element) => (element?.textContent || "").replace(/\\s+/g, " ").trim();
    const findToast = (...parts) => Array.from(document.querySelectorAll(".global-toast"))
      .find((element) => visible(element) && parts.every((part) => text(element).includes(part)));
    const waitFor = async (read, label, timeout = 15000) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeout) {
        const value = read();
        if (value) {
          // Dialog scale animations affect every descendant's measured dimensions.
          const dialog = value instanceof Element ? value.closest(".dialog-panel") : null;
          if (dialog) {
            await Promise.all(dialog.getAnimations().map((animation) => animation.finished.catch(() => {})));
          }
          return value;
        }
        await sleep(80);
      }
      throw new Error("Timed out waiting for " + label + ".");
    };
    const setValue = (element, value) => {
      if (!element) throw new Error("Missing form control.");
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (!setter) throw new Error("Unable to update form control.");
      setter.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const click = (element) => {
      if (!element || !visible(element) || element.disabled) {
        throw new Error("Unable to click the requested control.");
      }
      element.scrollIntoView({ block: "center", inline: "center" });
      element.click();
    };
    const card = (title) => Array.from(
      document.querySelectorAll(".admin-tool-card, .content-item-card")
    )
      .find((item) => {
        if (item.classList.contains("admin-resource-card-skeleton")) return false;
        const heading = item.querySelector("h2, h3, .content-item-title-row strong");
        return text(heading) === title;
      });
    const waitForCard = (title) => waitFor(() => card(title), "card " + title);
    const waitForCardRemoval = (title) => waitFor(() => !card(title), "card removal " + title);
    const openCardMenu = async (title) => {
      const item = await waitForCard(title);
      item.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      await sleep(80);
      const trigger = item.querySelector(".admin-tool-menu-trigger");
      if (!visible(trigger) || trigger.disabled) {
        throw new Error("Unable to open the action menu for " + title + ".");
      }
      trigger.click();
      return waitFor(
        () => item.querySelector('.admin-tool-action-menu[role="menu"]'),
        "action menu " + title
      );
    };
    const confirmDialog = async () => {
      const dialog = await waitFor(() => document.querySelector(".dialog-panel"), "confirmation dialog");
      click(dialog.querySelector(".dialog-footer .primary-button"));
      await waitFor(() => !document.querySelector(".dialog-panel"), "confirmation close");
    };
    const closeDialog = async () => {
      const dialog = await waitFor(() => document.querySelector(".dialog-panel"), "dialog");
      const closeButton = dialog.querySelector(".dialog-header .icon-button");
      if (visible(closeButton)) {
        click(closeButton);
      } else {
        document.querySelector(".dialog-backdrop")?.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true })
        );
      }
      await waitFor(() => !document.querySelector(".dialog-panel"), "dialog close");
    };
    const waitForTelegramEditorSaved = (dialog, label) => waitFor(
      () => {
        const [, saveButton, primaryButton] = dialog.querySelectorAll(".dialog-footer > button");
        return saveButton?.disabled && primaryButton && !primaryButton.disabled;
      },
      label,
      20000
    );
    const checkCategoryMenuSpacing = (popover) => {
      const rows = [...popover.querySelectorAll(".admin-category-filter-option")];
      for (let index = 0; index < rows.length; index += 1) {
        const primary = rows[index].querySelector(".admin-category-select-option");
        if (!primary) continue;
        const rect = primary.getBoundingClientRect();
        for (const action of rows[index].querySelectorAll(".admin-category-option-action")) {
          const actionRect = action.getBoundingClientRect();
          if (Math.abs(rect.height - actionRect.height) > 1 || Math.abs(rect.top - actionRect.top) > 1 ||
              getComputedStyle(primary).borderRadius !== getComputedStyle(action).borderRadius) {
            throw new Error("Category selection and action highlights are misaligned.");
          }
        }
        const next = rows[index + 1]?.querySelector(".admin-category-select-option");
        if (next && next.getBoundingClientRect().top - rect.bottom < 3) {
          throw new Error("Adjacent category highlights have no visible gap.");
        }
      }
    };
    const selectCategory = async (form, category) => {
      const trigger = await waitFor(
        () => {
          const button = form.querySelector(".tool-form-category-filter button.admin-category-filter-trigger");
          return button?.isConnected && visible(button) && !button.disabled ? button : null;
        },
        "category selector ready"
      );
      click(trigger);
      const option = await waitFor(
        () => Array.from(form.querySelectorAll(".admin-category-select-option"))
          .find((button) => button.isConnected && visible(button) && text(button) === category),
        "category " + category
      );
      checkCategoryMenuSpacing(option.closest(".admin-category-filter-popover"));
      click(option);
    };
    // 只要求"选中了某个分类"、不指定是哪个。用在新增工具上:内建分类的选项文字会走
    // getCategoryLabel 本地化(中文界面下 "Web Framework" 未必逐字显示成这几个词),
    // 按名字精确匹配会莫名超时。而这个流程要验的是"必填校验满足后能保存成功",
    // 具体哪个分类无关紧要,所以取第一个可选项最稳。
    const selectFirstCategory = async (form) => {
      click(form.querySelector(".tool-form-category-filter .admin-category-filter-trigger"));
      const option = await waitFor(
        () => {
          const button = document.querySelector(".admin-category-select-option");
          return button && visible(button) ? button : null;
        },
        "any category option"
      );
      checkCategoryMenuSpacing(option.closest(".admin-category-filter-popover"));
      click(option);
    };

    window.__htoolsCritical = {
      async login({ password }) {
        const form = await waitFor(() => document.querySelector(".auth-shell .auth-form"), "login form");
        setValue(form.querySelector('input[type="password"]'), password);
        form.requestSubmit();
        await waitFor(() => document.querySelector(".admin-workspace"), "admin workspace", 20000);
        if (!localStorage.getItem("htools_token")) throw new Error("Login did not persist a session token.");
        return true;
      },
      async inspectAdminIdentityCard() {
        const workspace = await waitFor(
          () => document.querySelector(".admin-workspace"),
          "admin workspace"
        );
        const card = await waitFor(
          () => document.querySelector(".admin-user-card"),
          "admin identity card"
        );
        const logout = card.querySelector("button.icon-button");
        const copy = card.querySelector(".admin-user-card-copy");
        const toggle = document.querySelector(".admin-sidebar-toggle");

        if (card.matches("button, a") || card.getAttribute("role") === "button") {
          throw new Error("Admin identity card is still interactive outside the logout icon.");
        }
        if (!visible(logout) || !visible(copy) || !visible(toggle)) {
          throw new Error("Expanded admin identity card is incomplete.");
        }
        if (getComputedStyle(card).borderTopStyle === "none") {
          throw new Error("Expanded admin identity card lost its container border.");
        }
        if (
          getComputedStyle(logout).borderTopColor !== "rgba(0, 0, 0, 0)" &&
          getComputedStyle(logout).borderTopColor !== "transparent"
        ) {
          throw new Error("Expanded logout icon is not using the shared borderless control.");
        }

        card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await sleep(120);
        if (!localStorage.getItem("htools_token") || !document.querySelector(".admin-workspace")) {
          throw new Error("Clicking the admin identity container triggered logout.");
        }

        click(toggle);
        await waitFor(
          () => workspace.classList.contains("is-sidebar-collapsed"),
          "collapsed admin sidebar"
        );
        await sleep(350);
        const copyStyle = getComputedStyle(copy);
        const copyRect = copy.getBoundingClientRect();
        if (
          copyStyle.position !== "absolute" ||
          copyRect.width > 1 ||
          copyRect.height > 1 ||
          copyStyle.overflow !== "hidden"
        ) {
          throw new Error("Collapsed admin identity card still exposes its text.");
        }
        const collapsedCardStyle = getComputedStyle(card);
        if (
          collapsedCardStyle.borderTopStyle !== "none" ||
          collapsedCardStyle.backgroundColor !== "rgba(0, 0, 0, 0)"
        ) {
          throw new Error("Collapsed admin identity container still looks like a button.");
        }
        const logoutRect = logout.getBoundingClientRect();
        const navigationButton = workspace.querySelector(".admin-sidebar-nav button");
        const navigationRect = navigationButton.getBoundingClientRect();
        const bottomButtons = Array.from(workspace.querySelectorAll(".admin-sidebar-bottom .icon-button"));
        if (
          !visible(navigationButton) ||
          bottomButtons.length !== 3 ||
          bottomButtons.some((button) => {
            const rect = button.getBoundingClientRect();
            return !visible(button) ||
              Math.abs(rect.width - navigationRect.width) > 1 ||
              Math.abs(rect.height - navigationRect.height) > 1 ||
              Math.abs(rect.left + rect.width / 2 - navigationRect.left - navigationRect.width / 2) > 1;
          })
        ) {
          throw new Error("收起侧栏的语言、主题和退出按钮必须与导航按钮等大且居中对齐。");
        }
        return {
          x: logoutRect.left + logoutRect.width / 2,
          y: logoutRect.top + logoutRect.height / 2
        };
      },
      async restoreAdminIdentityCard() {
        const workspace = document.querySelector(".admin-workspace");
        const toggle = document.querySelector(".admin-sidebar-toggle");
        if (workspace?.classList.contains("is-sidebar-collapsed")) click(toggle);
        await waitFor(
          () => !workspace.classList.contains("is-sidebar-collapsed"),
          "expanded admin sidebar"
        );
        await sleep(350);
        return true;
      },
      async inspectMobileAdminCard() {
        const trigger = await waitFor(
          () => document.querySelector(".mobile-menu-button"),
          "mobile menu button"
        );
        click(trigger);
        const card = await waitFor(
          () => document.querySelector(".mobile-admin-card"),
          "mobile admin card"
        );
        const login = card.querySelector('a.icon-button[href="/admin"]');
        if (card.matches("button, a") || card.getAttribute("role") === "button") {
          throw new Error("Mobile admin card is still interactive outside the login icon.");
        }
        if (!visible(login) || !visible(card.querySelector(".mobile-admin-card-copy"))) {
          throw new Error("Mobile admin card is incomplete.");
        }
        const before = location.href;
        card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await sleep(120);
        if (location.href !== before) {
          throw new Error("Clicking the mobile admin container navigated to login.");
        }
        return true;
      },
      async createTool({ name, description, url }) {
        const createButton = await waitFor(
          () => document.querySelector(".admin-topbar .admin-create-button:not(:disabled)"),
          "tool create button"
        );
        click(createButton);
        const form = await waitFor(() => document.querySelector("#admin-tool-editor-form"), "tool editor");
        setValue(form.querySelector(".admin-resource-text-field input"), name);
        setValue(form.querySelector(".admin-resource-textarea-field textarea"), description);
        setValue(form.querySelector("#admin-tool-url"), url);
        // 新建工具现在必须选分类:initialForm.category 从 "Web Framework" 改成了 "",
        // handleSaveTool 又补了必填校验。不选分类的话保存会被挡下、表单不关闭,
        // 这里就会卡在下面那个 "tool save" 上超时 —— 不是保存慢,是压根没提交成功。
        await selectFirstCategory(form);
        await sleep(100);
        form.requestSubmit();
        await waitFor(() => !document.querySelector("#admin-tool-editor-form"), "tool save");
        await waitForCard(name);
        return true;
      },
      async editTool({ name, description }) {
        const menu = await openCardMenu(name);
        click(menu.querySelector('button[role="menuitem"]:not(.danger)'));
        const form = await waitFor(() => document.querySelector("#admin-tool-editor-form"), "tool editor");
        setValue(form.querySelector(".admin-resource-textarea-field textarea"), description);
        await sleep(100);
        form.requestSubmit();
        await waitFor(() => !document.querySelector("#admin-tool-editor-form"), "tool update");
        await waitFor(() => text(card(name)?.querySelector(".admin-tool-description")) === description, "updated tool description");
        return true;
      },
      async inspectCustomPushFieldAssistants({ mediaUrl, projectUrl }) {
        const createButton = await waitFor(
          () => document.querySelector(".admin-topbar .admin-create-button:not(:disabled)"),
          "push create button"
        );
        click(createButton);
        const dialog = await waitFor(
          () => document.querySelector("#telegram-custom-title")?.closest(".dialog-panel"),
          "custom push editor"
        );
        const projectInput = Array.from(dialog.querySelectorAll(".admin-resource-url-field input"))
          .find((input) => input.id !== "telegram-media-url");
        setValue(projectInput, projectUrl);
        const githubButton = await waitFor(
          () => dialog.querySelector(".tool-github-metadata-button"),
          "custom push GitHub assistant"
        );
        const aiButton = await waitFor(
          () => dialog.querySelector(".admin-ai-action-button"),
          "custom push AI assistant"
        );
        if (dialog.querySelector(".tool-github-detail-field")) {
          throw new Error("Custom push editor unexpectedly shows the GitHub detail card.");
        }
        const mediaInputs = dialog.querySelectorAll("#telegram-media-url");
        const mediaInput = mediaInputs[0];
        const mediaField = mediaInput?.closest(".telegram-media-url-field");
        const mediaToggle = mediaField?.querySelector(".settings-status-switch");
        const mediaUpload = mediaField?.querySelector(".field-assist-button");
        const mediaLabel = text(mediaField?.querySelector(".tool-form-field-head label"));
        if (
          mediaInputs.length !== 1 ||
          mediaLabel !== "预览图" ||
          !mediaToggle ||
          !mediaUpload ||
          !githubButton.classList.contains("field-assist-button") ||
          !aiButton.classList.contains("field-assist-button")
        ) {
          throw new Error("Custom push field assistants are not in the expected layout.");
        }
        if (aiButton.disabled || aiButton.getAttribute("aria-disabled") !== "true") {
          throw new Error("Disabled AI service made its field assistant unclickable.");
        }
        if (dialog.querySelector(".telegram-editor-top-actions")) {
          throw new Error("Custom push editor unexpectedly shows the source sync action.");
        }
        const originalFetch = window.fetch;
        let aiRequestCount = 0;
        window.fetch = async (...args) => {
          const input = args[0];
          const url = typeof input === "string" ? input : input?.url || "";
          if (url.includes("/api/admin/ai/")) aiRequestCount += 1;
          return originalFetch.apply(window, args);
        };
        try {
          click(aiButton);
          await waitFor(
            () => findToast("Workers AI", "开启"),
            "disabled AI assistant notice"
          );
          if (aiRequestCount !== 0) {
            throw new Error("Disabled AI assistant still sent a request.");
          }
        } finally {
          window.fetch = originalFetch;
        }
        const githubHeight = githubButton.getBoundingClientRect().height;
        const mediaToggleHeight = mediaToggle.getBoundingClientRect().height;
        const mediaUploadHeight = mediaUpload.getBoundingClientRect().height;
        const projectInputHeight = projectInput.getBoundingClientRect().height;
        const titleInputHeight = dialog.querySelector("#telegram-custom-title")?.getBoundingClientRect().height || 0;
        const descriptionHeight = dialog.querySelector(".admin-resource-textarea-field textarea")?.getBoundingClientRect().height || 0;
        if (
          Math.abs(githubHeight - 42) > 1 ||
          Math.abs(mediaToggleHeight - 42) > 1 ||
          Math.abs(mediaUploadHeight - 42) > 1 ||
          Math.abs(projectInputHeight - 42) > 1 ||
          Math.abs(titleInputHeight - 42) > 1 ||
          descriptionHeight <= 42
        ) {
          throw new Error("Custom push field assistant heights are inconsistent.");
        }
        setValue(mediaInput, mediaUrl);
        click(mediaToggle);
        await waitFor(
          () => dialog.querySelector(".telegram-channel-photo-message"),
          "custom push image preview"
        );
        const previewImage = dialog.querySelector(".telegram-channel-photo-message img");
        if (previewImage && !previewImage.src.includes(mediaUrl)) {
          throw new Error("Custom push preview did not use the current preview image URL.");
        }
        await closeDialog();
        return true;
      },
      async inspectQuickLoading({ expectedPushed = false, title, theme }) {
        const item = await waitForCard(title);
        const pushButton = await waitFor(
          () => {
            const button = item.querySelector(".admin-telegram-button:not(:disabled)");
            return visible(button) ? button : null;
          },
          "Telegram action " + title
        );
        const root = document.documentElement;
        const previousTheme = root.dataset.theme;
        const previousColorScheme = root.style.colorScheme;
        const originalFetch = window.fetch;
        let delayedStateRequest = false;
        root.dataset.theme = theme;
        root.style.colorScheme = theme;
        window.fetch = async (...args) => {
          const response = await originalFetch.apply(window, args);
          const input = args[0];
          const init = args[1] || {};
          const url = typeof input === "string" ? input : input?.url || "";
          const method = String(init.method || input?.method || "GET").toUpperCase();
          if (
            !delayedStateRequest &&
            method === "GET" &&
            url.includes("/api/admin/telegram-messages/") &&
            !url.includes("/source")
          ) {
            delayedStateRequest = true;
            await sleep(800);
          }
          return response;
        };
        click(pushButton);
        try {
          await sleep(500);
          if (document.querySelector(".dialog-panel")) {
            throw new Error("Quick push dialog opened before its state was loaded.");
          }
          const dialog = await waitFor(
            () => document.querySelector(".dialog-panel .telegram-message-preview")?.closest(".dialog-panel"),
            "quick loaded preview"
          );
          const preview = dialog.querySelector(".telegram-message-preview");
          await waitFor(
            () => !preview.querySelector(".admin-detail-placeholder, .article-body-skeleton") && text(preview).includes(title),
            "loaded quick preview content"
          );
          const publishMode = dialog.querySelector(".article-publish-mode-field");
          if (expectedPushed ? publishMode || !text(dialog).includes("已经推送过了") : !publishMode) {
            throw new Error("Quick push state did not resolve to the expected actions.");
          }
          const previewRect = preview.getBoundingClientRect();
          await sleep(100);
          const loadedRect = preview.getBoundingClientRect();
          if (
            Math.abs(previewRect.width - loadedRect.width) > 1 ||
            Math.abs(previewRect.height - loadedRect.height) > 1
          ) {
            throw new Error("Quick preview shifts after loading in " + theme + " mode.");
          }
          await closeDialog();
          return true;
        } finally {
          window.fetch = originalFetch;
          root.dataset.theme = previousTheme;
          root.style.colorScheme = previousColorScheme;
         }
       },
      async inspectContentConvertPreview({ expectedHeight, title }) {
        const item = await waitForCard(title);
        click(item.querySelector(".content-item-select") ?? item);
        const convertButton = await waitFor(
          () => [
            ...item.querySelectorAll(".admin-article-publish-button"),
            ...document.querySelectorAll(
              ".content-reader-toolbar .admin-article-publish-button, .content-browse-dialog .admin-article-publish-button"
            )
          ].find((button) => visible(button) && !button.disabled),
          "content convert action " + title
        );
        click(convertButton);
        const dialog = await waitFor(
          () => document.querySelector(".content-convert-preview")?.closest(".dialog-panel"),
          "content conversion preview"
        );
        if (
          dialog.querySelector(".admin-resource-textarea-field") ||
          dialog.querySelector(".admin-resource-tags-field")
        ) {
          throw new Error("Content conversion still exposes summary or tag editors.");
        }
        const preview = await waitFor(
          () => dialog.querySelector(".content-convert-preview .markdown-content:not(.article-body-skeleton)"),
          "converted article content"
        );
        if (!text(preview).includes("Browser regression content body")) {
          throw new Error("Content conversion preview did not load the article body.");
        }
        const previewPanel = preview.closest(".content-convert-preview");
        const previewHeight = previewPanel.getBoundingClientRect().height;
        if (Math.abs(previewHeight - expectedHeight) > 1) {
          throw new Error("Content/article preview height mismatch: " + previewHeight + "px / " + expectedHeight + "px.");
        }
        const form = dialog.querySelector(".article-form");
        const previewField = dialog.querySelector(".content-convert-preview-field");
        if (previewField?.nextElementSibling || previewField?.parentElement !== form) {
          throw new Error("Content conversion preview is not the final form field.");
        }
        await closeDialog();
        return true;
      },
      async inspectCategoryGroupToggle() {
        const group = await waitFor(
          () => document.querySelector(".content-source-group-wrap"),
          "content category group"
        );
        const toggle = group.querySelector(".content-source-group-toggle");
        const main = group.querySelector(".content-source-group-main");
        if (!visible(toggle) || !visible(main)) {
          throw new Error("Category group is missing its toggle or filter button.");
        }
        const expandedBefore = toggle.getAttribute("aria-expanded");
        click(toggle);
        await waitFor(
          () => toggle.getAttribute("aria-expanded") !== expandedBefore,
          "category toggle via chevron"
        );
        const expandedAfterChevron = toggle.getAttribute("aria-expanded");

        main.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
        await waitFor(
          () => toggle.getAttribute("aria-expanded") !== expandedAfterChevron,
          "category toggle via double click"
        );

        const activeBefore = group
          .querySelector(".content-source-group")
          .classList.contains("is-active");
        click(main);
        await waitFor(
          () =>
            group
              .querySelector(".content-source-group")
              .classList.contains("is-active") !== activeBefore,
          "category filter via single click"
        );
        const filterTrigger = document.querySelector(
          ".admin-filter-row .admin-category-filter-trigger .admin-category-filter-value"
        );
        return {
          filterLabel: text(filterTrigger),
          toolbarLabel: text(
            document.querySelector(".content-source-toolbar-title strong")
          )
        };
      },
      async inspectFilterCategoryPopover() {
        const trigger = await waitFor(
          () => {
            const button = document.querySelector(
              ".admin-filter-row .admin-category-filter-trigger"
            );
            return button && visible(button) && !button.disabled ? button : null;
          },
          "filter category trigger"
        );
        click(trigger);
        const popover = await waitFor(
          () => document.querySelector(
            ".admin-filter-row .admin-category-filter-popover"
          ),
          "filter category popover"
        );
        await sleep(220);
        checkCategoryMenuSpacing(popover);
        const rect = popover.getBoundingClientRect();
        const probes = [
          [rect.left + rect.width / 2, rect.top + 6],
          [rect.left + rect.width / 2, rect.top + rect.height / 2],
          [rect.left + rect.width / 2, rect.bottom - 6]
        ];
        const covering = probes
          .map(([x, y]) => document.elementFromPoint(x, y))
          .filter((element) => element && !popover.contains(element))
          .map((element) => element.className || element.tagName);
        if (covering.length) {
          throw new Error(
            "Filter category popover is covered by: " + covering.join(" | ")
          );
        }
        const closeButton = popover
          .closest(".admin-category-filter")
          ?.querySelector(".admin-category-filter-arrow");
        if (visible(closeButton)) click(closeButton);
        await waitFor(
          () => !document.querySelector(
            ".admin-filter-row .admin-category-filter-popover"
          ),
          "filter category popover close"
        );
        return true;
      },
      async migrateContentCategory({ category, targetCategory }) {
        const token = localStorage.getItem("htools_token");
        const response = await fetch("/api/admin/categories", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action: "migrate",
            category,
            scope: "content",
            targetCategory
          })
        });
        if (!response.ok) {
          throw new Error("Unable to migrate the content category fixture: " + await response.text());
        }
        return true;
      },
      async inspectQuickLoadFailure({ title }) {
        const item = await waitForCard(title);
        const pushButton = await waitFor(
          () => {
            const button = item.querySelector(".admin-telegram-button:not(:disabled)");
            return visible(button) ? button : null;
          },
          "Telegram action " + title
        );
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
          const input = args[0];
          const init = args[1] || {};
          const url = typeof input === "string" ? input : input?.url || "";
          const method = String(init.method || input?.method || "GET").toUpperCase();
          if (
            method === "GET" &&
            url.includes("/api/admin/telegram-messages/") &&
            !url.includes("/source")
          ) {
            await sleep(150);
            return new Response(
              JSON.stringify({ error: "Request timed out.", code: "REQUEST_TIMEOUT" }),
              {
                status: 504,
                headers: { "Content-Type": "application/json" }
              }
            );
          }
          return originalFetch.apply(window, args);
        };
        click(pushButton);
        try {
          await sleep(400);
          if (document.querySelector(".dialog-panel")) {
            throw new Error("Quick timeout opened a dialog before the request completed.");
          }
          const status = await waitFor(
            () => findToast("请求超时"),
            "quick timeout status"
          );
          if (!visible(status)) throw new Error("Quick timeout status is not visible.");
          return true;
        } finally {
          window.fetch = originalFetch;
        }
      },
      async inspectQuickPermissionFailure({ title }) {
        const item = await waitForCard(title);
        const pushButton = await waitFor(
          () => {
            const button = item.querySelector(".admin-telegram-button:not(:disabled)");
            return visible(button) ? button : null;
          },
          "Telegram action " + title
        );
        click(pushButton);
        const dialog = await waitFor(
          () => document.querySelector(".dialog-panel .telegram-message-preview")?.closest(".dialog-panel"),
          "quick permission preview"
        );
        await waitFor(
          () => !dialog.querySelector(".admin-detail-placeholder") && text(dialog).includes(title),
          "quick permission preview content"
        );
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
          const input = args[0];
          const init = args[1] || {};
          const url = typeof input === "string" ? input : input?.url || "";
          const method = String(init.method || input?.method || "GET").toUpperCase();
          if (method === "POST" && url.includes("/api/admin/telegram-messages/")) {
            return new Response(
              JSON.stringify({
                error: "Forbidden: bot cannot send messages to the chat.",
                code: "TELEGRAM_PERMISSION_DENIED"
              }),
              {
                status: 403,
                headers: { "Content-Type": "application/json" }
              }
            );
          }
          return originalFetch.apply(window, args);
        };
        try {
          const sendButton = await waitFor(
            () => {
              const button = dialog.querySelector(".dialog-footer .primary-button:not(:disabled)");
              return visible(button) ? button : null;
            },
            "quick permission send button"
          );
          click(sendButton);
          const status = await waitFor(
            () => findToast("机器人没有向目标群组或频道发送消息的权限"),
            "quick permission status"
          );
          if (
            !visible(status) ||
            !document.querySelector(".dialog-panel") ||
            dialog.querySelector(".admin-detail-placeholder") ||
            !text(dialog.querySelector(".telegram-channel-preview-message")).includes(title)
          ) {
            throw new Error("Quick permission error did not preserve the editable preview.");
          }
          await waitFor(
            () => !dialog.querySelector(".dialog-footer .primary-button:disabled"),
            "quick permission retry ready"
          );
          await closeDialog();
          return true;
        } finally {
          window.fetch = originalFetch;
        }
      },
      async inspectQuickUncertainRetry({ title, resourceId }) {
        const item = await waitForCard(title);
        let resultMessage = {};
        if (resourceId) {
          const menu = await openCardMenu(title);
          click(menu.querySelector('button[role="menuitem"]:not(.danger)'));
          const body = await waitFor(() => document.querySelector("#telegram-rich-markdown-body:not(:disabled)"), "Telegram update editor");
          setValue(body, body.value + "\\n\\nUncertain update check");
          click(body.closest(".dialog-panel").querySelectorAll(".admin-markdown-editor-mode button")[1]);
          const response = await fetch("/api/admin/telegram-messages/tool/" + resourceId, {
            headers: { Authorization: "Bearer " + localStorage.getItem("htools_token") }
          });
          if (!response.ok) throw new Error("Unable to read the isolated Telegram update fixture.");
          resultMessage = (await response.json()).message;
        } else {
          const pushButton = await waitFor(
            () => item.querySelector(".admin-telegram-button:not(:disabled)"),
            "Telegram uncertain retry action " + title
          );
          click(pushButton);
        }
        const dialog = await waitFor(
          () => document.querySelector(".dialog-panel .telegram-message-preview")?.closest(".dialog-panel"),
          "Telegram uncertain retry preview"
        );
        await waitFor(
          () => !dialog.querySelector(".admin-detail-placeholder") && text(dialog).includes(title),
          "Telegram uncertain retry preview content"
        );
        const originalFetch = window.fetch;
        const requestBodies = [];
        const draftBodies = [];
        window.fetch = async (...args) => {
          const input = args[0];
          const init = args[1] || {};
          const url = typeof input === "string" ? input : input?.url || "";
          const method = String(init.method || input?.method || "GET").toUpperCase();
          if (!resourceId && url.includes("/api/admin/telegram-messages/")) {
            if (method === "PATCH") {
              const body = JSON.parse(String(init.body || "{}"));
              draftBodies.push(body);
              resultMessage = {
                ...body,
                exists: false,
                targetChanged: false,
                resourceExists: true,
                syncStatus: "not_pushed",
                defaultBodyMarkdown: body.bodyMarkdown,
                defaultMediaUrl: "",
                deliveryUncertain: true
              };
              await sleep(650);
              return new Response(JSON.stringify({ message: resultMessage }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }
            if (method === "GET" && resultMessage.deliveryUncertain) {
              return new Response(JSON.stringify({ message: resultMessage }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }
          }
          if (method === (resourceId ? "PUT" : "POST") && url.includes("/api/admin/telegram-messages/")) {
            requestBodies.push(JSON.parse(String(init.body || "{}")));
            if (requestBodies.length <= 2) {
              if (requestBodies.length === 2) await sleep(650);
              return new Response(
                JSON.stringify({
                  error: "Telegram push result is uncertain.",
                  code: "TELEGRAM_PUSH_UNCERTAIN"
                }),
                {
                  status: 409,
                  headers: { "Content-Type": "application/json" }
                }
              );
            }
            return new Response(JSON.stringify({ message: { ...resultMessage, deliveryUncertain: false } }), {
              status: 201,
              headers: { "Content-Type": "application/json" }
            });
          }
          return originalFetch.apply(window, args);
        };
        try {
          click(dialog.querySelector(".dialog-footer .primary-button:not(:disabled)"));
          let retryDialog = await waitFor(
            () => document.querySelector(".admin-confirm-dialog"),
            "Telegram uncertain retry confirmation"
          );
          if (
            !text(retryDialog).includes("确认重新推送") ||
            !text(retryDialog).includes("可能产生重复消息") ||
            requestBodies[0]?.confirmUncertainRetry !== false
          ) {
            throw new Error("Telegram uncertain retry confirmation is incomplete.");
          }
          const retryButton = retryDialog.querySelector(".dialog-footer .primary-button");
          click(retryButton);
          retryButton.click();
          await waitFor(
            () => requestBodies.length === 2 && retryDialog.querySelector(".dialog-footer .primary-button:disabled"),
            "Telegram confirmed retry is busy"
          );
          retryDialog.querySelector(".dialog-footer .ghost-button").click();
          retryDialog.querySelector(".dialog-header button").click();
          retryDialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          await sleep(80);
          if (
            !retryDialog.isConnected ||
            document.querySelectorAll(".admin-confirm-dialog").length !== 1 ||
            !text(retryDialog).includes("正在重新推送，请稍候。") ||
            requestBodies.length !== 2
          ) {
            throw new Error("重试等待时弹窗关闭、丢失忙碌说明或发生重复请求。");
          }
          await waitFor(
            () => !retryDialog.querySelector(".dialog-footer .primary-button:disabled") && text(retryDialog).includes("本次重试仍无法确认是否送达"),
            "Telegram repeated uncertain result"
          );
          if (
            !retryDialog.isConnected ||
            document.querySelectorAll(".admin-confirm-dialog").length !== 1 ||
            !text(retryDialog).includes("暂不重试")
          ) {
            throw new Error("连续不确定结果没有保留同一个确认弹窗。");
          }
          if (!resourceId) {
            click(retryDialog.querySelector(".dialog-footer .ghost-button"));
            await waitFor(() => !document.querySelector(".admin-confirm-dialog"), "取消未知结果重试");
            const modes = dialog.querySelectorAll(".article-publish-mode-field button");
            click(modes[modes.length - 1]);
            const saveButton = await waitFor(
              () => modes[modes.length - 1].getAttribute("aria-pressed") === "true"
                && dialog.querySelector(".dialog-footer .primary-button:not(:disabled)"),
              "未知送达后切换草稿保存"
            );
            click(saveButton);
            saveButton.click();
            await waitFor(() => !document.querySelector(".dialog-panel"), "未知送达草稿保存完成");
            if (
              draftBodies.length !== 1 ||
              draftBodies[0].bodyMarkdown !== requestBodies[0].bodyMarkdown ||
              draftBodies[0].confirmUncertainRetry !== undefined ||
              requestBodies.length !== 2 ||
              !findToast("草稿已保存，上次推送是否送达仍待确认。")
            ) {
              throw new Error("未知送达草稿保存发生重复请求、内容丢失或提示错误。");
            }
            click(item.querySelector(".admin-telegram-button:not(:disabled)"));
            const reopened = await waitFor(
              () => document.querySelector('[aria-describedby="telegram-quick-push-description"] .dialog-footer .primary-button:not(:disabled)')?.closest(".dialog-panel"),
              "重开未知送达草稿"
            );
            if (!text(reopened.querySelector(".dialog-description")).includes("上次推送是否送达仍待确认")) {
              throw new Error("重开草稿后丢失未知送达说明。");
            }
            click(reopened.querySelector(".dialog-footer .primary-button"));
            retryDialog = await waitFor(() => document.querySelector(".admin-confirm-dialog"), "已知未知结果先确认");
            if (requestBodies.length !== 2) {
              throw new Error("重开已知未知草稿后，人工确认前发送了额外请求。");
            }
          }
          click(retryDialog.querySelector(".dialog-footer .primary-button"));
          await waitFor(() => !document.querySelector(".dialog-panel"), "Telegram confirmed retry");
          if (
            requestBodies.length !== 3 ||
            requestBodies[1]?.confirmUncertainRetry !== true ||
            requestBodies[2]?.confirmUncertainRetry !== true
          ) {
            throw new Error("Telegram confirmed retry did not send the takeover flag.");
          }
          return true;
        } finally {
          window.fetch = originalFetch;
        }
      },
      async saveQuickDraft({ title, defaultCategoryLabel }) {
        const item = await waitForCard(title);
        if (item.classList.contains("content-item-card")) {
          click(item.querySelector(".content-item-select") ?? item);
        }
        const pushButton = await waitFor(
          () => [
            ...item.querySelectorAll(".admin-telegram-button:not(:disabled)"),
            ...document.querySelectorAll(
              ".content-reader-toolbar .admin-telegram-button:not(:disabled), .content-browse-dialog .admin-telegram-button:not(:disabled)"
            )
          ].find((button) => visible(button)),
          "Telegram action " + title
        );
        const originalFetch = window.fetch;
        let delayedStateRequest = false;
        window.fetch = async (...args) => {
          const response = await originalFetch.apply(window, args);
          const input = args[0];
          const init = args[1] || {};
          const url = typeof input === "string" ? input : input?.url || "";
          const method = String(init.method || input?.method || "GET").toUpperCase();
          if (
            !delayedStateRequest &&
            method === "GET" &&
            url.includes("/api/admin/telegram-messages/") &&
            !url.includes("/source")
          ) {
            delayedStateRequest = true;
            await sleep(800);
          }
          return response;
        };
        click(pushButton);
        let dialog;
        try {
          await sleep(500);
          if (document.querySelector(".dialog-panel")) {
            throw new Error("Quick push dialog opened before its state was loaded.");
          }
        } finally {
          window.fetch = originalFetch;
        }
        dialog = await waitFor(
          () => document.querySelector(".dialog-panel .article-publish-mode-field")?.closest(".dialog-panel"),
          "quick push layout"
        );
        await waitFor(
          () => dialog.querySelector(".telegram-message-preview") && !dialog.querySelector(".admin-detail-placeholder"),
          "quick push preview"
        );
        await waitFor(
          () => text(dialog.querySelector(".telegram-channel-preview-message")).includes(title),
          "quick push preview content"
        );
        const previewMessage = dialog.querySelector(".telegram-channel-preview-message");
        const previewContent = previewMessage.querySelector(".markdown-content");
        const previewRect = previewMessage.getBoundingClientRect();
        const previewStyle = getComputedStyle(previewContent);
        if (
          previewRect.width < 100 ||
          previewRect.height < 40 ||
          previewStyle.display === "none" ||
          previewStyle.visibility === "hidden" ||
          Number(previewStyle.opacity) === 0
        ) {
          throw new Error("Quick push preview content is present but not visible.");
        }
        const categoryWrites = [];
        const draftRequests = [];
        window.fetch = (...args) => {
          const input = args[0];
          const init = args[1] || {};
          const url = typeof input === "string" ? input : input?.url || "";
          const method = String(init.method || input?.method || "GET").toUpperCase();
          if (method !== "GET" && url.includes("/api/admin/categories")) categoryWrites.push(url);
          if (method === "PATCH" && url.includes("/api/admin/telegram-messages/")) {
            draftRequests.push({ url, body: JSON.parse(String(init.body || "{}")) });
          }
          return originalFetch.apply(window, args);
        };
        try {
          if (text(dialog.querySelector(".admin-category-filter-value")) !== defaultCategoryLabel) {
            throw new Error("首次快捷推送没有显示对应来源的默认分类。");
          }
          click(dialog.querySelector(".tool-form-category-filter .admin-category-filter-trigger"));
          const defaultOption = await waitFor(
            () => [...dialog.querySelectorAll(".admin-category-select-option")].find((button) => text(button) === defaultCategoryLabel),
            "默认推送分类选项"
          );
          if (defaultOption.getAttribute("aria-selected") !== "true" || defaultOption.closest(".admin-category-filter-option").querySelector(".admin-category-option-action")) {
            throw new Error("默认推送分类未选中或错误提供了删除、排序操作。");
          }
          click(defaultOption);
          for (const [index, category] of ["Regression", "Regression", ""].entries()) {
            if (index !== 1) await selectCategory(dialog, category || defaultCategoryLabel);
            const modes = dialog.querySelectorAll(".article-publish-mode-field button");
            const draftButton = await waitFor(
              () => modes[modes.length - 1] && !modes[modes.length - 1].disabled && modes[modes.length - 1],
              "ready quick push draft mode"
            );
            click(draftButton);
            await waitFor(() => modes[modes.length - 1]?.getAttribute("aria-pressed") === "true", "draft mode");
            click(dialog.querySelector(".dialog-footer .primary-button"));
            await waitFor(() => !document.querySelector(".dialog-panel"), "draft save", 20000);
            if (draftRequests.length !== index + 1 || draftRequests[index].body.category !== category || draftRequests[index].body.resource?.category !== category) {
              throw new Error("快捷推送保存时丢失自定义分类或把默认分类写成了实际名称。");
            }
            if (index < 2) {
              click(pushButton);
              dialog = await waitFor(
                () => document.querySelector('[aria-describedby="telegram-quick-push-description"] .dialog-footer .primary-button:not(:disabled)')?.closest(".dialog-panel"),
                "重开已保存自定义分类草稿"
              );
              if (text(dialog.querySelector(".admin-category-filter-value")) !== "Regression") {
                throw new Error("快捷推送重开后没有回填草稿的真实分类。");
              }
            }
          }
          const response = await fetch(draftRequests[2].url, {
            headers: { Authorization: "Bearer " + localStorage.getItem("htools_token") }
          });
          const saved = await response.json();
          if (!response.ok || saved.message?.resource?.category !== "" || categoryWrites.length) {
            throw new Error("切回默认分类后存储值不为空或错误修改了分类设置。");
          }
        } finally {
          window.fetch = originalFetch;
        }
        return true;
      },
      async createArticle({ title, summary, slug, content, category }) {
        const createButton = await waitFor(
          () => document.querySelector(".admin-topbar .admin-create-button:not(:disabled)"),
          "article create button"
        );
        click(createButton);
        const form = await waitFor(() => document.querySelector("#admin-article-editor-form"), "article editor");
        setValue(form.querySelector(".admin-resource-text-field input"), title);
        setValue(form.querySelector(".admin-resource-textarea-field textarea"), summary);
        setValue(form.querySelector("#admin-article-slug"), slug);
        setValue(form.querySelector("#admin-article-content"), content);
        await selectCategory(form, category);
        const modes = form.closest(".dialog-panel").querySelectorAll(".article-publish-mode-field button");
        click(modes[modes.length - 1]);
        await waitFor(
          () => modes[modes.length - 1]?.getAttribute("aria-pressed") === "true",
          "article draft mode"
        );
        await sleep(100);
        form.requestSubmit();
        await waitFor(() => !document.querySelector("#admin-article-editor-form"), "article save", 20000);
        const item = await waitForCard(title);
        if (item.querySelector(".admin-article-publish-button")?.getAttribute("aria-pressed") !== "false") {
          throw new Error("Article was not saved as a draft.");
        }
        return true;
      },
      async inspectArticleEditorPreviewHeight({ title }) {
        const menu = await openCardMenu(title);
        click(menu.querySelector('button[role="menuitem"]:not(.danger)'));
        const dialog = await waitFor(
          () => document.querySelector("#admin-article-content")?.closest(".dialog-panel"),
          "article editor height"
        );
        const importButton = dialog.querySelector(".admin-markdown-mode-row .admin-ai-action-button");
        const modeButtons = dialog.querySelectorAll(".admin-markdown-editor-mode button");
        const summary = dialog.querySelector(".admin-resource-textarea-field textarea");
        if (
          !importButton ||
          Math.abs(importButton.getBoundingClientRect().height - 42) > 1 ||
          modeButtons.length !== 2 ||
          Math.abs(modeButtons[0].getBoundingClientRect().height - 34) > 1 ||
          Math.abs(modeButtons[0].closest(".admin-markdown-editor-mode").getBoundingClientRect().height - 42) > 1 ||
          Math.abs((summary?.getBoundingClientRect().height || 0) - 42) <= 1
        ) {
          throw new Error("Article auxiliary controls or summary height is inconsistent.");
        }
        const editPanel = await waitFor(
          () => dialog.querySelector(".article-markdown-editor .admin-markdown-editor-edit"),
          "article edit panel"
        );
        const editHeight = editPanel.getBoundingClientRect().height;
        click(dialog.querySelectorAll(".admin-markdown-editor-mode button")[1]);
        const preview = await waitFor(
          () => dialog.querySelector(".article-markdown-editor .admin-markdown-editor-preview"),
          "article preview panel"
        );
        const previewHeight = preview.getBoundingClientRect().height;
        if (Math.abs(editHeight - previewHeight) > 1) {
          throw new Error("Article edit/preview height mismatch: " + editHeight + "px / " + previewHeight + "px.");
        }
        const code = await waitFor(() => preview.querySelector("pre code"), "HTML code example");
        if (!code.textContent.includes('<script src="https://example.com/example.js"></script>') ||
            !code.textContent.includes("<style>.example { color: red; }</style>") ||
            preview.querySelector("script, style") || window.__htoolsUnsafeMarkdown) {
          throw new Error("Markdown code example was lost or unsafe HTML survived sanitization.");
        }
        await closeDialog();
        return { height: previewHeight };
      },
      async publishArticle({ title }) {
        const item = await waitForCard(title);
        click(item.querySelector(".admin-article-publish-button"));
        await confirmDialog();
        await waitFor(
          () => card(title)?.querySelector(".admin-article-publish-button")?.getAttribute("aria-pressed") === "true",
          "published article",
          20000
        );
        return true;
      },
      async viewPush({ title }) {
        const item = await waitForCard(title);
        click(item.querySelector(".telegram-push-view-link"));
        const dialog = await waitFor(() => document.querySelector(".dialog-panel"), "push preview dialog");
        await waitFor(() => dialog.querySelector(".telegram-message-preview .markdown-content"), "push preview");
        await Promise.all(dialog.getAnimations().map((animation) => animation.finished.catch(() => {})));
        const heading = dialog.querySelector(".dialog-header h2");
        const originalHeading = heading.textContent;
        heading.textContent = "InteroperabilityConfigurationReference".repeat(4).slice(0, 140);
        try {
          const panelRect = dialog.getBoundingClientRect();
          for (const selector of [".dialog-header", ".dialog-body"]) {
            const rect = dialog.querySelector(selector).getBoundingClientRect();
            if (rect.left < panelRect.left - 1 || rect.right > panelRect.right + 1) {
              throw new Error("连续长标题撑宽了公共浏览弹窗：" + selector);
            }
          }
          const closeRect = dialog.querySelector(".dialog-header button").getBoundingClientRect();
          if (innerWidth >= 921 && (!closeRect.width || closeRect.right > panelRect.right || closeRect.left < panelRect.left)) {
            throw new Error("连续长标题挤走了桌面浏览弹窗关闭按钮。");
          }
        } finally {
          heading.textContent = originalHeading;
        }
        await closeDialog();
        return true;
      },
      async editPush({ title, nextTitle }) {
        const menu = await openCardMenu(title);
        const originalFetch = window.fetch;
        let automaticGitHubRequests = 0;
        window.fetch = (...args) => {
          const input = args[0];
          const url = typeof input === "string" ? input : input?.url || "";
          if (url.includes("/api/admin/github-metadata")) automaticGitHubRequests += 1;
          return originalFetch.apply(window, args);
        };
        let dialog;
        try {
          click(menu.querySelector('button[role="menuitem"]:not(.danger)'));
          dialog = await waitFor(
            () => document.querySelector("#telegram-custom-title")?.closest(".dialog-panel"),
            "push editor",
            20000
          );
          await sleep(900);
        } finally {
          window.fetch = originalFetch;
        }
        if (automaticGitHubRequests !== 0) {
          throw new Error("Editing an existing push read GitHub metadata automatically.");
        }
        const titleInput = await waitFor(
          () => {
            const input = dialog.querySelector("#telegram-custom-title");
            return input && !input.disabled ? input : null;
          },
          "ready push title"
        );
        const titleField = titleInput.closest(".admin-resource-text-field");
        const titleAiButton = titleField?.querySelector(".admin-ai-action-button");
        const githubButton = dialog.querySelector(".tool-github-metadata-button");
        const footerButtons = Array.from(dialog.querySelectorAll(".dialog-footer > button"));
        const [syncAction, saveButton] = footerButtons;
        const firstField = dialog.querySelector(".telegram-message-editor > .tool-form-field");
        const dialogRect = dialog.getBoundingClientRect();
        if (
          !dialog.classList.contains("admin-tool-editor-dialog") ||
          Math.abs(dialogRect.width - 600) > 1 ||
          !titleAiButton ||
          !githubButton ||
          !syncAction ||
          !saveButton ||
          footerButtons.length !== 3 ||
          syncAction.querySelector("svg") ||
          dialog.querySelector(".telegram-editor-top-actions") ||
          !firstField?.classList.contains("admin-resource-url-field") ||
          Math.abs(titleInput.getBoundingClientRect().height - 42) > 1 ||
          Math.abs(titleAiButton.getBoundingClientRect().height - 42) > 1 ||
          Math.abs(githubButton.getBoundingClientRect().height - 42) > 1 ||
          Math.abs(
            syncAction.getBoundingClientRect().height -
            saveButton.getBoundingClientRect().height
          ) > 1
        ) {
          throw new Error("Push editor order or footer source action is inconsistent.");
        }
        setValue(titleInput, nextTitle);
        await waitFor(
          () => dialog.querySelector("#telegram-rich-markdown-body")?.value.includes(nextTitle),
          "synchronized push Markdown"
        );
        await waitFor(
          () => !saveButton.disabled && saveButton,
          "push save button"
        );
        click(saveButton);
        await waitFor(() => saveButton.disabled, "saved push draft", 20000);
        await waitFor(() => !titleInput.disabled, "completed push save", 20000);
        await closeDialog();
        await waitForCard(nextTitle);
        return true;
      },
      async inspectArticlePushOrder({ title }) {
        const menu = await openCardMenu(title);
        click(menu.querySelector('button[role="menuitem"]:not(.danger)'));
        const dialog = await waitFor(
          () => document.querySelector("#telegram-custom-title")?.closest(".dialog-panel"),
          "article push editor",
          20000
        );
        await waitFor(
          () => !dialog.querySelector("#telegram-custom-title")?.disabled,
          "ready article push editor"
        );
        const editor = dialog.querySelector(".telegram-message-editor");
        const titleField = dialog.querySelector("#telegram-custom-title")?.closest(".tool-form-field");
        const descriptionField = dialog.querySelector(".admin-resource-textarea-field");
        const addressFields = Array.from(
          dialog.querySelectorAll(".admin-resource-url-field:not(.telegram-media-url-field)")
        );
        const addressField = addressFields[0];
        const tagsField = dialog.querySelector(".admin-resource-tags-field");
        const mediaField = dialog.querySelector(".telegram-media-url-field");
        const categoryField = dialog.querySelector(".admin-category-filter")?.closest(".tool-form-field");
        const markdownField = dialog.querySelector(".telegram-message-body-field");
        const children = Array.from(editor?.children || []);
        const order = [
          titleField,
          descriptionField,
          addressField,
          tagsField,
          mediaField,
          categoryField,
          markdownField
        ].map((field) => children.indexOf(field));
        const footerButtons = Array.from(dialog.querySelectorAll(".dialog-footer > button"));
        if (
          addressFields.length !== 1 ||
          !text(addressField?.querySelector("label")).includes("文章地址") ||
          order.some((index) => index < 0) ||
          order.some((index, position) => position > 0 && index <= order[position - 1]) ||
          footerButtons.length !== 3 ||
          footerButtons[0].querySelector("svg")
        ) {
          throw new Error("Article push fields do not follow the article editor order.");
        }
        await closeDialog();
        return true;
      },
      async syncContentPushSource({ category, description, title, url }) {
        const menu = await openCardMenu(title);
        click(menu.querySelector('button[role="menuitem"]:not(.danger)'));
        const dialog = await waitFor(
          () => document.querySelector("#telegram-custom-title")?.closest(".dialog-panel"),
          "content push editor",
          20000
        );
        const titleInput = await waitFor(
          () => {
            const input = dialog.querySelector("#telegram-custom-title");
            return input && !input.disabled ? input : null;
          },
          "ready content push editor"
        );
        const editor = dialog.querySelector(".telegram-message-editor");
        const titleField = titleInput.closest(".tool-form-field");
        const descriptionField = dialog.querySelector(".admin-resource-textarea-field");
        const addressFields = Array.from(
          dialog.querySelectorAll(".admin-resource-url-field:not(.telegram-media-url-field)")
        );
        const addressField = addressFields[0];
        const addressInput = addressField?.querySelector("input");
        const tagsField = dialog.querySelector(".admin-resource-tags-field");
        const tagsInput = tagsField?.querySelector("input");
        const mediaField = dialog.querySelector(".telegram-media-url-field");
        const categoryField = dialog.querySelector(".admin-category-filter")?.closest(".tool-form-field");
        const markdownField = dialog.querySelector(".telegram-message-body-field");
        const markdownInput = dialog.querySelector("#telegram-rich-markdown-body");
        const children = Array.from(editor?.children || []);
        const order = [
          titleField,
          descriptionField,
          addressField,
          tagsField,
          mediaField,
          categoryField,
          markdownField
        ].map((field) => children.indexOf(field));
        if (
          addressFields.length !== 1 ||
          !text(addressField?.querySelector("label")).includes("原文地址") ||
          order.some((index) => index < 0) ||
          order.some((index, position) => position > 0 && index <= order[position - 1]) ||
          !addressInput ||
          !tagsInput ||
          !markdownInput
        ) {
          throw new Error("Content push fields do not follow the content information order.");
        }

        setValue(titleInput, "Local Content Draft");
        setValue(descriptionField.querySelector("textarea"), "Local content draft summary");
        setValue(addressInput, "https://example.com/local-content-draft");
        setValue(tagsInput, "Local Draft");
        await waitFor(
          () => markdownInput.value.includes("Local Content Draft") &&
            markdownInput.value.includes("local-content-draft") &&
            markdownInput.value.includes("#Local_Draft"),
          "local content push Markdown"
        );

        const [syncButton, saveButton] = dialog.querySelectorAll(".dialog-footer > button");
        if (!syncButton || syncButton.disabled || !saveButton) {
          throw new Error("Content push source sync action is unavailable.");
        }
        click(syncButton);
        const confirmation = await waitFor(
          () => document.querySelector(".admin-confirm-dialog"),
          "content source sync confirmation"
        );
        click(confirmation.querySelector(".dialog-footer .primary-button"));
        await waitFor(
          () => !document.querySelector(".admin-confirm-dialog"),
          "content source sync completion",
          20000
        );
        await waitFor(
          () => titleInput.value === title &&
            descriptionField.querySelector("textarea")?.value === description &&
            addressInput.value === url &&
            tagsInput.value.includes(category) &&
            markdownInput.value.includes("**" + title + "**") &&
            markdownInput.value.includes(description) &&
            markdownInput.value.includes(url) &&
            markdownInput.value.includes("#" + category.replace(/\\s+/g, "_")),
          "synchronized content push fields",
          20000
        );
        await waitFor(() => !saveButton.disabled && saveButton, "content push save button");
        click(saveButton);
        await waitForTelegramEditorSaved(dialog, "saved synchronized content push");
        await closeDialog();
        await waitForCard(title);
        return true;
      },
      async inspectEditorPermissionFailure({ title }) {
        const item = await waitForCard(title);
        const menu = await openCardMenu(title);
        click(menu.querySelector('button[role="menuitem"]:not(.danger)'));
        const dialog = await waitFor(
          () => document.querySelector("#telegram-rich-markdown-body")?.closest(".dialog-panel"),
          "push permission editor",
          20000
        );
        await waitFor(
          () => !dialog.querySelector("#telegram-rich-markdown-body")?.disabled,
          "ready push permission editor"
        );
        const previewMode = dialog.querySelectorAll(".admin-markdown-editor-mode button")[1];
        click(previewMode);
        await waitFor(
          () => text(dialog.querySelector(".telegram-channel-preview-message")).includes(title),
          "push permission editor preview"
        );
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
          const input = args[0];
          const init = args[1] || {};
          const url = typeof input === "string" ? input : input?.url || "";
          const method = String(init.method || input?.method || "GET").toUpperCase();
          if (method === "POST" && url.includes("/api/admin/telegram-messages/")) {
            return new Response(
              JSON.stringify({
                error: "Forbidden: bot cannot send messages to the chat.",
                code: "TELEGRAM_PERMISSION_DENIED"
              }),
              {
                status: 403,
                headers: { "Content-Type": "application/json" }
              }
            );
          }
          return originalFetch.apply(window, args);
        };
        try {
          const sendButton = await waitFor(
            () => {
              const button = dialog.querySelector(".dialog-footer .primary-button:not(:disabled)");
              return visible(button) ? button : null;
            },
            "push permission editor send"
          );
          click(sendButton);
          // 权限错误走公共通知队列，匹配整组通知，避免先前的成功提示遮住检查目标。
          const error = await waitFor(
            () => findToast("机器人没有向目标群组或频道发送消息的权限"),
            "push permission editor error"
          );
          if (
            !visible(error) ||
            !text(dialog.querySelector(".telegram-channel-preview-message")).includes(title) ||
            dialog.querySelector(".admin-detail-placeholder")
          ) {
            throw new Error("Push editor permission error replaced the message preview.");
          }
          await waitFor(
            () => !dialog.querySelector(".dialog-footer .primary-button:disabled"),
            "push permission editor retry ready"
          );
          await closeDialog();
          return true;
        } finally {
          window.fetch = originalFetch;
        }
      },
      async inspectRecovery({ mediaUrl, resourceId, scenario, title }) {
        const item = await waitForCard(title);
        const menu = await openCardMenu(title);
        click(menu.querySelector('button[role="menuitem"]:not(.danger)'));
        const dialog = await waitFor(
          () => document.querySelector("#telegram-rich-markdown-body")?.closest(".dialog-panel"),
          "recovery editor " + title,
          20000
        );
        const textarea = await waitFor(
          () => {
            const element = dialog.querySelector("#telegram-rich-markdown-body");
            return element && !element.disabled ? element : null;
          },
          "recovery editor content " + title
        );
        const mediaInput = dialog.querySelector("#telegram-media-url");
        const mediaEnabledButton = dialog.querySelector(".telegram-media-url-field .settings-status-switch");
        if (
          mediaInput?.value !== mediaUrl ||
          mediaEnabledButton?.getAttribute("aria-checked") !== "true"
        ) {
          throw new Error("Recovery fixture did not load its image state.");
        }
        let expectedBody = textarea.value;
        const originalFetch = window.fetch;
        let fetchRestored = false;
        try {
          if (scenario === "missing") {
            expectedBody += "\\n\\nRecovery edit";
            setValue(textarea, expectedBody);
          }
          {
            // 两个场景现在都得走"保存 → 服务端在返回的 message 上回带标记 → 前端弹确认框",
            // 只有标记的值不同。旧脚本里 target-changed 是一开编辑器就该看到内联错误,
            // 那是 v1.0.24 的形状,v1.0.25 之后不成立了。
            const missingFlag = scenario === "missing" ? "deleted" : "target-changed";
            // v1.0.25 改了这个流程的形状:以前 PUT 直接失败(404
            // TELEGRAM_MESSAGE_NOT_FOUND),前端渲染一块内联错误 + 恢复按钮;
            // 现在保存本身是成功的,服务端在返回的 message 上带一个
            // remoteMessageMissing 标记,前端据此弹确认框问要不要重新推送。
            // 所以必须伪造一个**成功**的 PUT 响应。
            // 不能让真实 PUT 发出去:隔离环境里没有可达的 Telegram API,那个请求会一直挂着,
            // 编辑器停在 saving 态、按钮全灰、弹窗永远不出现(我第一版就是这么失败的)。
            // message 的形状不靠猜 —— 先 GET 一次拿服务端的真实对象,再套上这次的编辑结果。
            const currentResponse = await originalFetch(
              "/api/admin/telegram-messages/tool/" + encodeURIComponent(resourceId),
              { headers: { Authorization: "Bearer " + localStorage.getItem("htools_token") } }
            );
            if (!currentResponse.ok) {
              throw new Error("Failed to read the recovery fixture before faking the update.");
            }
            const currentMessage = (await currentResponse.json()).message;
            window.fetch = async (...args) => {
              const input = args[0];
              const init = args[1] || {};
              const url = typeof input === "string" ? input : input?.url || "";
              const method = String(init.method || input?.method || "GET").toUpperCase();
              if (method === "PUT" && url.includes("/api/admin/telegram-messages/")) {
                return new Response(
                  JSON.stringify({
                    message: {
                      ...currentMessage,
                      bodyMarkdown: expectedBody,
                      mediaEnabled: true,
                      mediaUrl,
                      remoteMessageMissing: missingFlag
                    }
                  }),
                  {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                  }
                );
              }
              return originalFetch.apply(window, args);
            };
            const updateButton = await waitFor(
              () => {
                const button = dialog.querySelector(".dialog-footer .primary-button:not(:disabled)");
                return visible(button) ? button : null;
              },
              "missing message update button"
            );
            click(updateButton);
          }

          // 新的载体是 AdminConfirmDialog,靠 descriptionId 拿稳定选择器
          // (AdminApp.tsx:6442 起)。文案来自 telegram.ts 的
          // resendDeletedDescription / resendTargetChangedDescription ——
          // 注意 target-changed 的新文案是"发送目标已改变",不再是旧内联错误那句
          // "Telegram 发送目标已经改变",少了前缀也少了"经"字。
          const expectedError = scenario === "missing"
            ? "原 Telegram 消息已不存在"
            : "发送目标已改变";
          const error = await waitFor(
            () => {
              const element = document.querySelector("#telegram-resend-dialog-description");
              return element && text(element).includes(expectedError) ? element : null;
            },
            "recovery error " + scenario
          );
          const resendDialog = error.closest(".admin-confirm-dialog");
          if (!resendDialog) throw new Error("Resend confirm dialog is missing its panel.");
          const recoverButton = await waitFor(
            () => {
              const button = resendDialog.querySelector(".dialog-footer .primary-button:not(:disabled)");
              return visible(button) ? button : null;
            },
            "recovery button " + scenario
          );
          if (!text(recoverButton).includes("重新推送")) {
            throw new Error("Resend confirm button lost its 重新推送 label.");
          }
          // 断言走**取消**路径,不走确认路径。理由:确认会真的再发一条 Telegram 消息,
          // 结果取决于隔离环境里有没有可用的 bot,断言就变成不确定的;而取消是纯前端逻辑,
          // AdminApp.tsx:6454 明确把状态设成 telegramText.resendSkipped,完全可预期。
          // 确认按钮的存在和文案上面已经断言过,所以这个弹窗的两条边都覆盖到了。
          const cancelButton = await waitFor(
            () => {
              const button = resendDialog.querySelector(".dialog-footer .ghost-button:not(:disabled)");
              return visible(button) ? button : null;
            },
            "resend cancel button " + scenario
          );
          window.fetch = originalFetch;
          fetchRestored = true;
          click(cancelButton);
          await waitFor(
            () => !document.querySelector("#telegram-resend-dialog-description"),
            "recovery error clear " + scenario
          );
          const status = await waitFor(
            () => findToast("当前内容未推送到当前目标"),
            "recovery status " + scenario
          );
          if (!visible(status)) throw new Error("Recovery status is not visible.");
          // 编辑器必须还开着、并保留管理员刚输入的内容 —— 这是 v1.0.25 那条
          // "保存成功但没送达时别把编辑器清掉"的行为契约,和旧流程一致,所以保留原断言。
          if (
            textarea.value !== expectedBody ||
            mediaInput.value !== mediaUrl ||
            mediaEnabledButton.getAttribute("aria-checked") !== "true"
          ) {
            throw new Error("Recovered Telegram state is inconsistent for " + scenario + ".");
          }
          const previewMode = dialog.querySelectorAll(".admin-markdown-editor-mode button")[1];
          click(previewMode);
          await waitFor(
            () => dialog.querySelector(".telegram-channel-photo-message"),
            "recovered image preview " + scenario
          );
          await closeDialog();
          return true;
        } finally {
          if (!fetchRestored) window.fetch = originalFetch;
        }
      },
      async deletePush({ title }) {
        const menu = await openCardMenu(title);
        click(menu.querySelector('button[role="menuitem"].danger'));
        await confirmDialog();
        await waitForCardRemoval(title);
        return true;
      },
      async deleteResource({ title }) {
        const menu = await openCardMenu(title);
        click(menu.querySelector('button[role="menuitem"].danger'));
        await confirmDialog();
        await waitForCardRemoval(title);
        return true;
      },
      async deleteContentSource({ title }) {
        for (const toggle of document.querySelectorAll(
          '.content-source-group-toggle[aria-expanded="false"]'
        )) {
          toggle.click();
        }
        const source = await waitFor(
          () => Array.from(document.querySelectorAll(".content-source-item"))
            .find((item) => text(item.querySelector("strong")) === title),
          "content source " + title,
          4000
        );
        click(source.querySelector(".content-source-main"));
        const trigger = await waitFor(
          () => {
            const button = document.querySelector(
              ".content-source-toolbar-actions .admin-tool-menu-trigger"
            );
            return button && visible(button) && !button.disabled ? button : null;
          },
          "content source menu " + title,
          4000
        );
        click(trigger);
        const remove = await waitFor(
          () => document.querySelector(
            ".content-source-toolbar-actions .admin-tool-action-menu button.danger"
          ),
          "content source delete action " + title,
          4000
        );
        click(remove);
        await confirmDialog();
        await waitFor(
          () => !Array.from(document.querySelectorAll(".content-source-item"))
            .some((item) => text(item.querySelector("strong")) === title),
          "content source removal " + title,
          8000
        );
        return true;
      },
      async inspectMobileOrphanPush({ title }) {
        const item = await waitForCard(title);
        const itemRect = item.getBoundingClientRect();
        const meta = item.querySelector(".admin-tool-title-meta");
        const status = meta?.lastElementChild;
        const actions = item.querySelector(".admin-tool-card-actions");
        if (
          !visible(status) ||
          itemRect.left < -1 ||
          itemRect.right > window.innerWidth + 1 ||
          meta.scrollWidth > meta.clientWidth + 1 ||
          !visible(actions) ||
          document.documentElement.scrollWidth > window.innerWidth + 2
        ) {
          throw new Error("Deleted source push card overflows on mobile: " + title);
        }

        const menu = await openCardMenu(title);
        const menuRect = menu.getBoundingClientRect();
        const menuButtons = Array.from(menu.querySelectorAll('button[role="menuitem"]'));
        if (
          menuButtons.length !== 2 ||
          menuRect.left < -1 ||
          menuRect.right > window.innerWidth + 1 ||
          menuRect.top < -1 ||
          menuRect.bottom > window.innerHeight + 1 ||
          menuButtons.some((button) => !visible(button) || button.scrollWidth > button.clientWidth + 1)
        ) {
          throw new Error("Deleted source push menu is clipped on mobile: " + title);
        }

        const editButton = menu.querySelector('button[role="menuitem"]:not(.danger)');
        click(editButton);
        const dialog = await waitFor(
          () => document.querySelector("#telegram-custom-title")?.closest(".dialog-panel"),
          "mobile orphan push editor " + title,
          20000
        );
        await waitFor(
          () => {
            const input = dialog.querySelector("#telegram-custom-title");
            return input && !input.disabled ? input : null;
          },
          "ready mobile orphan push editor " + title
        );
        const dialogRect = dialog.getBoundingClientRect();
        const footer = dialog.querySelector(".dialog-footer");
        const footerButtons = Array.from(footer?.querySelectorAll(":scope > button") || []);
        const [syncButton] = footerButtons;
        if (
          dialogRect.left < -1 ||
          dialogRect.right > window.innerWidth + 1 ||
          dialogRect.top < -1 ||
          dialogRect.bottom > window.innerHeight + 1 ||
          !visible(footer) ||
          footerButtons.length !== 3 ||
          syncButton?.disabled ||
          footer.scrollWidth > footer.clientWidth + 1 ||
          footerButtons.some((button) => !visible(button) || button.scrollWidth > button.clientWidth + 1) ||
          document.documentElement.scrollWidth > window.innerWidth + 2
        ) {
          throw new Error("Deleted source push editor overflows on mobile: " + title);
        }
        click(syncButton);
        await waitFor(
          () => findToast("来源已删除"),
          "deleted source sync status " + title
        );
        await closeDialog();
        return true;
      },
      async inspectOrphanPush({ nextTitle, title }) {
        const item = await waitForCard(title);
        if (text(item).includes("来源已删除")) {
          throw new Error("Deleted source push card still shows a persistent source status.");
        }
        click(item.querySelector(".telegram-push-view-link"));
        const previewDialog = await waitFor(
          () => document.querySelector(".telegram-push-preview-dialog"),
          "orphan push preview " + title
        );
        if (text(previewDialog).includes("来源已删除")) {
          throw new Error("Orphan push preview still repeats the deleted source status.");
        }
        await closeDialog();

        const menu = await openCardMenu(title);
        const editButton = menu.querySelector('button[role="menuitem"]:not(.danger)');
        if (!editButton || editButton.disabled) {
          throw new Error("Deleted source push record cannot be edited.");
        }
        click(editButton);
        const dialog = await waitFor(
          () => document.querySelector("#telegram-custom-title")?.closest(".dialog-panel"),
          "orphan push editor " + title,
          20000
        );
        const titleInput = await waitFor(
          () => {
            const input = dialog.querySelector("#telegram-custom-title");
            return input && !input.disabled ? input : null;
          },
          "ready orphan push editor " + title
        );
        const footerButtons = Array.from(dialog.querySelectorAll(".dialog-footer > button"));
        const [syncButton, saveButton] = footerButtons;
        const markdownInput = dialog.querySelector("#telegram-rich-markdown-body");
        if (
          footerButtons.length !== 3 ||
          syncButton?.disabled ||
          !saveButton ||
          !markdownInput?.value.includes(title)
        ) {
          throw new Error("Deleted source push editor did not preserve its independent snapshot.");
        }
        click(syncButton);
        await waitFor(
          () => findToast("来源已删除"),
          "deleted source sync status " + title
        );
        setValue(titleInput, nextTitle);
        await waitFor(
          () => markdownInput.value.includes(nextTitle),
          "orphan push Markdown update " + title
        );
        await waitFor(() => !saveButton.disabled && saveButton, "orphan push save " + title);
        click(saveButton);
        await waitForTelegramEditorSaved(dialog, "saved orphan push " + title);
        await closeDialog();
        await waitForCard(nextTitle);
        return true;
      },
      async exerciseTelegramSettings({ footer }) {
        const cardElement = await waitFor(
          () => document.querySelector(".telegram-settings-card:not([data-admin-loading])"),
          "Telegram settings"
        );
        const form = await waitFor(() => cardElement.querySelector("form"), "Telegram settings form");
        const inputs = form.querySelectorAll("input");
        const footerInput = inputs[1];
        const saveButton = form.querySelector('button[type="submit"]');
        const toggle = cardElement.querySelector('[role="switch"]');
        if (toggle?.dataset.state !== "enabled") throw new Error("Telegram fixture is not enabled.");
        setValue(footerInput, footer);
        await waitFor(() => !saveButton.disabled, "dirty Telegram settings");
        click(toggle);
        await waitFor(() => toggle.dataset.state === "disabled", "disabled Telegram service", 20000);
        if (footerInput.value !== footer) throw new Error("Unsaved Telegram footer was not preserved.");
        await waitFor(() => !saveButton.disabled, "ready Telegram settings save", 20000);
        click(saveButton);
        await waitFor(() => saveButton.disabled, "saved Telegram settings", 20000);
        await waitFor(() => !toggle.disabled, "ready Telegram service toggle", 20000);
        click(toggle);
        await waitFor(() => toggle.dataset.state === "enabled", "re-enabled Telegram service", 20000);
        return true;
      },
      async exerciseRestoredServiceSettings() {
        const headers = {
          Authorization: "Bearer " + localStorage.getItem("htools_token"),
          "Content-Type": "application/json"
        };
        const request = async (path, init = {}) => {
          const response = await fetch(path, { ...init, headers });
          if (!response.ok) throw new Error("Service regression request failed: " + path);
          return response.json();
        };
        const imageCard = await waitFor(
          () => document.querySelector(".image-bed-settings-card form")?.closest("article"),
          "image settings form"
        );
        const imageInputs = imageCard.querySelectorAll("form input");
        const imageSave = imageCard.querySelector('button[type="submit"]');
        setValue(imageInputs[0], "https://saved.example/");
        setValue(imageInputs[2], "saved");
        await waitFor(() => !imageSave.disabled, "initial image settings edits");
        click(imageSave);
        await waitFor(() => imageSave.disabled && !imageInputs[0].disabled, "initial image settings saved");
        setValue(imageInputs[0], "https://draft.example/");
        setValue(imageInputs[2], "draft");
        await waitFor(() => !imageSave.disabled, "image settings draft");
        const imageToggle = imageCard.querySelector('[role="switch"]');
        click(imageToggle);
        await waitFor(() => imageToggle.dataset.state === "enabled" && !imageToggle.disabled, "image service enabled");
        if (imageInputs[0].value !== "https://draft.example/" || imageInputs[2].value !== "draft") {
          throw new Error("Image service toggle discarded unsaved form edits.");
        }
        const storedImage = (await request("/api/admin/image-bed-settings")).settings;
        if (storedImage.baseUrl !== "https://saved.example/" || storedImage.uploadFolder !== "saved") {
          throw new Error("Image service toggle persisted unsaved form edits.");
        }
        click(imageSave);
        await waitFor(() => imageSave.disabled && !imageInputs[0].disabled, "image draft saved");

        const backup = await request("/api/admin/backup");
        const replacements = {
          github_settings: { enabled: true, owner: "restored-owner", repo: "restored-repo", labels: ["restored"] },
          image_bed_settings: { ...storedImage, enabled: true, baseUrl: "https://restored.example/", uploadFolder: "restored" },
          rsshub_settings: { enabled: true, baseUrl: "https://restored-rss.example/" }
        };
        for (const [key, value] of Object.entries(replacements)) {
          const entry = backup.data.settings.find((setting) => setting.key === key);
          if (entry) entry.value = JSON.stringify(value);
          else backup.data.settings.push({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() });
        }
        backup.counts.settings = backup.data.settings.length;
        click(document.querySelector("#system-settings-tab-management"));
        const fileInput = await waitFor(
          () => document.querySelector('.backup-restore-card input[type="file"]'),
          "backup file input"
        );
        const files = new DataTransfer();
        files.items.add(new File([JSON.stringify(backup)], "service-regression.json", { type: "application/json" }));
        fileInput.files = files.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        const restoreButton = await waitFor(
          () => document.querySelector('.backup-restore-card button.ghost-button:not(:disabled)'),
          "backup restore ready"
        );
        click(restoreButton);
        const confirmation = await waitFor(
          () => document.querySelector("#backup-restore-dialog-description")?.closest(".dialog-panel"),
          "backup restore confirmation"
        );
        click(confirmation.querySelector(".dialog-footer .primary-button"));
        await waitFor(() => !document.querySelector("#backup-restore-dialog-description"), "backup restored", 20000);
        click(document.querySelector("#system-settings-tab-services"));
        const expected = [
          [".github-submission-card", "/api/admin/github-settings", "restored-owner", "owner"],
          [".image-bed-settings-card", "/api/admin/image-bed-settings", "https://restored.example/", "baseUrl"],
          [".rsshub-settings-card", "/api/admin/rsshub-settings", "https://restored-rss.example/", "baseUrl"]
        ];
        for (const [selector, path, value, field] of expected) {
          const restoredCard = await waitFor(() => {
            const element = document.querySelector(selector);
            return element?.querySelector("form input")?.value === value ? element : null;
          }, "restored service form " + selector);
          if (!restoredCard.querySelector('button[type="submit"]').disabled) {
            throw new Error("Restored settings are incorrectly marked as unsaved: " + selector);
          }
          const toggle = restoredCard.querySelector('[role="switch"]');
          click(toggle);
          await waitFor(() => toggle.dataset.state === "disabled" && !toggle.disabled, "restored service toggle " + selector);
          if ((await request(path)).settings[field] !== value) {
            throw new Error("Service toggle overwrote the restored configuration: " + selector);
          }
        }
        return true;
      },
      async mobileToolDialog() {
        const createButton = await waitFor(
          () => document.querySelector(".admin-topbar .admin-create-button:not(:disabled)"),
          "mobile tool create button"
        );
        click(createButton);
        const dialog = await waitFor(
          () => document.querySelector("#admin-tool-editor-form")?.closest(".dialog-panel"),
          "mobile tool dialog"
        );
        const footer = dialog.querySelector(".dialog-footer");
        if (!visible(footer)) throw new Error("Mobile dialog footer is not visible.");
        if (document.documentElement.scrollWidth > window.innerWidth + 2) {
          throw new Error("Mobile tool dialog causes horizontal overflow.");
        }
        dialog.dispatchEvent(new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Escape"
        }));
        await waitFor(() => !document.querySelector(".dialog-panel"), "mobile dialog close");
        return true;
      },
      async inspectMobileEnglishFieldAssistants({ formSelector, minimum, prepareGitHub = false }) {
        const createButton = await waitFor(
          () => document.querySelector(".admin-topbar .admin-create-button:not(:disabled)"),
          "mobile English create button"
        );
        click(createButton);
        const editorTarget = await waitFor(
          () => document.querySelector(formSelector),
          "mobile English editor"
        );
        const dialog = editorTarget.closest(".dialog-panel");
        if (!dialog) throw new Error("Mobile English editor dialog is missing.");

        if (prepareGitHub) {
          const projectInput = dialog.querySelector("#admin-tool-url") || Array.from(
            dialog.querySelectorAll(".admin-resource-url-field input")
          ).find((input) => input.id !== "telegram-media-url");
          setValue(projectInput, "https://github.com/shaoyouvip/htools");
        }

        const assistantSelector = ".field-assist-button, .field-assist-toggle";
        const rows = await waitFor(() => {
          const visibleRows = Array.from(
            dialog.querySelectorAll(".admin-resource-input-row, .admin-markdown-editor-input-row")
          ).filter((row) => visible(row) && visible(row.querySelector(assistantSelector)));
          return visibleRows.length >= minimum ? visibleRows : null;
        }, "mobile English field assistants", 20000);

        for (const row of rows) {
          const field = row.closest(".tool-form-field, .admin-markdown-editor");
          const title = field?.querySelector(
            ":scope > .tool-form-field-head label, :scope > .tool-form-label, :scope > .admin-markdown-editor-heading label"
          );
          const assistant = row.querySelector(assistantSelector);
          const control = row.querySelector(
            "input, textarea, .admin-category-filter, .admin-markdown-editor-edit, .admin-markdown-editor-preview"
          );
          if (!visible(title) || !visible(assistant)) {
            throw new Error("Mobile English field assistant is missing visible content.");
          }
          const rowRect = row.getBoundingClientRect();
          const assistantRect = assistant.getBoundingClientRect();
          if (title.scrollWidth > title.clientWidth + 1) {
            throw new Error("Mobile English field title is clipped: " + text(title));
          }
          const toolbar = assistant.closest(".admin-markdown-toolbar");
          if (!toolbar && visible(control) && control.getBoundingClientRect().right > assistantRect.left + 1) {
            throw new Error("Mobile English field control overlaps its assistant: " + text(title));
          }
          if (toolbar) {
            const toolbarRect = toolbar.getBoundingClientRect();
            if (
              assistantRect.right > toolbarRect.right + 1 ||
              assistantRect.left < toolbarRect.left - 1 ||
              assistant.scrollWidth > assistant.clientWidth + 1
            ) {
              throw new Error("Mobile English Markdown assistant is clipped or outside its toolbar: " + text(assistant));
            }
          }
          if (
            assistantRect.right > rowRect.right + 1 ||
            assistantRect.left < rowRect.left - 1
          ) {
            throw new Error("Mobile English field assistant overflows its control row: " + text(assistant));
          }
        }
        if (document.documentElement.scrollWidth > window.innerWidth + 2) {
          throw new Error("Mobile English field assistants cause horizontal overflow.");
        }
        await closeDialog();
        return rows.map((row) => text(row));
      }
    };
  })()`);
}

async function runCriticalBrowserAction(client, action, payload = {}) {
  return evaluate(
    client,
    `window.__htoolsCritical[${JSON.stringify(action)}](${JSON.stringify(payload)})`,
    { awaitPromise: true }
  );
}

async function openCriticalFlowRoute(client, origin, path) {
  await navigate(client, new URL(path, origin).href);
  await waitForPageSettled(client, 15000);
  await installCriticalFlowHelpers(client);
}

async function runCriticalFlows(options) {
  await mkdir(runtimeRoot, { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  await cleanupStaleRuntime();
  await pruneArtifacts();

  const runId = `flows-${createRunId()}`;
  const runPath = join(runtimeRoot, runId);
  const persistPath = join(runPath, "state");
  const profilePath = join(runPath, "profile");
  const artifactsPath = join(artifactRoot, runId);
  await mkdir(runPath, { recursive: true });
  await mkdir(artifactsPath, { recursive: true });
  await writeFile(
    join(runPath, "run.json"),
    `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`
  );

  let server;
  let browser;
  let page;
  let runError = null;
  const steps = [];
  const runStep = async (name, action) => {
    const startedAt = Date.now();
    try {
      await action();
      steps.push({ name, status: "passed", durationMs: Date.now() - startedAt });
      console.log(`[通过] ${name}`);
    } catch (error) {
      steps.push({
        name,
        status: "failed",
        durationMs: Date.now() - startedAt,
        error: error.message
      });
      throw error;
    }
  };

  try {
    if (!(await pathExists(resolve(projectRoot, "dist/index.html")))) {
      throw new Error("Production build is missing. Run npm run build before critical flows.");
    }
    server = await startIsolatedPagesDev(persistPath);
    await seedCriticalFlowData(server.origin);
    browser = await launchEdge(profilePath);
    page = await openPage(browser);
    const client = page.client;
    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Network.enable")
    ]);
    await setViewport(client, REGRESSION_VIEWPORTS[2]);

    await runStep("管理员登录", async () => {
      await openCriticalFlowRoute(client, server.origin, "/admin/tools");
      await runCriticalBrowserAction(client, "login", {
        password: CRITICAL_FLOW_PASSWORD
      });
    });
    await runStep("后台管理员卡片点击边界与侧栏状态", async () => {
      const target = await runCriticalBrowserAction(client, "inspectAdminIdentityCard");
      await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: target.x,
        y: target.y
      });
      await wait(120);
      const background = await evaluate(
        client,
        `getComputedStyle(document.querySelector(".admin-user-card .icon-button")).backgroundColor`
      );
      if (background === "rgba(0, 0, 0, 0)") {
        throw new Error("Borderless logout icon has no shared hover feedback.");
      }
      await runCriticalBrowserAction(client, "restoreAdminIdentityCard");
    });
    await openCriticalFlowRoute(client, server.origin, "/admin/push");
    await runStep("自定义推送字段辅助与预览图", () =>
      runCriticalBrowserAction(client, "inspectCustomPushFieldAssistants", {
        mediaUrl: "https://example.com/current-preview.png",
        projectUrl: "https://github.com/shaoyouvip/htools"
      })
    );
    await openCriticalFlowRoute(client, server.origin, "/admin/tools");
    await setViewport(client, REGRESSION_VIEWPORTS[1]);
    await runStep("已推送快捷弹窗加载态", () =>
      runCriticalBrowserAction(client, "inspectQuickLoading", {
        expectedPushed: true,
        title: "Recovery Tool",
        theme: "light"
      })
    );
    await openCriticalFlowRoute(client, server.origin, "/admin/push");
    await runStep("更新推送结果不确定时确认重试", () =>
      runCriticalBrowserAction(client, "inspectQuickUncertainRetry", {
        title: "Recovery Tool",
        resourceId: "critical-recovery-tool"
      })
    );
    await runStep("原消息删除后重新建立推送", () =>
      runCriticalBrowserAction(client, "inspectRecovery", {
        mediaUrl: "https://example.com/recovery-preview.png",
        resourceId: "critical-recovery-tool",
        scenario: "missing",
        title: "Recovery Tool"
      })
    );
    await runStep("发送目标改变后重新建立推送", () =>
      runCriticalBrowserAction(client, "inspectRecovery", {
        mediaUrl: "https://example.com/target-preview.png",
        resourceId: "critical-target-tool",
        scenario: "target",
        title: "Target Changed Tool"
      })
    );
    await openCriticalFlowRoute(client, server.origin, "/admin/tools");
    await runStep("新增工具", () => runCriticalBrowserAction(client, "createTool", {
      name: "Regression Tool",
      description: "Regression tool initial description",
      url: "https://example.com/regression-tool"
    }));
    await runStep("编辑工具", () => runCriticalBrowserAction(client, "editTool", {
      name: "Regression Tool",
      description: "Regression tool updated description"
    }));
    await runStep("桌面浅色消息预览加载态", () =>
      runCriticalBrowserAction(client, "inspectQuickLoading", {
        title: "Regression Tool",
        theme: "light"
      })
    );
    await runStep("桌面深色消息预览加载态", () =>
      runCriticalBrowserAction(client, "inspectQuickLoading", {
        title: "Regression Tool",
        theme: "dark"
      })
    );
    await setViewport(client, REGRESSION_VIEWPORTS[3]);
    await runStep("手机浅色消息预览加载态", () =>
      runCriticalBrowserAction(client, "inspectQuickLoading", {
        title: "Regression Tool",
        theme: "light"
      })
    );
    await runStep("手机深色消息预览加载态", () =>
      runCriticalBrowserAction(client, "inspectQuickLoading", {
        title: "Regression Tool",
        theme: "dark"
      })
    );
    await setViewport(client, REGRESSION_VIEWPORTS[2]);
    await runStep("消息预览读取超时", () =>
      runCriticalBrowserAction(client, "inspectQuickLoadFailure", {
        title: "Regression Tool"
      })
    );
    await runStep("消息推送权限错误", () =>
      runCriticalBrowserAction(client, "inspectQuickPermissionFailure", {
        title: "Regression Tool"
      })
    );
    await runStep("推送结果不确定确认重试与草稿保存", () =>
      runCriticalBrowserAction(client, "inspectQuickUncertainRetry", {
        title: "Regression Tool"
      })
    );
    await runStep("工具保存推送草稿", () => runCriticalBrowserAction(client, "saveQuickDraft", {
      title: "Regression Tool",
      defaultCategoryLabel: "工具库（默认）"
    }));

    await openCriticalFlowRoute(client, server.origin, "/admin/articles");
    await runStep("新增文章草稿", () => runCriticalBrowserAction(client, "createArticle", {
      title: "Regression Article",
      summary: "Regression article summary",
      slug: "regression-article",
      content: '# Regression Article\n\nBrowser regression article body.\n\n```html\n<script src="https://example.com/example.js"></script>\n<style>.example { color: red; }</style>\n```\n\n<script>window.__htoolsUnsafeMarkdown = true</script>',
      category: "Regression"
    }));
    let articleEditorPreviewHeight = 0;
    await runStep("文章编辑与浏览同高，HTML 代码保留且危险标签被清除", async () => {
      const result = await runCriticalBrowserAction(client, "inspectArticleEditorPreviewHeight", {
        title: "Regression Article"
      });
      articleEditorPreviewHeight = result.height;
    });
    await runStep("发布文章", () => runCriticalBrowserAction(client, "publishArticle", {
      title: "Regression Article"
    }));
    await runStep("文章保存推送草稿", () => runCriticalBrowserAction(client, "saveQuickDraft", {
      title: "Regression Article",
      defaultCategoryLabel: "文章管理（默认）"
    }));

    await openCriticalFlowRoute(client, server.origin, "/admin/content");
    await runStep("订阅内容分类筛选弹层层级", () =>
      runCriticalBrowserAction(client, "inspectFilterCategoryPopover")
    );
    await runStep("订阅分类单击筛选与双击展开", async () => {
      const result = await runCriticalBrowserAction(
        client,
        "inspectCategoryGroupToggle"
      );
      if (result.filterLabel === result.toolbarLabel) {
        throw new Error(
          "Rail category selection must not change the top category filter: " +
            JSON.stringify(result)
        );
      }
      return true;
    });
    await runStep("订阅内容转文章浏览内容", () =>
      runCriticalBrowserAction(client, "inspectContentConvertPreview", {
        expectedHeight: articleEditorPreviewHeight,
        title: "Regression Content"
      })
    );
    await runStep("订阅内容保存推送草稿", () => runCriticalBrowserAction(client, "saveQuickDraft", {
      title: "Regression Content",
      defaultCategoryLabel: "订阅内容（默认）"
    }));
    await runStep("更新订阅条目来源数据", () =>
      runCriticalBrowserAction(client, "migrateContentCategory", {
        category: "Regression",
        targetCategory: "Synced Regression"
      })
    );
    await openCriticalFlowRoute(client, server.origin, "/admin/push");
    await runStep("订阅内容同步来源并回填正文", () =>
      runCriticalBrowserAction(client, "syncContentPushSource", {
        title: "Regression Content",
        description: "Browser regression content summary",
        url: "https://example.com/regression-content",
        category: "Synced Regression"
      })
    );
    await runStep("文章推送字段顺序", () =>
      runCriticalBrowserAction(client, "inspectArticlePushOrder", {
        title: "Regression Article"
      })
    );
    await runStep("完整编辑推送权限错误", () =>
      runCriticalBrowserAction(client, "inspectEditorPermissionFailure", {
        title: "Regression Tool"
      })
    );
    await runStep("浏览推送与连续长标题边界", () => runCriticalBrowserAction(client, "viewPush", {
      title: "Regression Content"
    }));
    await runStep("编辑推送并同步 Markdown", () => runCriticalBrowserAction(client, "editPush", {
      title: "Regression Tool",
      nextTitle: "Regression Tool Push Updated"
    }));
    if (options.screenshots) {
      await captureScreenshot(client, join(artifactsPath, "critical-push-management.png"));
    }

    await openCriticalFlowRoute(client, server.origin, "/admin/tools");
    await runStep("删除工具", () => runCriticalBrowserAction(client, "deleteResource", {
      title: "Regression Tool"
    }));
    await openCriticalFlowRoute(client, server.origin, "/admin/articles");
    await runStep("删除文章", () => runCriticalBrowserAction(client, "deleteResource", {
      title: "Regression Article"
    }));
    await openCriticalFlowRoute(client, server.origin, "/admin/content");
    await runStep("删除订阅源并保留推送记录", () =>
      runCriticalBrowserAction(client, "deleteContentSource", {
        title: "Regression Feed"
      })
    );

    await openCriticalFlowRoute(client, server.origin, "/admin/push");
    await setViewport(client, REGRESSION_VIEWPORTS[3]);
    await runStep("手机端工具来源删除状态与编辑布局", () =>
      runCriticalBrowserAction(client, "inspectMobileOrphanPush", {
        title: "Regression Tool Push Updated"
      })
    );
    await openCriticalFlowRoute(client, server.origin, "/admin/push");
    await runStep("手机端文章来源删除状态与编辑布局", () =>
      runCriticalBrowserAction(client, "inspectMobileOrphanPush", {
        title: "Regression Article"
      })
    );
    await openCriticalFlowRoute(client, server.origin, "/admin/push");
    await runStep("手机端订阅源删除状态与编辑布局", () =>
      runCriticalBrowserAction(client, "inspectMobileOrphanPush", {
        title: "Regression Content"
      })
    );
    await setViewport(client, REGRESSION_VIEWPORTS[2]);
    await openCriticalFlowRoute(client, server.origin, "/admin/push");
    await runStep("工具来源删除后推送仍可编辑", () =>
      runCriticalBrowserAction(client, "inspectOrphanPush", {
        title: "Regression Tool Push Updated",
        nextTitle: "Regression Tool Orphan"
      })
    );
    await runStep("文章来源删除后推送仍可编辑", () =>
      runCriticalBrowserAction(client, "inspectOrphanPush", {
        title: "Regression Article",
        nextTitle: "Regression Article Orphan"
      })
    );
    await runStep("订阅源删除后推送仍可编辑", () =>
      runCriticalBrowserAction(client, "inspectOrphanPush", {
        title: "Regression Content",
        nextTitle: "Regression Content Orphan"
      })
    );
    await runStep("清理订阅内容孤立推送记录", () =>
      runCriticalBrowserAction(client, "deletePush", {
        title: "Regression Content Orphan"
      })
    );
    await runStep("清理文章孤立推送记录", () =>
      runCriticalBrowserAction(client, "deletePush", {
        title: "Regression Article Orphan"
      })
    );
    await runStep("清理工具孤立推送记录", () =>
      runCriticalBrowserAction(client, "deletePush", {
        title: "Regression Tool Orphan"
      })
    );

    await openCriticalFlowRoute(client, server.origin, "/admin/settings/services");
    await runStep("Telegram 设置脏状态、保存与开关", () =>
      runCriticalBrowserAction(client, "exerciseTelegramSettings", {
        footer: "[Regression](https://example.com)"
      })
    );
    await runStep("图床开关保留草稿，备份恢复刷新服务设置", () =>
      runCriticalBrowserAction(client, "exerciseRestoredServiceSettings")
    );

    await setViewport(client, REGRESSION_VIEWPORTS[3]);
    await openCriticalFlowRoute(client, server.origin, "/");
    await runStep("前台手机管理员卡片点击边界", () =>
      runCriticalBrowserAction(client, "inspectMobileAdminCard")
    );
    await openCriticalFlowRoute(client, server.origin, "/admin/tools");
    await runStep("手机端工具弹窗", () =>
      runCriticalBrowserAction(client, "mobileToolDialog")
    );
    await runStep("手机端英文辅助按钮布局", async () => {
      await evaluate(client, `localStorage.setItem("htools_locale", "en")`);
      await openCriticalFlowRoute(client, server.origin, "/admin/tools");
      await runCriticalBrowserAction(client, "inspectMobileEnglishFieldAssistants", {
        formSelector: "#admin-tool-editor-form",
        minimum: 4,
        prepareGitHub: true
      });
      await openCriticalFlowRoute(client, server.origin, "/admin/articles");
      await runCriticalBrowserAction(client, "inspectMobileEnglishFieldAssistants", {
        formSelector: "#admin-article-editor-form",
        minimum: 3
      });
      await openCriticalFlowRoute(client, server.origin, "/admin/push");
      await runCriticalBrowserAction(client, "inspectMobileEnglishFieldAssistants", {
        formSelector: "#telegram-custom-title",
        minimum: 4,
        prepareGitHub: true
      });
    });
  } catch (error) {
    runError = error;
    if (page && options.screenshots) {
      try {
        await captureScreenshot(
          page.client,
          join(artifactsPath, "critical-flow-failure.png")
        );
      } catch {
        // Keep the original interaction failure.
      }
    }
  } finally {
    page?.client.close();
    await closeBrowser(browser);
    await stopIsolatedPagesDev(server?.child);
    try {
      await safeRemove(runtimeRoot, runPath);
    } catch (error) {
      runError ??= error;
    }
  }

  const report = {
    version: 1,
    type: "critical-flows",
    status: runError ? "failed" : "passed",
    runId,
    isolated: true,
    summary: {
      checks: steps.length,
      passed: steps.filter((step) => step.status === "passed").length,
      failed: steps.filter((step) => step.status === "failed").length
    },
    error: runError?.message || null,
    steps
  };
  await writeFile(join(artifactsPath, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await pruneArtifacts({ currentRun: runId });
  const tmpBytesAfter = await directorySize(projectTmpRoot);
  console.log(
    `[HTools] 关键操作回归${report.status === "passed" ? "通过" : "失败"}：` +
      `${report.summary.passed}/${report.summary.checks}，` +
      `tmp ${(tmpBytesAfter / MB).toFixed(1)}MB。`
  );
  console.log(`[HTools] 报告：${join(artifactsPath, "report.json")}`);
  if (runError) throw runError;
}

async function runCleanup(options) {
  await mkdir(runtimeRoot, { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  const staleRuntimeRemoved = await cleanupStaleRuntime();
  const legacyProfilesRemoved = await cleanupLegacyProfiles();
  const artifacts = await pruneArtifacts({ removeAll: options.cleanAll });
  const tmpBytes = await directorySize(projectTmpRoot);
  console.log(
    `[HTools] 清理完成：运行目录 ${staleRuntimeRemoved} 个，旧 Edge 配置 ${legacyProfilesRemoved} 个，` +
      `保留回归产物 ${artifacts.kept} 轮，tmp ${(tmpBytes / MB).toFixed(1)}MB。`
  );
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }
  if (options.command === "clean") {
    await runCleanup(options);
    return;
  }
  if (options.command === "flows") {
    await runCriticalFlows(options);
    return;
  }
  await runRegression(options);
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryPath === import.meta.url) {
  main().catch((error) => {
    console.error(`[HTools] ${error.message}`);
    process.exitCode = error.exitCode ?? 1;
  });
}
