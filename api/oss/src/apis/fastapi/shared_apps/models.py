from typing import Dict, Literal, Optional

from pydantic import BaseModel, Field


class SharedAppViewer(BaseModel):
    """Who is looking, so the page picks its header. Never a permission by itself."""

    role: Literal["anonymous", "member", "project_member", "editor"]
    is_owner: bool = False
    can_open_session: bool = False
    session_id: Optional[str] = None
    workspace_id: Optional[str] = None
    project_id: Optional[str] = None
    mount_id: Optional[str] = None
    app_path: Optional[str] = None


class SharedAppFile(BaseModel):
    content_type: str
    size: int
    # Base64 of the file's bytes.
    data: str


class SharedAppStreamError(BaseModel):
    """Set when a file failed to read after the response started."""

    code: str
    message: str


class SharedAppResponse(BaseModel):
    """A shared app, content included: one request and one access check."""

    name: str
    entry: str
    kit: bool = True
    visibility: Literal["workspace", "link"]
    author_name: Optional[str] = None
    viewer: SharedAppViewer
    # entry key ("file:<path>" | "url:<url>") -> reference as written -> {"file"|"url": target}
    refs: Dict[str, Dict[str, Dict[str, str]]] = Field(default_factory=dict)
    files: Dict[str, SharedAppFile] = Field(default_factory=dict)
    external: Dict[str, SharedAppFile] = Field(default_factory=dict)
    error: Optional[SharedAppStreamError] = None
