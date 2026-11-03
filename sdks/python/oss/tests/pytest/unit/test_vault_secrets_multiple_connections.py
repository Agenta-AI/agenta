"""`get_secrets` must not collapse several connections of one provider family into one.

It used to key vault `provider_key` records by `data.kind`, so a project holding two OpenAI
keys reached the workflow with only the last one — which makes a named second connection
unresolvable no matter what the resolver does. Local (env-var) secrets are still keyed by
family, and a stored key for that family still shadows them.
"""

import pytest

from agenta.sdk.middlewares.running import vault


def _provider_key(slug: str, kind: str, key: str) -> dict:
    return {
        "kind": "provider_key",
        "slug": slug,
        "data": {"kind": kind, "provider": {"key": key}},
    }


def _custom_provider(slug: str) -> dict:
    return {
        "kind": "custom_provider",
        "slug": slug,
        "data": {"kind": "custom", "provider_slug": slug, "provider": {"extras": {}}},
    }


class _Response:
    status_code = 200

    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


@pytest.fixture
def fetch(monkeypatch):
    """Drive `get_secrets` with a canned `/secrets/` payload and a chosen env-var set."""

    async def _fetch(vault_payload, env=None):
        vault.invalidate_secrets_cache(None)

        env = env or {}
        monkeypatch.setattr(vault, "getenv", lambda name, *_: env.get(name))

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

            async def get(self, *_args, **_kwargs):
                return _Response(vault_payload)

        monkeypatch.setattr(vault.httpx, "AsyncClient", _Client)

        try:
            return await vault.get_secrets("http://api", None)
        finally:
            vault.invalidate_secrets_cache(None)

    return _fetch


async def test_two_connections_for_one_provider_both_survive(fetch):
    payload = [
        _provider_key("openai", "openai", "sk-first"),
        _provider_key("openai-2", "openai", "sk-second"),
    ]

    secrets, vault_secrets, _ = await fetch(payload)

    assert [s["slug"] for s in secrets] == ["openai", "openai-2"]
    assert [s["slug"] for s in vault_secrets] == ["openai", "openai-2"]


async def test_a_stored_key_still_shadows_the_env_var_for_its_family(fetch):
    payload = [_provider_key("openai", "openai", "sk-stored")]

    secrets, _, local_secrets = await fetch(
        payload, env={"OPENAI_API_KEY": "sk-from-env"}
    )

    keys = [s["data"]["provider"]["key"] for s in secrets]
    assert keys == ["sk-stored"]
    # The local secret is still reported separately for the `scope="local"` callers.
    assert local_secrets[0]["data"]["provider"]["key"] == "sk-from-env"


async def test_a_stored_key_shadows_an_env_var_that_spells_the_family_differently(
    fetch,
):
    """`MISTRALAI_API_KEY` and a stored `mistral` are one family, so the stored key wins.

    Compared raw, the env key survived the shadow filter and then took the resolver's tiebreak
    (locals come first in the combined list), so the env var beat the connection the user saved.
    """
    payload = [_provider_key("mistral", "mistral", "sk-stored")]

    secrets, _, _ = await fetch(payload, env={"MISTRALAI_API_KEY": "sk-from-env"})

    keys = [s["data"]["provider"]["key"] for s in secrets]
    assert keys == ["sk-stored"]


async def test_the_shadow_holds_when_the_stored_record_is_the_alias(fetch):
    """The same rule read from the other side: a stored `mistralai` shadows MISTRAL_API_KEY."""
    payload = [_provider_key("mistralai", "mistralai", "sk-stored")]

    secrets, _, _ = await fetch(payload, env={"MISTRAL_API_KEY": "sk-from-env"})

    keys = [s["data"]["provider"]["key"] for s in secrets]
    assert keys == ["sk-stored"]


async def test_an_env_var_for_an_unstored_family_still_reaches_the_workflow(fetch):
    payload = [_provider_key("openai", "openai", "sk-stored")]

    secrets, _, _ = await fetch(payload, env={"ANTHROPIC_API_KEY": "sk-ant"})

    kinds = {s["data"]["kind"] for s in secrets}
    assert kinds == {"openai", "anthropic"}


async def test_custom_providers_still_ride_along(fetch):
    payload = [
        _provider_key("openai", "openai", "sk-first"),
        _custom_provider("my-gw"),
    ]

    secrets, vault_secrets, _ = await fetch(payload)

    assert [s["slug"] for s in secrets] == ["openai", "my-gw"]
    assert [s["slug"] for s in vault_secrets] == ["openai", "my-gw"]
