"""Core contracts the workflows service depends on (not concrete DB/DAO).

The :class:`StaticWorkflowProvider` is the read-only seam for static workflows served
from code under a reserved slug namespace. ``WorkflowsService`` depends on this interface, never on
a concrete catalogue, so the layering rule (core depends on interfaces, the composition root wires
the implementation) holds.
"""

from abc import ABC, abstractmethod
from typing import List, Literal, Optional
from uuid import UUID

from oss.src.core.git.dtos import (
    Artifact,
    ArtifactCreate,
    ArtifactQuery,
    Revision,
    RevisionGrouping,
    RevisionQuery,
    Variant,
    VariantQuery,
)
from oss.src.core.git.interfaces import GitDAOInterface
from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.sharing.dtos import AccessPolicy, AgentReadScope
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


class WorkflowsDAOInterface(GitDAOInterface):
    """The workflows DAO: the git DAO plus the agent access writes that must share a
    transaction with the workflow rows, and agent queries scoped in SQL.

    The four query methods take the `GitDAO` keyword arguments plus a required
    `read_scope`: a private agent is listed only when its owner is
    `read_scope.owner_user_id`. The filter runs inside the same statement, before
    windowing. There is no unrestricted scope."""

    @abstractmethod
    async def create_agent_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_create: ArtifactCreate,
        access: AccessPolicy,
        #
        artifact_id: Optional[UUID] = None,
        platform_meta: bool = False,
    ) -> Artifact:
        """Create the artifact and its `agent_access` row in one transaction. `access`
        has an owner (ownerless agents use `create_artifact` and get no row).

        Raises `EntityCreationConflict` on a slug or id conflict and
        `AgentCreationFailed` on any other failure; nothing is committed then."""

    @abstractmethod
    async def ensure_first_agent_access(
        self,
        *,
        project_id: UUID,
        artifact_id: UUID,
        revision_id: UUID,
        owner_user_id: UUID,
    ) -> bool:
        """Give the artifact a project-visible access row owned by `owner_user_id` when
        `revision_id` is its earliest agent revision (by created_at, then id) and it
        has no row yet. Takes the
        artifact row lock first, like every agent policy write. True when a row was
        inserted."""

    @abstractmethod
    async def fetch_agent_artifact_id(
        self,
        *,
        project_id: UUID,
        level: Literal["artifact", "variant", "revision"],
        reference: Reference,
    ) -> Optional[UUID]:
        """The artifact id of the artifact, variant or revision `reference` names (by
        id, else by slug), in one indexed read, with no read scope. None when it is
        unknown, deleted or archived (the row or its artifact)."""

    @abstractmethod
    async def query_artifacts(  # type: ignore[override]
        self,
        *,
        project_id: UUID,
        #
        artifact_query: ArtifactQuery,
        #
        artifact_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
        #
        read_scope: AgentReadScope,
    ) -> List[Artifact]: ...

    @abstractmethod
    async def query_variants(  # type: ignore[override]
        self,
        *,
        project_id: UUID,
        #
        variant_query: VariantQuery,
        #
        artifact_refs: Optional[List[Reference]] = None,
        variant_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
        #
        read_scope: AgentReadScope,
    ) -> List[Variant]: ...

    @abstractmethod
    async def query_revisions(  # type: ignore[override]
        self,
        *,
        project_id: UUID,
        #
        revision_query: RevisionQuery,
        grouping: Optional[RevisionGrouping] = None,
        #
        artifact_refs: Optional[List[Reference]] = None,
        variant_refs: Optional[List[Reference]] = None,
        revision_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
        #
        read_scope: AgentReadScope,
    ) -> List[Revision]: ...

    @abstractmethod
    async def query_head_revisions(  # type: ignore[override]
        self,
        *,
        project_id: UUID,
        #
        revision_query: RevisionQuery,
        #
        artifact_search: Optional[str] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
        #
        read_scope: AgentReadScope,
    ) -> List[Revision]: ...
