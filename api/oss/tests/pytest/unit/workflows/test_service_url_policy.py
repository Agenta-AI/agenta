"""The workflow service URL policy.

A revision's ``url`` is tenant data. Only a URL under the operator's ``AGENTA_SERVICES_URL``
may receive the ``secret-resolve`` grant or be dialled without the gateway egress check, and
no service call follows a redirect.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
import pytest
from oss.src.core.gateways.egress import EgressRefusedError
from oss.src.core.tools.platform_handlers import _invoke_child_workflow
from oss.src.core.workflows import service as workflows_service_module
from oss.src.core.workflows.dtos import WorkflowServiceRequest
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.workflows.types import (
    WorkflowDetachedStartNeverSent,
    invoke_never_dispatched,
)
from oss.src.middlewares.auth import SECRET_RESOLVE_GRANT
from oss.tests.pytest.utils.principals import make_envelope

_SERVICES_URL = "https://agenta.example.com/services"


@pytest.fixture(autouse=True)
def _services_url(monkeypatch):
    monkeypatch.setattr(
        workflows_service_module.env.agenta, "services_url", _SERVICES_URL
    )


@pytest.mark.parametrize(
    "url",
    [
        "https://agenta.example.com/services",
        "https://agenta.example.com/services/agent/v0",
        "https://agenta.example.com/services/agent/v0/invoke",
        "https://AGENTA.example.com:443/services/agent/v0",
    ],
)
def test_urls_under_the_services_url_are_platform(url):
    assert WorkflowsService._is_platform_service_url(url)


@pytest.mark.parametrize(
    "url",
    [
        None,
        "",
        "https://other.example/invoke",
        "http://169.254.169.254/invoke",
        "http://agenta.example.com/services/agent/v0",
        "https://agenta.example.com:8443/services/agent/v0",
        "https://agenta.example.com/api/workflows",
        "https://agenta.example.com/servicesX/agent",
        "https://agenta.example.com/services/../api/workflows",
        "https://agenta.example.com/services/%2e%2e/api",
        "https://agenta.example.com@other.example/services/agent",
        "https://user:pass@agenta.example.com/services/agent",
        "https://agenta.example.com.other.example/services/agent",
    ],
)
def test_other_urls_are_tenant_destinations(url):
    assert not WorkflowsService._is_platform_service_url(url)


def test_only_the_platform_receives_the_secret_resolve_grant():
    assert WorkflowsService._service_grants(f"{_SERVICES_URL}/agent/v0") == [
        SECRET_RESOLVE_GRANT
    ]
    assert WorkflowsService._service_grants("https://other.example") is None
    assert WorkflowsService._service_grants(None) is None


async def _prepared_grants(monkeypatch, *, revision_url):
    signed = {}

    async def sign(**kwargs):
        signed.update(kwargs)
        return "tok"

    monkeypatch.setattr(workflows_service_module, "sign_secret_token", sign)
    monkeypatch.setattr(
        workflows_service_module,
        "get_project_by_id",
        AsyncMock(
            return_value=SimpleNamespace(workspace_id=uuid4(), organization_id=uuid4())
        ),
    )

    service = WorkflowsService(workflows_dao=AsyncMock())
    service._ensure_request_revision = AsyncMock()
    service._stamp_session_context = AsyncMock()
    service._get_revision_data = lambda request: SimpleNamespace(
        url=revision_url, uri=None
    )

    credentials, service_url = await service._prepare_invoke(
        project_id=uuid4(),
        user_id=uuid4(),
        request=SimpleNamespace(meta=None),
        envelope=make_envelope(),
    )

    assert credentials == "Secret tok"
    assert service_url == revision_url
    return signed["grants"]


async def test_a_tenant_url_gets_a_credential_without_the_grant(monkeypatch):
    grants = await _prepared_grants(
        monkeypatch, revision_url="https://other.example/agent"
    )
    assert grants is None


async def test_the_services_url_gets_the_grant(monkeypatch):
    grants = await _prepared_grants(
        monkeypatch, revision_url=f"{_SERVICES_URL}/agent/v0"
    )
    assert grants == [SECRET_RESOLVE_GRANT]


def _through(transport):
    real_client = httpx.AsyncClient

    def build(*args, **kwargs):
        return real_client(*args, transport=transport, **kwargs)

    return patch("httpx.AsyncClient", build)


@pytest.mark.parametrize(
    "url",
    [
        "https://169.254.169.254/invoke",
        "https://127.0.0.1/invoke",
        "https://10.0.0.5/invoke",
        "https://172.17.0.1/invoke",
        "https://192.168.1.10/invoke",
        "https://100.64.0.1/invoke",
        "https://0.0.0.0/invoke",
        "https://[::1]/invoke",
        "https://[fd00:ec2::254]/invoke",
        "https://[fe80::1]/invoke",
        "https://[::ffff:127.0.0.1]/invoke",
        "https://[::ffff:169.254.169.254]/invoke",
        "https://localhost/invoke",
        "http://203.0.113.10/invoke",
        "ftp://203.0.113.10/invoke",
    ],
)
async def test_a_tenant_url_to_a_blocked_target_is_never_dialled(monkeypatch, url):
    monkeypatch.setattr(
        "oss.src.core.gateways.egress.env.gateway_egress.insecure_allowed", False
    )
    hops = []

    def handle(request):
        hops.append(str(request.url))
        return httpx.Response(200, json={})

    with _through(httpx.MockTransport(handle)), pytest.raises(EgressRefusedError):
        await WorkflowsService._post_service_json(
            url=url,
            credentials="Secret tok",
            payload={},
        )

    assert hops == []


async def test_a_platform_call_does_not_follow_a_redirect():
    hops = []

    def handle(request):
        hops.append(str(request.url))
        return httpx.Response(
            302, headers={"location": "https://other.example/collect"}
        )

    with _through(httpx.MockTransport(handle)):
        response, _ = await WorkflowsService._post_service_json(
            url=f"{_SERVICES_URL}/agent/v0/invoke",
            credentials="Secret tok",
            payload={},
        )

    assert response.status_code == 302
    assert hops == [f"{_SERVICES_URL}/agent/v0/invoke"]


async def test_a_refused_detached_start_is_never_sent(monkeypatch):
    """A refused URL sends nothing, so a caller holding a dispatch claim may release it."""
    monkeypatch.setattr(
        "oss.src.core.gateways.egress.env.gateway_egress.insecure_allowed", False
    )
    hops = []

    def handle(request):
        hops.append(str(request.url))
        return httpx.Response(200, json={})

    with _through(httpx.MockTransport(handle)):
        with pytest.raises(WorkflowDetachedStartNeverSent) as raised:
            await WorkflowsService(workflows_dao=AsyncMock())._stream_service_started(
                url="https://127.0.0.1/invoke",
                credentials="Secret tok",
                payload={},
                run_id="run-x",
            )

    assert invoke_never_dispatched(raised.value)
    assert hops == []


async def test_a_refused_child_invoke_answers_400_without_dialling(monkeypatch):
    monkeypatch.setattr(
        "oss.src.core.gateways.egress.env.gateway_egress.insecure_allowed", False
    )
    hops = []

    def handle(request):
        hops.append(str(request.url))
        return httpx.Response(200, json={})

    with _through(httpx.MockTransport(handle)):
        response = await _invoke_child_workflow(
            workflows_service=WorkflowsService(workflows_dao=AsyncMock()),
            service_url="https://10.0.0.5/agent/v0",
            credentials="Secret tok",
            request=WorkflowServiceRequest(),
            timeout_ms=1000,
        )

    assert response.status.code == 400
    assert hops == []
