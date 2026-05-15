from typing import Optional, List, Union
from enum import Enum
from uuid import UUID

from pydantic import Field

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
    kind: Optional[FolderKind] = Field(
        default=None,
        description="Resource family this folder organizes. Only `applications` is defined today, and it also covers workflows, evaluators, and testsets (they share the artifact table).",
    )

    path: Optional[str] = Field(
        default=None,
        description="Dot-separated materialized path built from the folder's slug and its ancestors' slugs. Read-only; derived by the server.",
    )

    parent_id: Optional[UUID] = Field(
        default=None,
        description="Id of the parent folder, or `null` for a root folder.",
    )


class FolderCreate(Slug, Header, Metadata):
    kind: Optional[FolderKind] = Field(
        default=None,
        description="Resource family the folder organizes. Defaults to `applications` when omitted.",
    )

    parent_id: Optional[UUID] = Field(
        default=None,
        description="Id of the parent folder. Omit or set to `null` to create a root folder.",
    )


class FolderEdit(Identifier, Slug, Header, Metadata):
    kind: Optional[FolderKind] = Field(
        default=None,
        description="Resource family. Must match the current folder's kind; defaults to `applications`.",
    )

    parent_id: Optional[UUID] = Field(
        default=None,
        description="New parent folder id. Include the key with a `null` value to move the folder to the root; omit the key to keep the existing parent.",
    )


class FolderQuery(Header, Metadata):
    # scope
    id: Optional[UUID] = Field(
        default=None,
        description="Match a single folder id.",
    )
    ids: Optional[List[UUID]] = Field(
        default=None,
        description="Match any of the given folder ids.",
    )

    slug: Optional[str] = Field(
        default=None,
        description="Match a folder by slug, regardless of its position in the tree.",
    )
    slugs: Optional[List[str]] = Field(
        default=None,
        description="Match folders whose slug is in the given list.",
    )

    kind: Optional[FolderKind] = Field(
        default=None,
        description="Match folders of a single resource family.",
    )
    # kinds filter supports: bool (False=is None, True=is not None) or list of FolderKind values
    kinds: Optional[Union[bool, List[FolderKind]]] = Field(
        default=None,
        description="Filter by presence of a kind. `false` returns folders with no kind, `true` returns folders where `kind` is set, and an array restricts to the given kinds.",
    )

    parent_id: Optional[UUID] = Field(
        default=None,
        description="Match folders whose parent is this id. Send `null` to return only root folders.",
    )
    parent_ids: Optional[List[UUID]] = Field(
        default=None,
        description="Match folders whose parent is any of the given ids.",
    )

    path: Optional[str] = Field(
        default=None,
        description="Exact match on the materialized `path` (e.g. `support.prod`).",
    )
    paths: Optional[List[str]] = Field(
        default=None,
        description="Exact match on any of the given paths.",
    )

    prefix: Optional[str] = Field(
        default=None,
        description="Subtree lookup: returns the folder at this path and every descendant.",
    )
    prefixes: Optional[List[str]] = Field(
        default=None,
        description="Subtree lookup across multiple prefixes, OR-ed together.",
    )


class FolderNameInvalid(Exception):
    def __init__(
        self,
        message: str = (
            "Folder name contains invalid characters. Allowed characters are: "
            "letters and digits from any language, underscores (_), spaces, and hyphens (-)."
        ),
    ):
        self.message = message

        super().__init__(message)


class FolderPathConflict(Exception):
    def __init__(
        self,
        message: str = "A folder with this path already exists in this project.",
    ):
        self.message = message

        super().__init__(message)


class FolderParentMissing(Exception):
    def __init__(
        self,
        message: str = "Parent folder not found.",
    ):
        self.message = message

        super().__init__(message)


class FolderPathDepthExceeded(Exception):
    def __init__(
        self,
        message: str = "Folder path depth exceeds maximum allowed nesting level (10 levels).",
    ):
        self.message = message

        super().__init__(message)


class FolderPathLengthExceeded(Exception):
    def __init__(
        self,
        message: str = "Folder slug exceeds maximum length (64 characters).",
    ):
        self.message = message

        super().__init__(message)
