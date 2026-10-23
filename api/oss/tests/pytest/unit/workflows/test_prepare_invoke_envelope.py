"""The invoke prelude signs the caller's run envelope into the run credential."""

import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from jwt import decode

import oss.src.core.workflows.service as workflows_service_module
from oss.src.core.access.principals import envelope_from_claims
from oss.src.core.workflows.service import WorkflowsService
from oss.src.middlewares import auth as auth_module
from oss.tests.pytest.utils.principals import make_envelope

SECRET_KEY = "unit-test-secret-key-with-32-bytes"


@pytest.fixture
def prelude(monkeypatch):
    project_id, organization_id = uuid4(), uuid4()
    monkeypatch.setattr(auth_module, "_SECRET_KEY", SECRET_KEY)
    monkeypatch.setattr(
        workflows_service_module,
        "get_project_by_id",
        AsyncMock(
            return_value=SimpleNamespace(
                workspace_id=uuid4(), organization_id=organization_id
            )
        ),
    )
    service = WorkflowsService(workflows_dao=AsyncMock())
    service._ensure_request_revision = AsyncMock()
    service._stamp_session_context = AsyncMock()
    service._get_revision_data = lambda request: SimpleNamespace(
        url="http://services/agent", uri=None
    )
    return SimpleNamespace(
        service=service, project_id=project_id, organization_id=organization_id
    )


def _claims(credentials: str) -> dict:
    return decode(
        jwt=credentials.removeprefix("Secret "),
        key=SECRET_KEY,
        algorithms=["HS256"],
        options={"verify_aud": False},
    )


def _envelope_of(credentials: str):
    claims = _claims(credentials)
    keys = ("principal", "restrictions", "authority", "run", "sender", "approved_by")
    return envelope_from_claims(claims={k: claims[k] for k in keys if k in claims})


async def test_prepare_invoke_writes_claims_and_run_id(prelude):
    envelope = make_envelope(
        project_id=prelude.project_id, organization_id=prelude.organization_id
    )
    credentials, _ = await prelude.service._prepare_invoke(
        project_id=prelude.project_id,
        user_id=envelope.authority.principal.id,
        request=SimpleNamespace(meta={"run_id": "turn-7"}),
        envelope=envelope,
    )
    signed = _envelope_of(credentials)
    assert signed.authority == envelope.authority
    assert signed.sender == envelope.sender
    assert signed.context.run_id == "turn-7"
    assert signed.context.origin == envelope.context.origin


async def test_prepare_invoke_under_key_carries_api_key(prelude):
    envelope = make_envelope(
        kind="api_key",
        origin="api",
        origin_id="key-1",
        sender=None,
        project_id=prelude.project_id,
        organization_id=prelude.organization_id,
    )
    credentials, _ = await prelude.service._prepare_invoke(
        project_id=prelude.project_id,
        user_id=uuid4(),
        request=SimpleNamespace(meta=None),
        envelope=envelope,
    )
    signed = _envelope_of(credentials)
    assert signed.authority.principal.kind.value == "api_key"
    assert signed.context.origin_id == "key-1" and signed.sender is None


async def test_an_envelope_of_another_project_is_refused_at_mint(prelude):
    with pytest.raises(ValueError):
        await prelude.service._prepare_invoke(
            project_id=prelude.project_id,
            user_id=uuid4(),
            request=SimpleNamespace(meta=None),
            envelope=make_envelope(),  # another project and organization
        )


@pytest.mark.parametrize(
    "fn",
    [
        WorkflowsService._prepare_invoke,
        WorkflowsService.invoke_workflow,
        WorkflowsService.invoke_workflow_detached,
        auth_module.sign_secret_token,
    ],
)
def test_envelope_is_a_required_keyword(fn):
    parameter = inspect.signature(fn).parameters["envelope"]
    assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
    assert parameter.default is inspect.Parameter.empty


def test_inspect_workflow_is_gone():
    assert not hasattr(WorkflowsService, "inspect_workflow")
