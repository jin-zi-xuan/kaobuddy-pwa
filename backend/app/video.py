import json
import re
from html import unescape
from typing import Any, Dict, List, Tuple

import httpx

from .schemas import VideoImportResponse
from .outbound import SafeOutboundTransport


DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    ),
    "Referer": "https://www.bilibili.com/",
}


def _extract_meta(html: str, property_name: str) -> str:
    patterns = [
        rf'<meta\s+property="{re.escape(property_name)}"\s+content="([^"]*)"',
        rf'<meta\s+name="{re.escape(property_name)}"\s+content="([^"]*)"',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.I)
        if match:
            return unescape(match.group(1)).strip()
    return ""


def _extract_initial_state(html: str) -> Dict[str, Any]:
    match = re.search(r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\});\s*\(function", html, re.S)
    if not match:
        return {}
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return {}


def _find_subtitle_urls(value: Any) -> List[str]:
    urls: List[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {"subtitle_url", "url"} and isinstance(child, str) and child:
                urls.append(child)
            else:
                urls.extend(_find_subtitle_urls(child))
    elif isinstance(value, list):
        for child in value:
            urls.extend(_find_subtitle_urls(child))
    return urls


async def _fetch_subtitle(url: str) -> Tuple[str, str]:
    normalized = url if url.startswith("http") else f"https:{url}"
    async with httpx.AsyncClient(
        timeout=20, headers=DEFAULT_HEADERS, transport=SafeOutboundTransport(),
        trust_env=False, follow_redirects=True,
    ) as client:
        response = await client.get(normalized)
        response.raise_for_status()
    data = response.json()
    body = data.get("body", [])
    lines = [item.get("content", "").strip() for item in body if isinstance(item, dict)]
    return "\n".join(line for line in lines if line), normalized


async def import_video_metadata(url: str) -> VideoImportResponse:
    warnings: List[str] = []
    metadata: Dict[str, Any] = {}

    async with httpx.AsyncClient(
        timeout=20, headers=DEFAULT_HEADERS, transport=SafeOutboundTransport(),
        trust_env=False, follow_redirects=True,
    ) as client:
        response = await client.get(url)
        response.raise_for_status()
    html = response.text

    title_match = re.search(r"<title>(.*?)</title>", html, re.S)
    title = _extract_meta(html, "og:title")
    if not title and title_match:
        title = re.sub(r"\s+", " ", title_match.group(1)).strip()
    if not title:
        title = "未识别标题"
    description = _extract_meta(html, "description") or _extract_meta(html, "og:description")
    state = _extract_initial_state(html)
    subtitle_urls = list(dict.fromkeys(_find_subtitle_urls(state)))

    subtitles = ""
    if subtitle_urls:
        for subtitle_url in subtitle_urls[:3]:
            try:
                subtitles, used_url = await _fetch_subtitle(subtitle_url)
                if subtitles:
                    metadata["subtitle_url"] = used_url
                    break
            except (httpx.HTTPError, ValueError, json.JSONDecodeError):
                continue

    if not subtitles:
        warnings.append("没有抓到公开字幕。可以手动粘贴字幕或课程重点，系统一样能入库。")
    if "bilibili.com" in url and not subtitle_urls:
        warnings.append("B站部分视频需要登录、Cookie 或作者开启字幕才有公开字幕。第一版不下载视频。")

    return VideoImportResponse(
        title=title,
        description=description,
        subtitles=subtitles,
        source_url=url,
        warnings=warnings,
        metadata=metadata,
    )
