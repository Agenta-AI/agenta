"""Core contracts the workflows service depends on (not concrete DB/DAO).

The :class:`StaticWorkflowProvider` is the read-only seam for static workflows served
from code under a reserved slug namespace. ``WorkflowsService`` depends on this interface, never on
a concrete catalogue, so the layering rule (core depends on interfaces, the composition root wires
the implementation) holds.
"""

from abc import ABC, abstractmethod
from typing import Optional
from uuid import UUID

from oss.src.core.workflows.dtos import WorkflowRevision


class StaticWorkflowProvider(ABC):
    """A read-only provider of synthetic, code-defined workflow revisions.

    Static workflows live under a reserved slug namespace and are served from code, never the
    database. The provider answers whether a reference belongs to the reserved namespace, whether
    it may be embedded, and what synthetic revision it resolves to.
    """

    @abstractmethod
    def is_static_slug(self, slug: Optional[str]) -> bool:
        """Whether ``slug`` is in the reserved static namespace.

        A slug in this namespace is never read from or written to the database.
        """

    @abstractmethod
    def is_static_id(self, entity_id: Optional[UUID]) -> bool:
        """Whether ``entity_id`` is a synthetic static artifact / variant / revision id.

        Lets an id-only reference short-circuit to the catalogue (deploy emits synthetic ids), so
        a static id never DB-queries.
        """

    @abstractmethod
    def is_embeddable(
        self,
        *,
        id: Optional[UUID] = None,
        slug: Optional[str] = None,
    ) -> bool:
        """Whether a static workflow reference may be used inside an embed."""

    @abstractmethod
    def retrieve_revision(
        self,
        *,
        id: Optional[UUID] = None,
        slug: Optional[str] = None,
        version: Optional[str] = None,
    ) -> Optional[WorkflowRevision]:
        """Resolve a static reference to a synthetic :class:`WorkflowRevision`.

        Accepts any of an ``id`` (artifact / variant / revision), a reserved ``slug``, and a
        ``version``; an internal check dispatches:

        - ``id`` (id-only ref): an artifact / variant id resolves to ``latest``; a revision id pins
          its version. Returns ``None`` if the id is not a known static id.
        - ``slug`` (+ optional ``version``): no ``version`` resolves to the entry's ``latest``; a
          ``version`` pins that immutable version. Returns ``None`` if the slug or version is
          unknown.

        Returns ``None`` if nothing resolvable was supplied.
        """
