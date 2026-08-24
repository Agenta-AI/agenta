"""Validation-layer tests for ProvidersService (thin wrapper house style)."""

import pytest
from agenta_local.core.providers.dtos import ProviderCredential, ProviderState
from agenta_local.core.providers.service import ProvidersService
from agenta_local.core.providers.types import (
    ProviderNameInvalid,
    ProviderNotConfigured,
    redact_key_suffix,
)


class FakeStore:
    """In-memory stand-in; records calls so tests assert delegation."""

    def __init__(self) -> None:
        self.entries: dict[str, ProviderCredential] = {}
        self.calls: list[str] = []

    async def list_states(self):
        self.calls.append("list_states")
        return [
            ProviderState(provider=name, configured=True, key_suffix="...last")
            for name in sorted(self.entries)
        ]

    async def get_for_execution(self, *, provider: str) -> ProviderCredential:
        self.calls.append(f"get_for_execution:{provider}")
        if provider not in self.entries:
            raise ProviderNotConfigured(provider)
        return self.entries[provider]

    async def put(self, *, provider: str, credential: ProviderCredential) -> None:
        self.calls.append(f"put:{provider}")
        self.entries[provider] = credential

    async def delete(self, *, provider: str) -> None:
        self.calls.append(f"delete:{provider}")
        self.entries.pop(provider, None)


@pytest.fixture
def service() -> ProvidersService:
    return ProvidersService(FakeStore())


@pytest.mark.parametrize(
    "name", ["openai", "anthropic", "a", "provider-01", "my_provider", "a-1_2"]
)
async def test_valid_provider_names_pass(service: ProvidersService, name: str):
    await service.put(
        provider=name, credential=ProviderCredential(api_key="sk-fake-1234-abcd")
    )
    assert [s.provider for s in await service.list_states()] == [name]


@pytest.mark.parametrize(
    "name", ["", "OpenAI", "open ai", "open.ai", "openai/x", "../etc"]
)
async def test_invalid_provider_names_are_rejected(
    service: ProvidersService, name: str
):
    with pytest.raises(ProviderNameInvalid):
        await service.put(
            provider=name,
            credential=ProviderCredential(api_key="sk-fake-1234-abcd"),
        )
    with pytest.raises(ProviderNameInvalid):
        await service.delete(provider=name)
    with pytest.raises(ProviderNameInvalid):
        await service.resolve_credential(provider=name)


async def test_blank_api_key_is_rejected(service: ProvidersService):
    with pytest.raises(ValueError):
        await service.put(
            provider="openai", credential=ProviderCredential(api_key="   ")
        )


def test_credential_repr_hides_api_key():
    credential = ProviderCredential(api_key="sk-fake-secret-value-9999")
    assert "sk-fake-secret-value-9999" not in repr(credential)
    assert "sk-fake-secret-value-9999" not in str(credential)


@pytest.mark.parametrize(
    ("api_key", "expected_suffix"),
    [
        ("sk-1234567890abcdef", "...cdef"),
        ("12345678", "...5678"),
        ("short", "***"),
        ("", "***"),
    ],
)
def test_redacted_suffix_shows_only_last_four_chars(api_key: str, expected_suffix: str):
    assert redact_key_suffix(api_key) == expected_suffix


async def test_service_delegates_to_store():
    store = FakeStore()
    service = ProvidersService(store)
    credential = ProviderCredential(api_key="  sk-fake-1234-abcd  ")
    await service.put(provider="openai", credential=credential)
    assert store.calls == ["put:openai"]
    # Key was stripped before reaching the store.
    assert store.entries["openai"].api_key == "sk-fake-1234-abcd"

    states = await service.list_states()
    assert states and store.calls[-1] == "list_states"

    resolved = await service.resolve_credential(provider="openai")
    assert resolved.api_key == "sk-fake-1234-abcd"
