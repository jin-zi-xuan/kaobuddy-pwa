from __future__ import annotations

import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path


def bundle_root() -> Path:
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass).resolve()
    return Path(__file__).resolve().parents[2]


def portable_data_root(root_dir: Path) -> Path:
    root = Path(root_dir).resolve()
    if (root / "backend" / "static" / "index.html").exists():
        return root
    internal = root / "_internal"
    if (internal / "backend" / "static" / "index.html").exists():
        return internal
    return root


def configure_portable_environment(root_dir: Path) -> None:
    root = portable_data_root(root_dir)
    os.environ.setdefault("KAOBUDDY_ROOT_DIR", str(root))
    os.environ.setdefault("KAOBUDDY_STATIC_DIR", str(root / "backend" / "static"))
    os.environ.setdefault("KAOBUDDY_DIST_DIR", str(root / "dist"))
    os.environ.setdefault("KAOBUDDY_PUBLIC_DIR", str(root / "public"))


def first_available_port(preferred: int = 8000) -> int:
    for port in range(preferred, preferred + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise RuntimeError("没有找到可用端口，请关闭占用 8000 附近端口的程序后重试。")


def open_browser_after_start(url: str, delay_seconds: float = 1.0) -> None:
    def _open() -> None:
        time.sleep(delay_seconds)
        webbrowser.open(url)

    threading.Thread(target=_open, daemon=True).start()


def main() -> None:
    root = bundle_root()
    configure_portable_environment(root)
    port = first_available_port()
    url = f"http://127.0.0.1:{port}"
    print(f"KaoBuddy 正在启动：{url}")
    print("关闭这个窗口就会停止 KaoBuddy。")
    open_browser_after_start(url)

    import uvicorn
    from backend.app.main import app

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="info",
        loop="asyncio",
        http="h11",
    )
