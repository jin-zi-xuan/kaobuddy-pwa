from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUTS_DIR = ROOT / "outputs"
PYINSTALLER_BUILD_DIR = ROOT / "build" / "pyinstaller"
PYINSTALLER_DIST_DIR = ROOT / "dist" / "pyinstaller"
REQUIRED_STATIC_FILES = [
    Path("backend/static/index.html"),
    Path("backend/static/manifest.webmanifest"),
    Path("backend/static/sw.js"),
    Path("backend/static/icons/icon.svg"),
]


TARGETS = {
    "windows": {
        "folder": "KaoBuddy-Windows",
        "executable": "kaobuddy.exe",
        "launcher": "start-kaobuddy.bat",
    },
    "macos": {
        "folder": "KaoBuddy-macOS",
        "executable": "kaobuddy",
        "launcher": "start-kaobuddy.command",
    },
}


def run(command: list[str]) -> None:
    subprocess.run(command, cwd=ROOT, check=True)


def pyinstaller_data_arg(source: str, dest: str) -> str:
    separator = ";" if os.name == "nt" else ":"
    return f"{source}{separator}{dest}"


def validate_static_assets(root: Path = ROOT) -> None:
    missing = [path for path in REQUIRED_STATIC_FILES if not (root / path).is_file()]
    if missing:
        missing_list = ", ".join(path.as_posix() for path in missing)
        raise FileNotFoundError(f"便携包缺少前端静态文件：{missing_list}。请先运行 npm run build。")


def build_executable() -> Path:
    validate_static_assets()
    static_dir = ROOT / "backend" / "static"
    public_dir = ROOT / "public"
    run([
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        "kaobuddy",
        "--distpath",
        str(PYINSTALLER_DIST_DIR),
        "--workpath",
        str(PYINSTALLER_BUILD_DIR),
        "--collect-submodules",
        "uvicorn",
        "--add-data",
        pyinstaller_data_arg(str(static_dir), "backend/static"),
        "--add-data",
        pyinstaller_data_arg(str(public_dir), "public"),
        "scripts/kaobuddy_launcher.py",
    ])
    executable = PYINSTALLER_DIST_DIR / ("kaobuddy.exe" if os.name == "nt" else "kaobuddy")
    if not executable.exists():
        raise FileNotFoundError(f"PyInstaller 没有生成 {executable}")
    return executable


def write_windows_launcher(path: Path) -> None:
    path.write_text(
        "@echo off\n"
        "chcp 65001 >nul\n"
        "cd /d \"%~dp0\"\n"
        "kaobuddy.exe\n"
        "pause\n",
        encoding="utf-8",
    )


def write_macos_launcher(path: Path) -> None:
    path.write_text(
        "#!/bin/zsh\n"
        "cd \"$(dirname \"$0\")\"\n"
        "chmod +x ./kaobuddy 2>/dev/null || true\n"
        "./kaobuddy\n"
        "read \"?按回车退出...\"\n",
        encoding="utf-8",
    )
    path.chmod(0o755)


def write_readme(path: Path, target: str) -> None:
    if target == "windows":
        start_text = "双击 `start-kaobuddy.bat`。如果系统提示安全风险，选择仍要运行。"
    else:
        start_text = "双击 `start-kaobuddy.command`。如果 macOS 拦截，右键点它，选择「打开」。"
    path.write_text(
        "KaoBuddy 免安装便携包\n"
        "====================\n\n"
        "怎么启动：\n"
        f"1. {start_text}\n"
        "2. 等浏览器自动打开 http://127.0.0.1:8000。\n"
        "3. 填自己的 AI API Key，就可以开始用。\n\n"
        "注意：\n"
        "- 关闭启动窗口，KaoBuddy 也会停止。\n"
        "- 这是本机运行，不会把你的资料上传到 KaoBuddy 服务器。\n"
        "- 如果 8000 端口被占用，程序会自动尝试 8001、8002 等后续端口。\n",
        encoding="utf-8",
    )


def create_package(target: str, executable: Path) -> Path:
    config = TARGETS[target]
    package_root = ROOT / "build" / "portable" / config["folder"]
    if package_root.exists():
        shutil.rmtree(package_root)
    package_root.mkdir(parents=True)

    shutil.copy2(executable, package_root / config["executable"])
    if target == "windows":
        write_windows_launcher(package_root / config["launcher"])
    else:
        launcher = package_root / config["launcher"]
        write_macos_launcher(launcher)
        (package_root / config["executable"]).chmod(0o755)
    write_readme(package_root / "README-先看我.txt", target)

    OUTPUTS_DIR.mkdir(exist_ok=True)
    zip_base = OUTPUTS_DIR / config["folder"]
    zip_path = shutil.make_archive(str(zip_base), "zip", package_root)
    return Path(zip_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build KaoBuddy portable zip package.")
    parser.add_argument("--target", choices=TARGETS.keys(), required=True)
    args = parser.parse_args()

    executable = build_executable()
    zip_path = create_package(args.target, executable)
    print(f"created {zip_path}")


if __name__ == "__main__":
    main()
