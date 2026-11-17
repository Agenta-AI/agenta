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
