"""A one-off DNS failure on the way to Composio must not fail the call.

Each test runs the adapter's real HTTP client against a local server, with name lookup
for the Composio host failing once the way glibc reports it in a container
(``[Errno -5] No address associated with hostname``). A failed connect sends nothing, so
the client can try again without repeating a write.
"""

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterator, List

import pytest

from oss.src.core.gateway.catalog.providers.composio.adapter import (
    ComposioCatalogAdapter,
)
from oss.src.core.gateway.connections.dtos import ConnectionRequest
from oss.src.core.gateway.connections.providers.composio.adapter import (
    ComposioConnectionsAdapter,
)
from oss.src.core.tools.providers.composio.adapter import ComposioToolsAdapter
from oss.src.core.triggers.providers.composio.adapter import ComposioTriggersAdapter

_HOST = "composio.flaky-dns.test"

_NO_AUTH_FACEBOOK = {
    "slug": "facebook",
    "auth_config_details": [{"name": "Facebook", "mode": "NO_AUTH"}],
}


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps(_NO_AUTH_FACEBOOK).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


@pytest.fixture
def composio_url() -> Iterator[str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://{_HOST}:{server.server_address[1]}/api/v3.1"
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture
def dns_fails_once(monkeypatch) -> List[str]:
    real_getaddrinfo = socket.getaddrinfo
    lookups: List[str] = []

    def _getaddrinfo(host, port, *args, **kwargs):
        if isinstance(host, bytes):
            host = host.decode("idna")
        if host != _HOST:
            return real_getaddrinfo(host, port, *args, **kwargs)
        lookups.append(host)
        if len(lookups) == 1:
            raise socket.gaierror(-5, "No address associated with hostname")
        return real_getaddrinfo("127.0.0.1", port, *args, **kwargs)

    monkeypatch.setattr(socket, "getaddrinfo", _getaddrinfo)
    return lookups


@pytest.mark.asyncio
async def test_connect_survives_one_dns_failure(composio_url, dns_fails_once):
    adapter = ComposioConnectionsAdapter(api_key="k", api_url=composio_url)
    try:
        response = await adapter.initiate_connection(
            request=ConnectionRequest(
                user_id="u",
                integration_key="facebook",
                auth_scheme="oauth",
            )
        )
    finally:
        await adapter.close()

    assert response.connection_data == {"no_auth": True}
    assert dns_fails_once == [_HOST, _HOST]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "adapter_cls",
    [
        ComposioConnectionsAdapter,
        ComposioToolsAdapter,
        ComposioCatalogAdapter,
        ComposioTriggersAdapter,
    ],
)
async def test_every_composio_client_survives_one_dns_failure(
    adapter_cls, composio_url, dns_fails_once
):
    adapter = adapter_cls(api_key="k", api_url=composio_url)
    try:
        resp = await adapter._client.get(f"{adapter.api_url}/toolkits/facebook")
    finally:
        await adapter.close()

    assert resp.json() == _NO_AUTH_FACEBOOK
    assert dns_fails_once == [_HOST, _HOST]


def test_no_composio_adapter_builds_its_own_client():
    src = Path(__file__).resolve().parents[4] / "src"
    shared = src / "core/gateway/providers/composio/client.py"
    offenders = [
        str(path.relative_to(src))
        for path in src.glob("**/providers/composio/*.py")
        if path != shared and "httpx.AsyncClient(" in path.read_text()
    ]
    assert offenders == []
