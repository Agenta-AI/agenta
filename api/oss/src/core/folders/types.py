from typing import Optional, List
from enum import Enum
from uuid import UUID

from oss.src.core.shared.dtos import (
    Identifier,
    Slug,
    Lifecycle,
    Header,
    Metadata,
)


class FolderKind(str, Enum):
    APPLICATIONS = "applications"


class Folder(Identifier, Slug, Lifecycle, Header, Metadata):
    kind: Optional[FolderKind] = None

    path: Optional[str] = None

    parent_id: Optional[UUID] = None


class FolderCreate(Slug, Header, Metadata):
    kind: Optional[FolderKind] = None

    parent_id: Optional[UUID] = None


class FolderEdit(Identifier, Slug, Header, Metadata):
    kind: Optional[FolderKind] = None

    parent_id: Optional[UUID] = None


class FolderQuery(Header, Metadata):
    # scope
    id: Optional[UUID] = None
    ids: Optional[List[UUID]] = None

    slug: Optional[str] = None
    slugs: Optional[List[str]] = None

    kind: Optional[FolderKind] = None
    kinds: Optional[List[FolderKind]] = None

    parent_id: Optional[UUID] = None
    parent_ids: Optional[List[UUID]] = None

    path: Optional[str] = None
    paths: Optional[List[str]] = None

    glob: Optional[str] = None  # ltree glob / pattern (e.g., "*.foo")


class FolderNameInvalid(Exception):
    def __init__(
        self,
        message: str = (
            "Folder name contains invalid characters. Allowed characters are: "
            "letters and digits from any language, underscores (_), spaces, dots (.), and hyphens (-)."
        ),
    ):
        self.message = message

        super().__init__(message)
