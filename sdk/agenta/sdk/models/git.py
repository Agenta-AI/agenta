from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from agenta.sdk.models.shared import (
    TraceID,
    SpanID,
    Link,
    Identifier,
    Slug,
    Version,
    Reference,
    Lifecycle,
    Header,
    Flags,
    Tags,
    Meta,
    Metadata,
    Data,
    Commit,
    AliasConfig,
    sync_alias,
)


from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel


# artifacts --------------------------------------------------------------------


class Artifact(Identifier, Slug, Lifecycle, Header, Metadata):
    pass


class ArtifactCreate(Slug, Header, Metadata):
    pass


class ArtifactEdit(Identifier, Header, Metadata):
    pass


class ArtifactQuery(Metadata):
    pass


# variants ---------------------------------------------------------------------


class Variant(Identifier, Slug, Lifecycle, Header, Metadata):
    artifact_id: Optional[UUID] = None


class VariantCreate(Slug, Header, Metadata):
    artifact_id: Optional[UUID] = None


class VariantEdit(Identifier, Header, Metadata):
    pass


class VariantQuery(Metadata):
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


class RevisionQuery(Metadata):
    authors: Optional[List[UUID]] = None


class RevisionCommit(Slug, Header, Metadata):
    data: Optional[Data] = None

    message: Optional[str] = None

    artifact_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None


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
