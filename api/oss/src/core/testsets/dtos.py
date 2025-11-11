from typing import Optional, List, Dict, Any
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.shared.dtos import Tags, Data
from oss.src.core.git.dtos import Artifact, Variant, Revision
from oss.src.core.tracing.dtos import Link
from oss.src.core.blobs.dtos import Blob


class Testcase(Blob):
    pass


class TestsetData(BaseModel):
    testcase_ids: Optional[List[UUID]] = None
    testcases: Optional[List[Data]] = None
    links: Optional[List[Link]] = None
    mapping: Optional[Dict[str, str]] = None

    class Config:
        json_encoders = {UUID: str}

    def encode(self, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: self.encode(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self.encode(item) for item in data]
        for type_, encoder in self.Config.json_encoders.items():
            if isinstance(data, type_):
                return encoder(data)
        return data

    def model_dump(self, *args, **kwargs) -> dict:
        kwargs.setdefault("exclude_none", True)

        return self.encode(super().model_dump(*args, **kwargs))


class TestsetFlags(BaseModel):
    has_testcases: bool = False
    has_links: bool = False


class TestsetArtifact(Artifact):
    flags: Optional[TestsetFlags] = None


class TestsetVariant(Variant):
    flags: Optional[TestsetFlags] = None

    artifact_id: Optional[UUID] = None
    artifact: Optional[TestsetArtifact] = None


class TestsetRevision(Revision):
    data: Optional[TestsetData] = None
    flags: Optional[TestsetFlags] = None

    variant_id: Optional[UUID] = None
    variant: Optional[TestsetVariant] = None


class TestsetQuery(BaseModel):
    artifact_ref: Optional[TestsetArtifact] = None
    variant_ref: Optional[TestsetVariant] = None
    revision_ref: Optional[TestsetRevision] = None

    tags: Optional[Tags] = None
    flags: Optional[TestsetFlags] = None

    include_archived: Optional[bool] = None
