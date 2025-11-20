from typing import Optional, List
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Identifier,
    Slug,
    Version,
    Lifecycle,
    Header,
    Metadata,
    Data,
    Reference,
)


class Commit(BaseModel):
    author: Optional[UUID] = None
    date: Optional[datetime] = None
    message: Optional[str] = None


class CommitCreate(BaseModel):
    message: Optional[str] = None


class CommitFetch(BaseModel):
    authors: Optional[List[UUID]] = None


class Artifact(Identifier, Slug, Lifecycle, Header, Metadata):
    pass


class ArtifactCreate(Slug, Header, Metadata):
    pass


class ArtifactEdit(Identifier, Header, Metadata):
    pass


class ArtifactQuery(Metadata):
    pass


class Variant(Identifier, Slug, Lifecycle, Header, Metadata):
    artifact_id: Optional[UUID] = None


class VariantCreate(Slug, Header, Metadata):
    artifact_id: Optional[UUID] = None


class VariantEdit(Identifier, Header, Metadata):
    pass


class VariantQuery(Metadata):
    pass


class Revision(Identifier, Slug, Version, Lifecycle, Header, Metadata, Commit):
    data: Optional[Data] = None

    artifact_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None


class RevisionCreate(Slug, Header, Metadata):
    artifact_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None


class RevisionEdit(Identifier, Header, Metadata):
    pass


class RevisionQuery(Metadata, CommitFetch):
    pass


class RevisionCommit(Slug, Header, Metadata, CommitCreate):
    data: Optional[Data] = None

    artifact_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None


class RevisionFork(Slug, Header, Metadata, CommitCreate):
    data: Optional[Data] = None


class VariantFork(Slug, Header, Metadata):
    pass


class ArtifactLog(BaseModel):
    variant_id: Optional[UUID] = None
    revision_id: Optional[UUID] = None

    depth: Optional[int] = None


class ArtifactFork(ArtifactLog):
    variant: Optional[VariantFork] = None
    revision: Optional[RevisionFork] = None
