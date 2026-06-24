"""Core contracts the workflows service depends on (not concrete DB/DAO).

The :class:`PlatformWorkflowProvider` is the read-only seam for platform-owned workflows served
from code under a reserved slug namespace. ``WorkflowsService`` depends on this interface, never on
a concrete catalogue, so the layering rule (core depends on interfaces, the composition root wires
the implementation) holds.
"""

from abc import ABC, abstractmethod
from typing import Optional
from uuid import UUID

from oss.src.core.workflows.dtos import WorkflowRevision


class PlatformWorkflowProvider(ABC):
    """A read-only provider of synthetic, code-defined workflow revisions.

    Platform workflows live under a reserved slug namespace and are served from code, never the
    database. The provider answers two questions for ``WorkflowsService``: whether a slug belongs
    to the reserved namespace (so the service short-circuits before any DB lookup and so user
    create/edit/commit can be rejected), and what synthetic revision a reserved slug resolves to.
    """

    @abstractmethod
    def is_reserved_slug(self, slug: Optional[str]) -> bool:
        """Whether ``slug`` is in the reserved platform namespace.

        A slug in this namespace is never read from or written to the database.
        """

    @abstractmethod
    def is_reserved_id(self, entity_id: Optional[UUID]) -> bool:
        """Whether ``entity_id`` is a synthetic platform artifact / variant / revision id.

        Lets an id-only reference short-circuit to the catalogue (deploy emits synthetic ids), so
        a platform id never DB-queries.
        """

    @abstractmethod
    def get_revision(
        self,
        *,
        slug: str,
        version: Optional[str] = None,
    ) -> Optional[WorkflowRevision]:
        """Resolve a reserved slug to a synthetic :class:`WorkflowRevision`.

        With no ``version`` (an artifact-level lookup) returns the catalogue entry's ``current``
        version. With a ``version`` (a revision-level lookup) returns that immutable version, or
        ``None`` if the slug is unknown or the version does not exist.
        """

    @abstractmethod
    def get_revision_by_id(
        self,
        *,
        entity_id: UUID,
    ) -> Optional[WorkflowRevision]:
        """Resolve a synthetic platform id (artifact / variant / revision) to its revision.

        An artifact or variant id resolves to the ``current`` revision; a revision id pins its
        version. Returns ``None`` if ``entity_id`` is not a known platform id.
        """
