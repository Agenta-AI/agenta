from typing import Optional, List, TypeVar, Type
from uuid import UUID
from abc import ABC, abstractmethod


from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.git.dtos import (
    Artifact,
    ArtifactCreate,
    ArtifactEdit,
    ArtifactQuery,
    RevisionsLog,
    ArtifactFork,
    Variant,
    VariantCreate,
    VariantEdit,
    VariantQuery,
    Revision,
    RevisionCreate,
    RevisionEdit,
    RevisionQuery,
    RevisionCommit,
)


T = TypeVar("T")


class GitDAOInterface(ABC):
    def __init__(
        self,
        *,
        ArtifactDBE: Type[T],
        VariantDBE: Type[T],
        RevisionDBE: Type[T],
    ):
        self.ArtifactDBE = ArtifactDBE  # pylint: disable=invalid-name
        self.VariantDBE = VariantDBE  # pylint: disable=invalid-name
        self.RevisionDBE = RevisionDBE  # pylint: disable=invalid-name

    ## -- artifacts ------------------------------------------------------------

    @abstractmethod
    async def create_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_create: ArtifactCreate,
        #
        artifact_id: Optional[UUID] = None,
    ) -> Optional[Artifact]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_artifact(
        self,
        *,
        project_id: UUID,
        #
        artifact_ref: Reference,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[Artifact]:
        raise NotImplementedError

    @abstractmethod
    async def edit_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_edit: ArtifactEdit,
    ) -> Optional[Artifact]:
        raise NotImplementedError

    @abstractmethod
    async def archive_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_id: UUID,
    ) -> Optional[Artifact]:
        raise NotImplementedError

    @abstractmethod
    async def unarchive_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_id: UUID,
    ) -> Optional[Artifact]:
        raise NotImplementedError

    @abstractmethod
    async def query_artifacts(
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
    ) -> List[Artifact]:
        raise NotImplementedError

    ## -------------------------------------------------------------------------

    ## -- variants -------------------------------------------------------------

    @abstractmethod
    async def create_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_create: VariantCreate,
    ) -> Optional[Variant]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_variant(
        self,
        *,
        project_id: UUID,
        #
        artifact_ref: Optional[Reference] = None,
        variant_ref: Optional[Reference] = None,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[Variant]:
        raise NotImplementedError

    @abstractmethod
    async def edit_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_edit: VariantEdit,
    ) -> Optional[Variant]:
        raise NotImplementedError

    @abstractmethod
    async def archive_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_id: UUID,
    ) -> Optional[Variant]:
        raise NotImplementedError

    @abstractmethod
    async def unarchive_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_id: UUID,
    ) -> Optional[Variant]:
        raise NotImplementedError

    @abstractmethod
    async def query_variants(
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
    ) -> List[Variant]:
        raise NotImplementedError

    # ..........................................................................

    @abstractmethod
    async def fork_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_fork: ArtifactFork,
    ) -> Optional[Variant]:
        raise NotImplementedError

    ## -------------------------------------------------------------------------

    ## -- revisions ------------------------------------------------------------

    @abstractmethod
    async def create_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_create: RevisionCreate,
    ) -> Optional[Revision]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_revision(
        self,
        *,
        project_id: UUID,
        #
        variant_ref: Optional[Reference] = None,
        revision_ref: Optional[Reference] = None,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[Revision]:
        raise NotImplementedError

    @abstractmethod
    async def edit_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_edit: RevisionEdit,
    ) -> Optional[Revision]:
        raise NotImplementedError

    @abstractmethod
    async def archive_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_id: UUID,
    ) -> Optional[Revision]:
        raise NotImplementedError

    @abstractmethod
    async def unarchive_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_id: UUID,
    ) -> Optional[Revision]:
        raise NotImplementedError

    @abstractmethod
    async def query_revisions(
        self,
        *,
        project_id: UUID,
        #
        revision_query: RevisionQuery,
        #
        artifact_refs: Optional[List[Reference]] = None,
        variant_refs: Optional[List[Reference]] = None,
        revision_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Revision]:
        raise NotImplementedError

    ## .........................................................................

    @abstractmethod
    async def commit_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_commit: RevisionCommit,
    ) -> Optional[Revision]:
        raise NotImplementedError

    @abstractmethod
    async def log_revisions(
        self,
        *,
        project_id: UUID,
        #
        revisions_log: RevisionsLog,
        #
        include_archived: bool = False,
    ) -> List[Revision]:
        raise NotImplementedError

    ## -------------------------------------------------------------------------
