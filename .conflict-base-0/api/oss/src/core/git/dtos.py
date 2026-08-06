from typing import Dict, Optional, List
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel, Field

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
    Reference,
)


# artifacts --------------------------------------------------------------------


class Artifact(Identifier, Slug, Lifecycle, Header, Metadata, FolderScope):
    pass


class ArtifactCreate(Slug, Header, Metadata, FolderScope):
    pass


class ArtifactEdit(Identifier, Header, Metadata, FolderScope):
    pass


class ArtifactQuery(Header, Metadata, FolderScope):
    slug: Optional[str] = None
    slugs: Optional[List[str]] = None


# variants ---------------------------------------------------------------------


class Variant(Identifier, Slug, Lifecycle, Header, Metadata):
    artifact_id: Optional[UUID] = None
    artifact_slug: Optional[str] = None


class VariantCreate(Slug, Header, Metadata):
    artifact_id: Optional[UUID] = None


class VariantEdit(Identifier, Header, Metadata):
    pass


class VariantQuery(Header, Metadata):
    slug: Optional[str] = None
    slugs: Optional[List[str]] = None


# revisions --------------------------------------------------------------------


class Revision(Identifier, Slug, Version, Lifecycle, Header, Metadata, Commit):
    data: Optional[Data] = None

    artifact_id: Optional[UUID] = None
    artifact_slug: Optional[str] = None
    variant_id: Optional[UUID] = None
    variant_slug: Optional[str] = None


class RevisionCreate(Slug, Header, Metadata):
    artifact_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None


class RevisionEdit(Identifier, Header, Metadata):
    pass


class RevisionQuery(Header, Metadata):
    slug: Optional[str] = None
    slugs: Optional[List[str]] = None

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


# retrieval --------------------------------------------------------------------


class RetrievalInfo(BaseModel):
    """References actually used to retrieve a revision.

    For direct retrievals, `references` carries the artifact / variant / revision
    that was fetched. For environment-backed retrievals, it additionally carries
    the environment + environment_variant + environment_revision used to look
    the target up, and `selector` is {the key: path} map inside the environment's
    references map that selected the target.
    """

    references: Dict[str, Reference] = Field(default_factory=dict)
    selector: Optional[Dict[str, str]] = None


# ------------------------------------------------------------------------------
