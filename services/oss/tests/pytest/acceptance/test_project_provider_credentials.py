"""A completion runs on the project's own provider credentials, never on the deployment's.

Needs a stack whose services container has a provider key in its own environment that it
must not use, and a recorder endpoint on the stack network that logs the Authorization
header of every request it receives:

    AGENTA_TEST_SERVICES_ENV_OPENAI_KEY   the OPENAI_API_KEY value set on the services
                                          container (a dummy, never a real key)
    AGENTA_TEST_RECORDER_URL              the recorder's base URL as services reaches it,
                                          for example http://recorder:8000/v1
    AGENTA_TEST_RECORDER_LOG              the recorder's request log (JSON lines) as this
                                          process reads it

The services container must run with the env keys off (the EE default) and with
AGENTA_INSECURE_EGRESS_ALLOWED=true, so a plain-HTTP recorder on the stack network passes the
egress guard. The test is skipped when the variables are not set.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from uuid import uuid4

import pytest
import requests

from utils.constants import BASE_TIMEOUT

pytestmark = [pytest.mark.acceptance]

_ENV_KEY = os.getenv("AGENTA_TEST_SERVICES_ENV_OPENAI_KEY")
_RECORDER_URL = os.getenv("AGENTA_TEST_RECORDER_URL")
_RECORDER_LOG = os.getenv("AGENTA_TEST_RECORDER_LOG")


@pytest.fixture(autouse=True)
def _requires_recorder():
    if not (_ENV_KEY and _RECORDER_URL and _RECORDER_LOG):
        pytest.skip("recorder endpoint and services env key are not configured")


@pytest.fixture
def project(foo_account, ag_env):
    """A fresh account per test.

    Services caches a caller's secrets for a minute, so a provider saved by one test would
    stay invisible to the next test that ran as the same account.
    """
    credentials = foo_account["credentials"]
    project_id = foo_account["project_id"]

    def api(method: str, path: str, **kwargs):
        return requests.request(
            method,
            f"{ag_env['api_url']}{path}",
            headers={"Authorization": credentials},
            params={"project_id": project_id},
            timeout=BASE_TIMEOUT,
            **kwargs,
        )

    def services(method: str, path: str, **kwargs):
        return requests.request(
            method,
            f"{ag_env['services_url']}{path}",
            headers={"Authorization": credentials},
            timeout=120,
            **kwargs,
        )

    return api, services


def _recorded_authorizations() -> list:
    log = Path(_RECORDER_LOG)
    if not log.exists():
        return []
    return [
        json.loads(line).get("authorization")
        for line in log.read_text().splitlines()
        if line.strip()
    ]


def _completion_body(model: str) -> dict:
    return {
        "data": {
            "revision": {
                "data": {
                    "uri": "agenta:builtin:completion:v0",
                    "parameters": {
                        "prompt": {
                            "messages": [{"role": "user", "content": "Say hi."}],
                            "llm_config": {"model": model},
                        }
                    },
                }
            },
            "inputs": {},
        }
    }


def _save_custom_provider(api, *, slug: str, extras: dict) -> str:
    # Readable, so the services run sees the record even without a key. A write-only record
    # with no key is dropped from the run's secrets before resolution and never gets this far.
    response = api(
        "POST",
        "/secrets/",
        json={
            "header": {"name": slug},
            "write_only": False,
            "secret": {
                "kind": "custom_provider",
                "data": {
                    "kind": "openai",
                    "provider": {"url": _RECORDER_URL, "extras": extras},
                    "models": [{"slug": "gpt-4o"}],
                },
            },
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


class TestProjectProviderCredentials:
    def test_project_without_a_key_gets_a_clear_error(self, project):
        _, services = project
        response = services("POST", "/invoke", json=_completion_body("gpt-4o-mini"))

        assert response.status_code == 400, response.text
        message = response.json()["status"]["message"]
        assert "No API key found for model 'gpt-4o-mini'" in message
        assert "Settings > Providers & Models" in message
        assert _ENV_KEY not in response.text

    def test_custom_provider_without_a_key_never_receives_the_env_key(self, project):
        api, services = project
        slug = f"pkf-nokey-{uuid4().hex[:8]}"
        secret_id = _save_custom_provider(api, slug=slug, extras={})
        try:
            before = len(_recorded_authorizations())

            response = services(
                "POST", "/invoke", json=_completion_body(f"{slug}/openai/gpt-4o")
            )

            sent = _recorded_authorizations()[before:]
            assert sent == [], sent
            assert response.status_code == 400, response.text
            assert "an explicit API key for the custom provider" in response.text
            assert _ENV_KEY not in response.text
        finally:
            api("DELETE", f"/secrets/{secret_id}")

    def test_custom_provider_with_its_own_key_sends_that_key(self, project):
        api, services = project
        slug = f"pkf-key-{uuid4().hex[:8]}"
        own_key = f"sk-project-{uuid4().hex[:8]}"
        secret_id = _save_custom_provider(api, slug=slug, extras={"api_key": own_key})
        try:
            before = len(_recorded_authorizations())

            response = services(
                "POST", "/invoke", json=_completion_body(f"{slug}/openai/gpt-4o")
            )

            assert response.status_code == 200, response.text
            sent = _recorded_authorizations()[before:]
            assert sent == [f"Bearer {own_key}"], sent
        finally:
            api("DELETE", f"/secrets/{secret_id}")
