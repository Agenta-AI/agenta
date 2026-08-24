"""Providers domain service: input validation above the credential-store seam.

Owns redacted provider state for HTTP reads/writes. Raw keys leave this domain
only through `ProviderCredentialsStoreInterface.get_for_execution`, which is
reserved for the execution adapter.
"""

from .dtos import ProviderCredential, ProviderState
from .interfaces import ProviderCredentialsStoreInterface
from .types import validate_provider_name


def _clean_api_key(api_key: str) -> str:
    cleaned = api_key.strip()
    if not cleaned:
        raise ValueError("api_key must be non-empty")
    return cleaned


class ProvidersService:
    def __init__(self, store: ProviderCredentialsStoreInterface) -> None:
        self._store = store

    async def list_states(self) -> list[ProviderState]:
        return await self._store.list_states()

    async def put(self, *, provider: str, credential: ProviderCredential) -> None:
        validate_provider_name(provider)
        await self._store.put(
            provider=provider,
            credential=credential.model_copy(
                update={"api_key": _clean_api_key(credential.api_key)}
            ),
        )

    async def delete(self, *, provider: str) -> None:
        validate_provider_name(provider)
        await self._store.delete(provider=provider)

    async def get_for_execution(self, *, provider: str) -> ProviderCredential:
        """Contracts name; execution adapter seam only."""
        return await self.resolve_credential(provider=provider)

    async def resolve_credential(self, *, provider: str) -> ProviderCredential:
        """Execution-only path; raises ProviderNotConfigured when unset."""
        validate_provider_name(provider)
        return await self._store.get_for_execution(provider=provider)
