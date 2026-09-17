"""外部请求统一校验；只向本次校验过的 IP 建连，避免 DNS 重绑定。"""
from __future__ import annotations

import asyncio
import ipaddress
import os
import socket

import httpx


class UnsafeOutboundURL(httpx.RequestError):
    """地址不符合服务端出站策略。"""


class SafeOutboundTransport(httpx.AsyncBaseTransport):
    def __init__(self, *, allow_private: bool = False, transport=None):
        self.allow_private = allow_private
        self._transport = transport
        self._origin_transports = {}

    def _allowed(self, address: str) -> bool:
        ip = ipaddress.ip_address(address)
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        if ip.is_multicast or ip.is_unspecified or ip.is_link_local:
            return False
        if self.allow_private and (ip.is_loopback or (ip.is_private and not ip.is_reserved)):
            return True
        return ip.is_global and not ip.is_reserved and not ip.is_loopback

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        url = request.url
        if url.scheme not in {"http", "https"} or not url.host or url.userinfo or "%" in url.host:
            raise UnsafeOutboundURL("请求地址不安全：仅支持不含账号信息的 HTTP/HTTPS 地址。", request=request)
        try:
            literal = ipaddress.ip_address(url.host)
        except ValueError:
            literal = None
        if literal is not None:
            addresses = [str(literal)]
        else:
            try:
                results = await asyncio.get_running_loop().getaddrinfo(
                    url.host, url.port or (443 if url.scheme == "https" else 80),
                    type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP,
                )
                addresses = list(dict.fromkeys(result[4][0] for result in results))
            except OSError as exc:
                raise UnsafeOutboundURL("请求地址解析失败，请检查域名。", request=request) from exc
        if not addresses or not all(self._allowed(address) for address in addresses):
            raise UnsafeOutboundURL("请求地址不安全：不能访问本机、内网或其他非公开网络地址。", request=request)

        # Host 和 TLS SNI 仍使用原域名，底层仅接收已经校验过的数字 IP。
        headers = request.headers.copy()
        host = f"[{url.host}]" if ":" in url.host else url.host
        headers["Host"] = f"{host}:{url.port}" if url.port else host
        extensions = {**request.extensions, "sni_hostname": url.host}
        pinned = httpx.Request(
            request.method, url.copy_with(host=addresses[0]), headers=headers,
            stream=request.stream, extensions=extensions,
        )
        # 同一个 IP 上的不同域名也不能复用 TLS 连接，否则会跳过新域名证书校验。
        transport = self._transport
        if transport is None:
            origin = (url.scheme, url.host, url.port)
            if origin not in self._origin_transports:
                self._origin_transports[origin] = httpx.AsyncHTTPTransport(trust_env=False)
            transport = self._origin_transports[origin]
        response = await transport.handle_async_request(pinned)
        response.request = request
        return response

    async def aclose(self) -> None:
        if self._transport is not None:
            await self._transport.aclose()
        for transport in self._origin_transports.values():
            await transport.aclose()


def ai_transport() -> SafeOutboundTransport:
    # 这个例外只由 AI 客户端启用；视频和字幕不读取该开关。
    return SafeOutboundTransport(allow_private=os.getenv("KAOBUDDY_ALLOW_PRIVATE_AI") == "1")
