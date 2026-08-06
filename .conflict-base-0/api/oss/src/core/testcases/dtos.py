from typing import Optional
from uuid import UUID

from pydantic import Field

from oss.src.core.blobs.dtos import Blob

from oss.src.core.shared.dtos import sync_alias, AliasConfig


class TestsetIdAlias(AliasConfig):
    testset_id: Optional[UUID] = None
    set_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="testset_id",
    )


class Testcase(Blob, TestsetIdAlias):
    def model_post_init(self, __context) -> None:
        sync_alias("testset_id", "set_id", self)
