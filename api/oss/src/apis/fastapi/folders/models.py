from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel
from fastapi import HTTPException

from oss.src.core.folders.types import (
    Folder,
    FolderCreate,
    FolderEdit,
    FolderQuery,
)


class FolderCreateRequest(BaseModel):
    folder: FolderCreate


class FolderEditRequest(BaseModel):
    folder: FolderEdit


class FolderQueryRequest(BaseModel):
    folder: FolderQuery


class FolderResponse(BaseModel):
    count: int = 0
    folder: Optional[Folder] = None


class FoldersResponse(BaseModel):
    count: int = 0
    folders: List[Folder] = []


class FolderIdResponse(BaseModel):
    count: int = 0
    id: Optional[UUID] = None


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
