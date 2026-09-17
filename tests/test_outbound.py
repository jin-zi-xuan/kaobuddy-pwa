import asyncio
import socket
from contextlib import asynccontextmanager

import httpx
import pytest

from backend.app import ai_client, video
from backend.app.schemas import ApiConfig, ChatMessage


def transport_class():
    from backend.app import outbound
    return outbound.SafeOutboundTransport


def mock_dns(monkeypatch, addresses):
    calls = []
    async def resolve(self, host, port, **kwargs):
        calls.append(host)
        return [(socket.AF_INET6 if ':' in address else socket.AF_INET, socket.SOCK_STREAM,
                 socket.IPPROTO_TCP, '', (address, port)) for address in addresses]
    monkeypatch.setattr(asyncio.BaseEventLoop, 'getaddrinfo', resolve)
    return calls


@pytest.mark.parametrize('url', [
    'http://127.0.0.1/a', 'http://10.0.0.1', 'http://169.254.169.254',
    'http://192.168.1.1', 'http://[::1]', 'http://[::ffff:127.0.0.1]',
    'http://100.64.0.1', 'http://0.0.0.0', 'http://224.0.0.1',
    'http://240.0.0.1', 'http://user:password@93.184.216.34', 'ftp://93.184.216.34',
])
async def test_unsafe_urls_never_reach_network(url):
    sent = []
    transport = transport_class()(transport=httpx.MockTransport(lambda request: sent.append(request)))
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(httpx.HTTPError, match='地址'):
            await client.get(url)
    assert not sent


async def test_public_dns_is_pinned_and_preserves_host_sni(monkeypatch):
    calls = mock_dns(monkeypatch, ['93.184.216.34'])
    sent = []
    def handler(request):
        sent.append(request)
        return httpx.Response(200, text='ok')
    transport = transport_class()(transport=httpx.MockTransport(handler))
    async with httpx.AsyncClient(transport=transport) as client:
        response = await client.get('https://public.example:8443/path?q=1')
    assert calls == ['public.example']
    assert str(sent[0].url) == 'https://93.184.216.34:8443/path?q=1'
    assert sent[0].headers['host'] == 'public.example:8443'
    assert sent[0].extensions['sni_hostname'] == 'public.example'
    assert str(response.request.url) == 'https://public.example:8443/path?q=1'


async def test_mixed_public_private_dns_is_rejected(monkeypatch):
    mock_dns(monkeypatch, ['93.184.216.34', '10.1.1.1'])
    transport = transport_class()(transport=httpx.MockTransport(lambda request: pytest.fail('不能发送请求')))
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(httpx.HTTPError, match='地址'):
            await client.get('https://public.example')


@pytest.mark.parametrize('destination', ['http://127.0.0.1/secret', 'https://private.example/secret'])
async def test_redirect_destination_is_validated(monkeypatch, destination):
    mock_dns(monkeypatch, ['10.0.0.1'])
    sent = []
    def handler(request):
        sent.append(request)
        return httpx.Response(302, headers={'location': destination})
    transport = transport_class()(transport=httpx.MockTransport(handler))
    async with httpx.AsyncClient(transport=transport, follow_redirects=True) as client:
        with pytest.raises(httpx.HTTPError, match='地址'):
            await client.get('https://93.184.216.34/start')
    assert len(sent) == 1


async def test_private_ai_requires_opt_in_but_video_never_allows_it(monkeypatch):
    mock_dns(monkeypatch, ['127.0.0.1'])
    sent = []
    def handler(request):
        sent.append(request)
        return httpx.Response(200, json={'choices': [{'message': {'content': 'ok'}}]})
    monkeypatch.setattr(httpx, 'AsyncHTTPTransport', lambda **kwargs: httpx.MockTransport(handler))
    config = ApiConfig(provider_name='Local', base_url='http://localhost:11434/v1', api_key='test', model='test')
    monkeypatch.delenv('KAOBUDDY_ALLOW_PRIVATE_AI', raising=False)
    with pytest.raises(ai_client.AiClientError, match='地址'):
        await ai_client.chat_completion(config, [])
    assert not sent
    monkeypatch.setenv('KAOBUDDY_ALLOW_PRIVATE_AI', '1')
    assert await ai_client.chat_completion(config, []) == 'ok'
    with pytest.raises(httpx.HTTPError, match='地址'):
        await video.import_video_metadata('http://localhost/video')
    with pytest.raises(httpx.HTTPError, match='地址'):
        await video._fetch_subtitle('//localhost/subtitle')
    assert len(sent) == 1


async def test_malformed_sse_is_skipped_without_breaking_stream(monkeypatch):
    class FakeClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        @asynccontextmanager
        async def stream(self, *args, **kwargs):
            yield httpx.Response(200, request=httpx.Request('POST', 'https://example.com'),
                text='data: invalid json\n\ndata: {"choices":[{"delta":{"content":"继续"}}]}\n\ndata: [DONE]\n')
    monkeypatch.setattr(httpx, 'AsyncClient', FakeClient)
    config = ApiConfig(provider_name='test', base_url='https://example.com', api_key='test', model='test')
    assert [chunk async for chunk in ai_client.chat_completion_stream(config, [ChatMessage(role='user', content='hi')])] == ['继续']


async def test_shared_ip_different_tls_hosts_use_separate_pools(monkeypatch):
    mock_dns(monkeypatch, ['93.184.216.34'])
    pools = []
    def make_transport(**kwargs):
        requests = []
        pools.append(requests)
        def handler(request):
            requests.append(request)
            return httpx.Response(200)
        return httpx.MockTransport(handler)
    monkeypatch.setattr(httpx, 'AsyncHTTPTransport', make_transport)
    async with httpx.AsyncClient(transport=transport_class()()) as client:
        await client.get('https://first.example')
        await client.get('https://second.example')
    assert len(pools) == 2
    assert [requests[0].extensions['sni_hostname'] for requests in pools] == ['first.example', 'second.example']


async def test_public_redirect_preserves_relative_path_and_strips_cross_host_auth(monkeypatch):
    mock_dns(monkeypatch, ['93.184.216.34'])
    sent = []
    def handler(request):
        sent.append(request)
        if len(sent) == 1:
            return httpx.Response(302, headers={'location': '/next'})
        if len(sent) == 2:
            return httpx.Response(302, headers={'location': 'https://second.example/end'})
        return httpx.Response(200)
    async with httpx.AsyncClient(transport=transport_class()(transport=httpx.MockTransport(handler)), follow_redirects=True) as client:
        response = await client.get('https://first.example/start', headers={'Authorization': 'Bearer test'})
    assert response.status_code == 200
    assert sent[1].url.path == '/next'
    assert sent[1].headers['host'] == 'first.example'
    assert 'authorization' not in sent[2].headers


async def test_stream_also_rejects_private_ai_by_default(monkeypatch):
    monkeypatch.delenv('KAOBUDDY_ALLOW_PRIVATE_AI', raising=False)
    monkeypatch.setattr(httpx, 'AsyncHTTPTransport', lambda **kwargs: httpx.MockTransport(lambda request: pytest.fail('不能发送请求')))
    config = ApiConfig(provider_name='test', base_url='http://127.0.0.1/v1', api_key='test', model='test')
    with pytest.raises(ai_client.AiClientError, match='地址'):
        _ = [chunk async for chunk in ai_client.chat_completion_stream(config, [])]


def test_csp_permits_pdf_wasm_but_not_javascript_eval_or_inline_scripts():
    from fastapi.testclient import TestClient
    from backend.app.main import app
    with TestClient(app) as client:
        policy = client.get('/health').headers['content-security-policy']
    directives = {parts[0]: parts[1:] for part in policy.split(';') if (parts := part.strip().split())}
    assert directives['script-src'] == ["'self'", "'wasm-unsafe-eval'"]
    assert directives['object-src'] == ["'none'"]
    assert directives['base-uri'] == ["'self'"]
