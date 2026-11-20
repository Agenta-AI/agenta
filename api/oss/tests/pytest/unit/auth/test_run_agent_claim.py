"""The `run_agent_id` claim: written at mint, read by `run_agent_id_of_request` only,
carried unchanged by the exchange."""

from uuid import UUID, uuid4

import pytest
from jwt import decode, encode
from starlette.requests import Request

from oss.src.middlewares import auth
from oss.tests.pytest.utils.principals import envelope_for_claims

SECRET_KEY = "unit-test-secret-key-with-32-bytes"
U = "00000000-0000-4000-8000-0000000000a1"
P = "00000000-0000-4000-8000-0000000000b2"
O = "00000000-0000-4000-8000-0000000000c3"  # noqa: E741


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/mounts/sign",
            "headers": [],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "root_path": "",
        }
    )


@pytest.fixture(autouse=True)
def signing_key(monkeypatch):
    monkeypatch.setattr(auth, "_SECRET_KEY", SECRET_KEY)


def _envelope():
    return envelope_for_claims(user_id=U, project_id=P, organization_id=O)


async def test_the_claim_survives_sign_and_verify():
    agent_id = uuid4()
    token = await auth.sign_secret_token(
        user_id=U,
        project_id=P,
        organization_id=O,
        envelope=_envelope(),
        run_agent_id=agent_id,
    )
    request = _request()
    await auth.verify_secret_token(request=request, secret_token=token)
    assert auth.run_agent_id_of_request(request) == agent_id


async def test_a_credential_without_the_claim_names_no_agent():
    token = await auth.sign_secret_token(
        user_id=U, project_id=P, organization_id=O, envelope=_envelope()
    )
    payload = decode(
        token, SECRET_KEY, algorithms=["HS256"], options={"verify_exp": False}
    )
    assert "run_agent_id" not in payload
    request = _request()
    await auth.verify_secret_token(request=request, secret_token=token)
    assert auth.run_agent_id_of_request(request) is None
    assert auth.run_agent_id_of_request(_request()) is None


async def test_a_malformed_claim_refuses_the_credential():
    token = await auth.sign_secret_token(
        user_id=U, project_id=P, organization_id=O, envelope=_envelope()
    )
    payload = decode(
        token, SECRET_KEY, algorithms=["HS256"], options={"verify_exp": False}
    )
    payload["run_agent_id"] = "not-an-id"
    forged = encode(payload, SECRET_KEY, algorithm="HS256")
    with pytest.raises(Exception):
        await auth.verify_secret_token(request=_request(), secret_token=forged)


def test_the_reader_ignores_a_value_that_is_not_a_uuid():
    request = _request()
    request.state.run_agent_id = "x"
    assert auth.run_agent_id_of_request(request) is None
    request.state.run_agent_id = UUID(int=3)
    assert auth.run_agent_id_of_request(request) == UUID(int=3)


# -- the permissions exchange ------------------------------------------------------------


class _Workflows:
    """Records what the exchange asks to resolve; answers `agent_id`."""

    def __init__(self, agent_id):
        self.agent_id = agent_id
        self.calls = []
        self.drive_calls = []

    async def resolve_run_agent_id(self, **kwargs):
        self.calls.append(kwargs)
        return self.agent_id

    async def ensure_static_agent_drive(self, **kwargs):
        # A first mint ensures a static agent's own drive; a no-op for these agents.
        self.drive_calls.append(kwargs)


async def _exchange(*, credential_kind, workflows, workflow_id, carried=None):
    from oss.src.apis.fastapi.access.router import AccessRouter
    from oss.src.core.access.context import reset_request_access, set_request_access
    from oss.tests.pytest.utils.principals import make_envelope, make_request_access

    envelope = make_envelope(kind="human")
    request = _request()
    request.state.run_agent_id = carried
    token = set_request_access(
        make_request_access(envelope=envelope, credential_kind=credential_kind)
    )
    try:
        return await AccessRouter(
            workflows_service=workflows
        )._run_agent_id_of_exchange(
            request, envelope=envelope, workflow_id=workflow_id
        ), envelope
    finally:
        reset_request_access(token)


async def test_a_first_mint_names_the_agent_the_api_resolved():
    """A turn the agent service runs for an API key or a browser session: the service
    names the agent, and the API resolves it in the project before the claim."""
    resolved, named = uuid4(), uuid4()
    workflows = _Workflows(resolved)
    claim, envelope = await _exchange(
        credential_kind="api_key", workflows=workflows, workflow_id=named
    )
    assert claim == resolved
    (call,) = workflows.calls
    assert call["references"] == {"workflow": {"id": str(named)}}
    assert call["project_id"] == envelope.authority.project_id
    # The first mint starts a run, so it ensures the agent's own drive (static agents).
    (drive,) = workflows.drive_calls
    assert drive["artifact_id"] == resolved


async def test_a_first_mint_without_an_agent_or_a_resolution_names_none():
    claim, _ = await _exchange(
        credential_kind="api_key", workflows=_Workflows(None), workflow_id=uuid4()
    )
    assert claim is None
    workflows = _Workflows(uuid4())
    claim, _ = await _exchange(
        credential_kind="bearer_session", workflows=workflows, workflow_id=None
    )
    assert claim is None
    assert workflows.calls == []


async def test_a_renewal_carries_its_claim_and_ignores_the_named_agent():
    carried = uuid4()
    workflows = _Workflows(uuid4())
    claim, _ = await _exchange(
        credential_kind="run_credential",
        workflows=workflows,
        workflow_id=uuid4(),
        carried=carried,
    )
    assert claim == carried
    assert workflows.calls == []
