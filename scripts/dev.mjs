import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const venvPython = join(rootDir, ".venv", isWindows ? "Scripts/python.exe" : "bin/python");
const viteBin = join(rootDir, "node_modules", "vite", "bin", "vite.js");
const healthUrl = "http://127.0.0.1:8000/health";
const children = new Set();
let shuttingDown = false;

function runStep(label, command, args) {
  console.log(`\n[kaobuddy] ${label}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function bootstrapPythonCommand() {
  if (process.env.PYTHON) return { command: process.env.PYTHON, args: [] };
  if (isWindows) return { command: "py", args: ["-3"] };
  return { command: "python3", args: [] };
}

function ensureVenv() {
  if (existsSync(venvPython)) return;
  const python = bootstrapPythonCommand();
  runStep("创建 Python 虚拟环境 .venv", python.command, [...python.args, "-m", "venv", ".venv"]);
}

function ensureNodeModules() {
  if (existsSync(viteBin)) return;
  runStep("安装前端依赖 npm install", isWindows ? "npm.cmd" : "npm", ["install"]);
}

function spawnChild(label, command, args) {
  console.log(`\n[kaobuddy] 启动 ${label}`);
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
  });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    shuttingDown = true;
    for (const item of children) item.kill();
    if (signal) {
      console.log(`\n[kaobuddy] ${label} 已退出：${signal}`);
      process.exit(1);
    }
    process.exit(code || 0);
  });
  return child;
}

async function waitForBackend() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {
      // Backend is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  console.error("\n[kaobuddy] 后端 30 秒内没有启动成功，请看上面的 FastAPI 日志。");
  shutdown(1);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

ensureVenv();
runStep("安装后端依赖 pip install -e .[test]", venvPython, ["-m", "pip", "install", "-e", ".[test]"]);
ensureNodeModules();

spawnChild("FastAPI 后端 http://127.0.0.1:8000", venvPython, [
  "-m",
  "uvicorn",
  "backend.app.main:app",
  "--host",
  "127.0.0.1",
  "--port",
  "8000",
]);

await waitForBackend();
console.log("\n[kaobuddy] 后端已就绪，Vite 页面打开 http://localhost:5173/");
spawnChild("Vite 前端 http://localhost:5173", process.execPath, [viteBin, "--host", "0.0.0.0"]);
