"""Core seam for provider credentials. Typed DTOs in, domain failures out."""

from abc import ABC, abstractmethod

from .dtos import ProviderCredential, ProviderState


class ProviderCredentialsStoreInterface(ABC):
    @abstractmethod
    async def list_states(self) -> list[ProviderState]:
        """Configured state with redacted key suffixes only; never raw keys."""
        raise NotImplementedError

    @abstractmethod
    async def get_for_execution(self, *, provider: str) -> ProviderCredential:
        """Return one credential to the execution adapter only; never expose
        through an HTTP read route."""
        raise NotImplementedError

    @abstractmethod
    async def put(self, *, provider: str, credential: ProviderCredential) -> None:
        """Atomically rewrite the protected file with this provider's entry."""
        raise NotImplementedError

    @abstractmethod
    async def delete(self, *, provider: str) -> None:
        """Atomically remove one provider record (no-op when absent)."""
        raise NotImplementedError
