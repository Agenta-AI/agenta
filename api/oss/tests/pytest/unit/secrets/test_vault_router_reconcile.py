"""The vault list route is the one path that revisits an Agenta-managed connection after
it was seeded, so it is where a stale seeded value is repaired."""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.apis.fastapi.vault import router as vault_router
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.subscription_login import SubscriptionLoginRunnerClient
from oss.src.core.secrets.subscription_service import SubscriptionLoginService


PROJECT_ID = uuid4()


def _row(model: str) -> SecretResponseDTO:
    return SecretResponseDTO(
        id=uuid4(),
        slug="starter-credits",
        kind="custom_provider",
        data={
            "kind": "custom",
            "provider_slug": "Agenta",
            "provider": {"url": "https://credits.example.test", "key": "sk-virtual"},
            "models": [{"slug": model}],
        },
        header={"name": "Agenta"},
        write_only=True,
        management={"manager": "starter-credits-bridge", "policy": "manager_only"},
    )


class _Service:
    def __init__(self, rows):
        self.rows = rows

    async def list_secrets(self, project_id):
        return list(self.rows)


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(user_id=str(uuid4()), project_id=str(PROJECT_ID))
    )


@pytest.fixture
def route(monkeypatch):
    async def allowed(**kwargs):
        return True

    monkeypatch.setattr(vault_router, "check_action_access", allowed)
    monkeypatch.setattr(vault_router, "request_has_grant", lambda request, grant: False)

    def build(service):
        # The router as the entrypoint wires it, with a runner client nothing here calls.
        return vault_router.VaultRouter(
            vault_service=service,
            subscription_login_service=SubscriptionLoginService(
                vault_service=service,
                runner_client=SubscriptionLoginRunnerClient(base_url="", token=""),
            ),
        )

    return build


@pytest.mark.asyncio
async def test_a_stale_row_is_read_back_repaired(route, monkeypatch):
    stale = _row("vertex_ai/old-model")
    repaired = _row("vertex_ai/new-model")
    calls = []

    async def reconcile(*, project_id, secrets):
        calls.append((project_id, [secret.slug for secret in secrets]))
        return repaired

    monkeypatch.setattr(vault_router, "reconcile_starter_credits_on_read", reconcile)

    response = await route(_Service([stale])).list_secrets(_request())

    assert calls == [(PROJECT_ID, ["starter-credits"])]
    (secret,) = response
    assert [model.slug for model in secret.data.models] == ["vertex_ai/new-model"]


@pytest.mark.asyncio
async def test_a_current_row_is_returned_as_read(route, monkeypatch):
    current = _row("vertex_ai/new-model")

    async def reconcile(*, project_id, secrets):
        return None

    monkeypatch.setattr(vault_router, "reconcile_starter_credits_on_read", reconcile)

    (secret,) = await route(_Service([current])).list_secrets(_request())

    assert [model.slug for model in secret.data.models] == ["vertex_ai/new-model"]


@pytest.mark.asyncio
async def test_a_failed_reconcile_never_fails_the_read(route, monkeypatch):
    current = _row("vertex_ai/old-model")

    async def reconcile(*, project_id, secrets):
        raise RuntimeError("proxy is down")

    monkeypatch.setattr(vault_router, "reconcile_starter_credits_on_read", reconcile)

    (secret,) = await route(_Service([current])).list_secrets(_request())

    assert [model.slug for model in secret.data.models] == ["vertex_ai/old-model"]
