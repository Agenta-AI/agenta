"""The adapter registry: `provider name → CatalogProvider`.

Adding a catalog kind later (GitLab, a marketplace, an internal registry)
means writing one adapter and registering it here — the import service,
routes, and frontend never change. Wired in `entrypoints/`.
"""

from typing import List, Optional, Tuple

from oss.src.core.skills.exceptions import (
    SkillSourceFetchError,
    SkillSourceInvalidURLError,
)
from oss.src.core.skills.providers.base import CatalogProvider, SourceLocator


class ProviderRegistry:
    def __init__(self, providers: List[CatalogProvider]):
        self._providers = {p.provider: p for p in providers}

    def get(self, provider: str) -> CatalogProvider:
        adapter = self._providers.get(provider or "")
        if adapter is None:
            # A stored origin naming an unregistered provider: the record is fine,
            # this deployment just cannot serve it.
            raise SkillSourceFetchError(
                f"No catalog provider {provider!r} is registered.",
            )
        return adapter

    def resolve(
        self,
        source_url: str,
        *,
        provider: Optional[str] = None,
        ref: Optional[str] = None,
    ) -> Tuple[CatalogProvider, SourceLocator]:
        """The adapter + locator for a source reference.

        By default every adapter is asked whether it recognizes the URL; an
        explicit `provider` narrows the question to one adapter."""
        candidates = (
            [self.get(provider)] if provider else list(self._providers.values())
        )
        for adapter in candidates:
            locator = adapter.claims(source_url)
            if locator is not None:
                if ref is not None:
                    locator = locator.model_copy(update={"ref": ref})
                return adapter, locator
        raise SkillSourceInvalidURLError(
            f"No catalog provider recognizes {source_url!r}.",
            next_step="Pass a URL like github.com/<owner>/<repo>.",
        )
