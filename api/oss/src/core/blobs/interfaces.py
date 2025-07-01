from typing import Optional, List, TypeVar, Type
from uuid import UUID
from abc import ABC, abstractmethod


from oss.src.core.shared.dtos import Windowing
from oss.src.core.blobs.dtos import Blob, BlobCreate, BlobEdit, BlobQuery


T = TypeVar("T")


class BlobsDAOInterface(ABC):
    def __init__(
        self,
        *,
        BlobDBE: Type[T],
    ):
        self.BlobDBE = BlobDBE  # pylint: disable=invalid-name

    ## -- blobs ------------------------------------------------------------

    @abstractmethod
    async def add_blob(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        blob_create: BlobCreate,
    ) -> Optional[Blob]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_blob(
        self,
        *,
        project_id: UUID,
        #
        blob_id: UUID,
    ) -> Optional[Blob]:
        raise NotImplementedError

    @abstractmethod
    async def edit_blob(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        blob_edit: BlobEdit,
    ) -> Optional[Blob]:
        raise NotImplementedError

    @abstractmethod
    async def remove_blob(
        self,
        *,
        project_id: UUID,
        #
        blob_id: UUID,
    ) -> Optional[Blob]:
        raise NotImplementedError

    @abstractmethod
    async def add_blobs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        blob_creates: List[BlobCreate],
    ) -> List[Blob]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_blobs(
        self,
        *,
        project_id: UUID,
        #
        blob_ids: List[UUID],
    ) -> List[Blob]:
        raise NotImplementedError

    @abstractmethod
    async def remove_blobs(
        self,
        *,
        project_id: UUID,
        #
        blob_ids: List[UUID],
    ) -> List[Blob]:
        raise NotImplementedError

    @abstractmethod
    async def query_blobs(
        self,
        *,
        project_id: UUID,
        #
        blob_query: BlobQuery,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Blob]:
        raise NotImplementedError

    ## -------------------------------------------------------------------------
