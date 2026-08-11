"""A malformed vault secret create must not echo the secret back.

FastAPI's validation error carries an `input` field holding the offending value. On these
routes that value IS the provider credential, so a malformed create put a real key into the
response body, the caller's terminal, and anything logging response bodies on that route. A
builder hit it live with an OpenAI key.

Pre-existing on main; not introduced by the agent-config-editing work.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.vault.router import SecretSafeRoute


CANARY = "sk-CANARY-DO-NOT-ECHO-abc123"


@pytest.fixture
def client():
    """A minimal app carrying the real route class over a body that must validate."""
    from pydantic import BaseModel, model_validator

    # A MODEL-level validator on purpose: that is what the real route has, and it is what
    # makes the leak. Pydantic reports the whole validated object as `input`, so the error
    # carries `data` (the credential) even though the offending field is `kind`. A
    # field-level validator would report only the bad field and would not reproduce this.
    class SecretPayload(BaseModel):
        kind: str
        data: dict

        @model_validator(mode="after")
        def _known_kind(self):
            if self.kind != "provider_key":
                raise ValueError("The provided kind is not a valid SecretKind enum")
            return self

    app = FastAPI()
    app.router.route_class = SecretSafeRoute

    @app.post("/secrets/")
    async def create(secret: SecretPayload):  # pragma: no cover - shape only
        return {"ok": True}

    return TestClient(app)


def _malformed():
    # The shape the route accepts, with a bad kind and a REAL key beside it. This is what
    # the builder sent: the request is wrong, the credential in it is not.
    return {"kind": "NOT_A_VALID_KIND", "data": {"provider": "openai", "key": CANARY}}


def test_a_malformed_create_does_not_echo_the_secret(client):
    response = client.post("/secrets/", json=_malformed())

    assert response.status_code == 422
    assert CANARY not in response.text, (
        "the submitted secret value came back in the validation error body"
    )


def test_the_caller_still_learns_which_field_was_wrong(client):
    # The echo is what goes; the diagnosis stays. A caller already knows what it sent, so
    # the location and the reason are everything it needs to correct the request.
    response = client.post("/secrets/", json=_malformed())
    detail = response.json()["detail"]

    assert detail, "the validation error lost its content along with the echo"
    first = detail[0]
    assert first["loc"]
    assert first["msg"]
    assert "input" not in first


def test_a_well_formed_request_is_unaffected(client):
    # Only the echo changed, not validation. A valid body still passes.
    response = client.post(
        "/secrets/",
        json={"kind": "provider_key", "data": {"provider": "openai"}},
    )

    assert response.status_code == 200
