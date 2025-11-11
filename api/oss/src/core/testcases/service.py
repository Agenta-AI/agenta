from typing import List, Optional
from uuid import UUID

from oss.src.utils.logging import get_module_logger

from oss.src.core.blobs.interfaces import BlobsDAOInterface
from oss.src.core.blobs.dtos import BlobCreate, BlobQuery
from oss.src.core.testcases.dtos import Testcase

log = get_module_logger(__name__)


class TestcasesService:
    def __init__(
        self,
        *,
        blobs_dao: BlobsDAOInterface,
    ):
        self.blobs_dao = blobs_dao

    async def add_testcases(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testcases: List[Testcase],
    ) -> List[Testcase]:
        blob_creates = [
            BlobCreate(
                **testcase.model_dump(mode="json", exclude_none=True),
            )
            for testcase in testcases
        ]

        blobs = await self.blobs_dao.add_blobs(
            project_id=project_id,
            user_id=user_id,
            #
            blob_creates=blob_creates,
        )

        if not blobs:
            return []

        _testcases = [
            Testcase(
                **blob.model_dump(mode="json"),
            )
            for blob in blobs
        ]

        return _testcases

    async def fetch_testcases(
        self,
        *,
        project_id: UUID,
        #
        testcase_ids: Optional[List[UUID]] = None,
        #
        testset_id: Optional[UUID] = None,
        #
        windowing: Optional[bool] = False,
    ) -> List[Testcase]:
        _blob_query = (
            BlobQuery(
                set_ids=[testset_id] if testset_id else None,
                blob_ids=testcase_ids if testcase_ids else None,
            )
            if testcase_ids or testset_id
            else BlobQuery()
        )

        blobs = await self.blobs_dao.query_blobs(
            project_id=project_id,
            #
            blob_query=_blob_query,
            #
            windowing=windowing,
        )

        if not blobs:
            return []

        _testcases = [
            Testcase(
                **blob.model_dump(mode="json"),
            )
            for blob in blobs
        ]

        return _testcases
