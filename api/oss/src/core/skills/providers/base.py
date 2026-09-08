"""The catalog-provider contract (skill-registry plan, Mahmoud's direction #4).

A provider turns an external skill catalog into a local snapshot the parser
can scan. Everything outside a provider module speaks only these shapes — no
repo, ref, or tarball vocabulary leaks past the adapter. The stored
`meta._ag.origin.locator` keeps the shared keys `repository` (the
provider-scoped source identity — for GitHub, `owner/repo`), `ref`, and
`path`; a provider may add its own extras.
"""

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, ConfigDict


class SourceLocator(BaseModel):
    """One external source, provider-scoped: WHERE skills come from."""

    provider: str
    # The source identity used for grouping and provenance (GitHub: "owner/repo").
    repository: str
    ref: Optional[str] = None


class SourceSnapshot(BaseModel):
    """A materialized source tree, ready for `scan_tree`."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    root: Path
    # The provider's immutable version of this snapshot (GitHub: the commit sha).
    resolved_version: Optional[str] = None


class CatalogProvider(ABC):
    """One external catalog kind. Register instances on the ProviderRegistry."""

    provider: str

    @abstractmethod
    def claims(self, source_url: str) -> Optional[SourceLocator]:
        """The locator, if this provider recognizes the reference — else None."""

    @abstractmethod
    async def fetch_snapshot(
        self, locator: SourceLocator, *, dest: Path
    ) -> SourceSnapshot:
        """Materialize the source into `dest` (raises SkillSourceFetchError family)."""

    @abstractmethod
    def item_url(
        self,
        locator: SourceLocator,
        *,
        path: str,
        resolved_version: Optional[str],
    ) -> Optional[str]:
        """A human-facing link to one item at one version, for provenance display."""
