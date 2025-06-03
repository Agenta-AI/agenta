from typing import Optional, List, TypeVar, Type
from uuid import UUID
from abc import abstractmethod


from oss.src.core.shared.dtos import Reference, Meta, Flags, Data
from oss.src.core.git.dtos import Commit, Artifact, Variant, Revision


T = TypeVar("T")


class GitDAOInterface:
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
        artifact_slug: str,
        #
        artifact_flags: Optional[Flags] = None,
        artifact_meta: Optional[Meta] = None,
        artifact_name: Optional[str] = None,
        artifact_description: Optional[str] = None,
    ) -> Optional[Artifact]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_artifact(
        self,
        *,
        project_id: UUID,
        #
        artifact_ref: Optional[Reference] = None,
    ) -> Optional[Artifact]:
        raise NotImplementedError

    @abstractmethod
    async def edit_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_id: UUID,
        #
        artifact_flags: Optional[Flags] = None,
        artifact_meta: Optional[Meta] = None,
        artifact_name: Optional[str] = None,
        artifact_description: Optional[str] = None,
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
        artifact_flags: Optional[Flags] = None,
        artifact_meta: Optional[Meta] = None,
        #
        include_archived: Optional[bool] = None,
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
        artifact_id: UUID,
        #
        variant_slug: str,
        #
        variant_flags: Optional[Flags] = None,
        variant_meta: Optional[Meta] = None,
        variant_name: Optional[str] = None,
        variant_description: Optional[str] = None,
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
    ) -> Optional[Variant]:
        raise NotImplementedError

    @abstractmethod
    async def edit_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_id: UUID,
        #
        variant_flags: Optional[Flags] = None,
        variant_meta: Optional[Meta] = None,
        variant_name: Optional[str] = None,
        variant_description: Optional[str] = None,
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
        variant_flags: Optional[Flags] = None,
        variant_meta: Optional[Meta] = None,
        #
        include_archived: Optional[bool] = None,
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
        variant_slug: str,
        revision_slug: str,
        #
        variant_id: Optional[UUID] = None,
        revision_id: Optional[UUID] = None,
        depth: Optional[int] = None,
        #
        variant_flags: Optional[Flags] = None,
        variant_meta: Optional[Meta] = None,
        variant_name: Optional[str] = None,
        variant_description: Optional[str] = None,
        #
        revision_flags: Optional[Flags] = None,
        revision_meta: Optional[Meta] = None,
        revision_name: Optional[str] = None,
        revision_description: Optional[str] = None,
        revision_message: Optional[str] = None,
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
        artifact_id: UUID,
        variant_id: UUID,
        #
        revision_slug: str,
        #
        revision_flags: Optional[Flags] = None,
        revision_meta: Optional[Meta] = None,
        revision_name: Optional[str] = None,
        revision_description: Optional[str] = None,
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
    ) -> Optional[Revision]:
        raise NotImplementedError

    @abstractmethod
    async def edit_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_id: UUID,
        #
        revision_flags: Optional[Flags] = None,
        revision_meta: Optional[Meta] = None,
        revision_name: Optional[str] = None,
        revision_description: Optional[str] = None,
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
        revision_flags: Optional[Flags] = None,
        revision_meta: Optional[Meta] = None,
        #
        include_archived: Optional[bool] = None,
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
        artifact_id: UUID,
        variant_id: UUID,
        #
        revision_slug: str,
        #
        revision_flags: Optional[Flags] = None,
        revision_meta: Optional[Meta] = None,
        revision_name: Optional[str] = None,
        revision_description: Optional[str] = None,
        revision_message: Optional[str] = None,
        revision_data: Optional[Data] = None,
    ) -> Optional[Revision]:
        raise NotImplementedError

    @abstractmethod
    async def log_revisions(
        self,
        *,
        project_id: UUID,
        #
        variant_ref: Optional[Reference] = None,
        revision_ref: Optional[Reference] = None,
        depth: Optional[int] = None,
    ) -> List[Revision]:
        raise NotImplementedError

    ## -------------------------------------------------------------------------
