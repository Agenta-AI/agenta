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
    Commit,
    FolderScope,
)


# artifacts --------------------------------------------------------------------


class Artifact(Identifier, Slug, Lifecycle, Header, Metadata, FolderScope):
    pass


class ArtifactCreate(Slug, Header, Metadata, FolderScope):
    pass


class ArtifactEdit(Identifier, Header, Metadata, FolderScope):
    pass


class ArtifactQuery(Header, Metadata, FolderScope):
    pass


# variants ---------------------------------------------------------------------


class Variant(Identifier, Slug, Lifecycle, Header, Metadata):
    artifact_id: Optional[UUID] = None


class VariantCreate(Slug, Header, Metadata):
    artifact_id: Optional[UUID] = None


class VariantEdit(Identifier, Header, Metadata):
    pass


class VariantQuery(Header, Metadata):
    pass


# revisions --------------------------------------------------------------------


class Revision(Identifier, Slug, Version, Lifecycle, Header, Metadata, Commit):
    data: Optional[Data] = None

    artifact_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None


class RevisionCreate(Slug, Header, Metadata):
    artifact_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None


class RevisionEdit(Identifier, Header, Metadata):
    pass


class RevisionQuery(Header, Metadata):
    author: Optional[UUID] = None
    authors: Optional[List[UUID]] = None

    date: Optional[datetime] = None
    dates: Optional[List[datetime]] = None

    message: Optional[str] = None


class RevisionCommit(Slug, Header, Metadata):
    data: Optional[Data] = None

    message: Optional[str] = None

    artifact_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None
    revision_id: Optional[UUID] = None


class RevisionsLog(BaseModel):
    artifact_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None
    revision_id: Optional[UUID] = None

    depth: Optional[int] = None


# forks ------------------------------------------------------------------------


class RevisionFork(Slug, Header, Metadata):
    data: Optional[Data] = None

    message: Optional[str] = None


class VariantFork(Slug, Header, Metadata):
    pass


class ArtifactFork(RevisionsLog):
    variant: Optional[VariantFork] = None
    revision: Optional[RevisionFork] = None


# ------------------------------------------------------------------------------
