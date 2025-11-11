from typing import Optional, List, TypeVar, Type
from uuid import UUID
from abc import abstractmethod


from oss.src.core.shared.dtos import Reference
from oss.src.core.blobs.dtos import Blob


T = TypeVar("T")


class BlobDAOInterface:
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
        #
        blob: Blob,
    ) -> Optional[Blob]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_blob(
        self,
        *,
        project_id: UUID,
        #
        blob_ref: Optional[Reference] = None,
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
        #
        blobs: List[Blob],
    ) -> List[Blob]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_blobs(
        self,
        *,
        project_id: UUID,
        #
        set_id: Optional[UUID] = None,
        #
        blob_refs: Optional[List[Reference]] = None,
        #
        limit: Optional[int] = None,
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

    ## -------------------------------------------------------------------------
