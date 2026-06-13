from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


@dataclass(frozen=True)
class RuntimePaths:
    root_dir: Path
    static_dir: Path
    dist_dir: Path
    public_dir: Path


def _path_from_env(env: Mapping[str, str], key: str, fallback: Path) -> Path:
    value = env.get(key, "").strip()
    return Path(value).resolve() if value else fallback.resolve()


def resolve_runtime_paths(env: Mapping[str, str] | None = None) -> RuntimePaths:
    current_env = env or os.environ
    default_root = Path(__file__).resolve().parents[2]
    root_dir = _path_from_env(current_env, "KAOBUDDY_ROOT_DIR", default_root)
    return RuntimePaths(
        root_dir=root_dir,
        static_dir=_path_from_env(current_env, "KAOBUDDY_STATIC_DIR", root_dir / "backend" / "static"),
        dist_dir=_path_from_env(current_env, "KAOBUDDY_DIST_DIR", root_dir / "dist"),
        public_dir=_path_from_env(current_env, "KAOBUDDY_PUBLIC_DIR", root_dir / "public"),
    )
