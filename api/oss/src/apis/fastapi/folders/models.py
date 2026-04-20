from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, Field
from fastapi import HTTPException

from oss.src.core.folders.types import (
    Folder,
    FolderCreate,
    FolderEdit,
    FolderQuery,
)


class FolderCreateRequest(BaseModel):
    folder: FolderCreate = Field(
        ...,
        description="Folder to create. `slug` is required; `parent_id` nests the new folder under an existing one.",
    )


class FolderEditRequest(BaseModel):
    folder: FolderEdit = Field(
        ...,
        description="Folder edit payload. `id` must match the path parameter. Only fields present in the payload are changed.",
    )


class FolderQueryRequest(BaseModel):
    folder: FolderQuery = Field(
        ...,
        description="Filter object. Any combination of `id`/`ids`, `slug`/`slugs`, `kind`/`kinds`, `parent_id`/`parent_ids`, `path`/`paths`, and `prefix`/`prefixes` narrows the result.",
    )


class FolderResponse(BaseModel):
    count: int = Field(
        default=0,
        description="Number of folders returned (`0` or `1`).",
    )
    folder: Optional[Folder] = Field(
        default=None,
        description="The folder, when found. Omitted when `count` is `0`.",
    )


class FoldersResponse(BaseModel):
    count: int = Field(
        default=0,
        description="Number of folders in `folders`.",
    )
    folders: List[Folder] = Field(
        default_factory=list,
        description="Matching folders for the query. Ordering is not guaranteed.",
    )


class FolderIdResponse(BaseModel):
    count: int = Field(
        default=0,
        description="`1` if a folder was deleted, `0` if no folder matched.",
    )
    id: Optional[UUID] = Field(
        default=None,
        description="Id of the deleted folder. Omitted when nothing was deleted.",
    )


class FolderNameInvalidException(HTTPException):
    """Exception raised when a folder name is invalid."""

    def __init__(
        self,
        message: str = "Folder name contains invalid characters.",
    ):
        super().__init__(status_code=400, detail=message)


class FolderPathConflictException(HTTPException):
    """Exception raised when a folder path already exists in the project."""

    def __init__(
        self,
        message: str = "A folder with this path already exists in this project.",
    ):
        super().__init__(status_code=409, detail=message)


class FolderParentMissingException(HTTPException):
    """Exception raised when a parent folder is not found."""

    def __init__(
        self,
        message: str = "Parent folder not found.",
    ):
        super().__init__(status_code=404, detail=message)


class FolderPathDepthExceededException(HTTPException):
    """Exception raised when folder path depth exceeds maximum allowed nesting level."""

    def __init__(
        self,
        message: str = "Folder path depth exceeds maximum allowed nesting level (10 levels).",
    ):
        super().__init__(status_code=400, detail=message)


class FolderPathLengthExceededException(HTTPException):
    """Exception raised when folder slug/path is too long."""

    def __init__(
        self,
        message: str = "Folder slug exceeds maximum length (64 characters).",
    ):
        super().__init__(status_code=400, detail=message)
