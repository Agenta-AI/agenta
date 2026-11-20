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
    service._ensure_request_revision = AsyncMock(return_value=None)
    service._stamp_session_context = AsyncMock()
    service._get_revision_data = lambda request: SimpleNamespace(
        parameters=None, url="http://services/agent", uri=None
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


async def _prepare(prelude, *, envelope, user_id):
    credentials, _ = await prelude.service._prepare_invoke(
        project_id=prelude.project_id,
        user_id=user_id,
        request=SimpleNamespace(meta={}),
        envelope=envelope,
    )
    return _claims(credentials)


def _scoped(prelude, **kwargs):
    return make_envelope(
        project_id=prelude.project_id, organization_id=prelude.organization_id, **kwargs
    )


async def test_resumed_token_user_is_the_run_acting_user_not_the_approver(prelude):
    """Alice's run approved by Bob: the minted token's user is Alice (the principal's
    acting user), never Bob, so no route sees Alice's principal with Bob's id."""

    alice, bob = uuid4(), uuid4()
    claims = await _prepare(
        prelude,
        envelope=_scoped(prelude, kind="human", principal_id=alice),
        user_id=bob,
    )
    assert claims["user_id"] == str(alice)
    assert claims["principal"]["id"] == str(alice)


async def test_api_key_token_user_is_the_key_creator(prelude, _allowing_access_service):
    creator = uuid4()
    envelope = _scoped(
        prelude, kind="api_key", origin="api", origin_id="k", sender=None
    )
    _allowing_access_service.acting_users[envelope.authority.principal.id] = creator
    claims = await _prepare(prelude, envelope=envelope, user_id=uuid4())
    assert claims["user_id"] == str(creator)


async def test_inactive_principal_gets_no_token(prelude, monkeypatch):
    import oss.src.core.access.service as access_module
    from oss.src.core.access.types import MissingPrincipal
    from oss.tests.pytest.utils.principals import AllowingAccessService

    class _Inactive(AllowingAccessService):
        async def acting_user_id(self, *, authority):
            return None

    monkeypatch.setattr(access_module, "_access_service", _Inactive())
    with pytest.raises(MissingPrincipal):
        await _prepare(prelude, envelope=_scoped(prelude), user_id=uuid4())


async def test_prepare_invoke_writes_the_resolved_agent_never_the_callers(prelude):
    agent_id = uuid4()
    prelude.service._ensure_request_revision = AsyncMock(
        return_value=SimpleNamespace(workflow_id=agent_id)
    )
    envelope = make_envelope(
        project_id=prelude.project_id, organization_id=prelude.organization_id
    )
    credentials, _ = await prelude.service._prepare_invoke(
        project_id=prelude.project_id,
        user_id=envelope.authority.principal.id,
        request=SimpleNamespace(
            meta={"run_agent_id": str(uuid4())},
            references={"workflow": {"id": str(uuid4())}},
        ),
        envelope=envelope,
    )
    assert _claims(credentials)["run_agent_id"] == str(agent_id)


async def _claim_of(prelude, *, references, resolved):
    prelude.service.resolve_agent_artifact_id = resolved
    envelope = make_envelope(
        project_id=prelude.project_id, organization_id=prelude.organization_id
    )
    credentials, _ = await prelude.service._prepare_invoke(
        project_id=prelude.project_id,
        user_id=envelope.authority.principal.id,
        request=SimpleNamespace(meta=None, references=references),
        envelope=envelope,
    )
    return _claims(credentials).get("run_agent_id")


async def test_a_request_carrying_its_revision_names_the_agent_it_references(
    prelude, _allowing_access_service
):
    """A session the API starts sends its revision inline, so the prelude resolves
    nothing; the agent comes from the references, resolved in the project."""
    agent_id = uuid4()
    resolved = AsyncMock(return_value=agent_id)
    claim = await _claim_of(
        prelude,
        references={"workflow": {"slug": "quote"}},
        resolved=resolved,
    )
    assert claim == str(agent_id)
    elements = resolved.await_args.kwargs["references"]
    assert [(e.key, e.slug) for e in elements] == [("workflow", "quote")]
    decision = _allowing_access_service.decisions[-1]
    assert decision["resource"].id == str(agent_id)
    assert decision["action"].value == "run_workflows"


async def test_an_agent_the_principal_may_not_run_gets_no_claim(prelude, monkeypatch):
    import oss.src.core.access.service as access_module
    from oss.src.core.access.dtos import Decision, DecisionReason
    from oss.tests.pytest.utils.principals import AllowingAccessService

    class _Refusing(AllowingAccessService):
        async def decide(self, **kwargs):
            return Decision(allowed=False, reason=DecisionReason.RESOURCE_DENIED)

    monkeypatch.setattr(access_module, "_access_service", _Refusing())
    claim = await _claim_of(
        prelude,
        references={"workflow": {"id": str(uuid4())}},
        resolved=AsyncMock(return_value=uuid4()),
    )
    assert claim is None


async def test_an_unresolved_reference_or_an_inline_run_gets_no_claim(prelude):
    from oss.src.core.workflows.types import AgentReferenceUnresolved

    unresolved = await _claim_of(
        prelude,
        references={"workflow": {"id": str(uuid4())}},
        resolved=AsyncMock(side_effect=AgentReferenceUnresolved()),
    )
    inline = await _claim_of(
        prelude, references=None, resolved=AsyncMock(return_value=None)
    )
    assert unresolved is None
    assert inline is None
