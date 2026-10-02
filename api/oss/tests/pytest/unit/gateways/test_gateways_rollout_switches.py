"""`llm-gateway-rollout`: with the plane on, only listed organizations are served.

An organization outside the rollout is refused with `llm_gateway_disabled` on every LLM
surface, the code the agent SDK reads as "resolve from the vault", so neither the SDK nor
the runner needs a setting of its own.
"""

import json
from typing import Any, Dict
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from oss.src.apis.fastapi.gateways import credentials_router, flags
from oss.src.apis.fastapi.gateways.credentials_router import GatewayCredentialsRouter
from oss.src.apis.fastapi.gateways.flags import llm_gateway_serves_caller
from oss.src.apis.fastapi.gateways.llms import proxy as llm_proxy
from oss.src.apis.fastapi.gateways.llms.proxy import LLMGatewayProxy
from oss.src.apis.fastapi.gateways.llms import router as llm_router
from oss.src.apis.fastapi.gateways.llms.router import LLMGatewayRouter
from oss.src.core.gateways.llms.dtos import LLMGatewayConnectionResolution
from oss.src.core.rollout import switches
from oss.src.utils.context import AuthScope
from oss.src.utils.env import env

IN_ROLLOUT = AuthScope(
    organization_id=uuid4(), workspace_id=uuid4(), project_id=uuid4(), user_id=uuid4()
)
OUTSIDE = AuthScope(
    organization_id=uuid4(), workspace_id=uuid4(), project_id=uuid4(), user_id=uuid4()
)


@pytest.fixture
def caller(monkeypatch):
    """Restore the real per-organization gate, publish a payload naming one organization,
    and make the request come from the scope a test picks."""
    monkeypatch.setattr(flags, "llm_gateway_serves_caller", llm_gateway_serves_caller)
    monkeypatch.setattr(
        llm_proxy, "llm_gateway_serves_caller", llm_gateway_serves_caller
    )
    monkeypatch.setattr(env.posthog, "api_key_configured", True)

    async def _payload(flag):
        assert flag == switches.LLM_GATEWAY_ROLLOUT_FLAG
        return [str(IN_ROLLOUT.organization_id)]

    monkeypatch.setattr(switches, "_flag_payload", _payload)

    def _as(scope: AuthScope) -> None:
        for module in (flags, llm_proxy, credentials_router, llm_router):
            monkeypatch.setattr(module, "get_auth_scope", lambda: scope)

    return _as


class _Service:
    def __init__(self) -> None:
        self.calls = 0

    async def resolve_agent_connection(self, **kwargs):
        self.calls += 1
        return LLMGatewayConnectionResolution(
            namespace="custom",
            name="acme-openai",
            provider_key="openai",
            deployment_kind="custom",
            model="gpt-4o",
        )


class _Unreachable:
    def __getattr__(self, name):
        raise AssertionError(f"the service was called ({name}) outside the rollout")


def _resolve(service) -> Any:
    app = FastAPI()
    app.include_router(LLMGatewayRouter(llm_gateway_service=service).router)
    return TestClient(app).post("/resolve", json={"model": "gpt-4o"})


def _asgi_request(body: bytes) -> Request:
    async def receive() -> Dict[str, Any]:
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(
        {"type": "http", "method": "POST", "path": "/", "headers": []}, receive
    )


def test_resolve_serves_an_organization_in_the_rollout(caller, monkeypatch):
    caller(IN_ROLLOUT)

    async def _allowed(**_kwargs):
        return True

    monkeypatch.setattr(llm_router, "check_action_access", _allowed)
    service = _Service()

    response = _resolve(service)

    assert response.status_code == 200
    assert service.calls == 1


def test_resolve_refuses_an_organization_outside_it_as_a_disabled_plane(caller):
    caller(OUTSIDE)

    response = _resolve(_Unreachable())

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "llm_gateway_disabled"


async def test_the_relay_refuses_an_organization_outside_the_rollout(caller):
    caller(OUTSIDE)
    proxy = LLMGatewayProxy(llm_gateway_service=_Unreachable())

    response = await proxy.chat_completions_builtin(
        _asgi_request(json.dumps({"model": "gpt-4o", "messages": []}).encode()),
        "mock",
    )

    assert response.status_code == 403
    assert json.loads(bytes(response.body))["error"]["code"] == "llm_gateway_disabled"


async def test_the_model_listing_refuses_an_organization_outside_the_rollout(caller):
    caller(OUTSIDE)
    proxy = LLMGatewayProxy(llm_gateway_service=_Unreachable())

    response = await proxy.list_models_builtin("mock")

    assert response.status_code == 403


def test_no_llm_gateway_credential_is_minted_outside_the_rollout(caller):
    caller(OUTSIDE)
    app = FastAPI()
    app.include_router(GatewayCredentialsRouter().router)

    response = TestClient(app).post("/credentials", json={"plane": "llm"})

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "llm_gateway_disabled"


def test_the_master_switch_off_refuses_even_a_listed_organization(caller, monkeypatch):
    caller(IN_ROLLOUT)
    monkeypatch.setattr(env.llm_gateway, "enabled", False)

    response = _resolve(_Unreachable())

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "llm_gateway_disabled"
