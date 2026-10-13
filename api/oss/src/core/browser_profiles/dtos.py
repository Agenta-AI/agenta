from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

# A login names a few sites; every one is sent to each browser setup and joins the run's allowlist.
MAX_PROFILE_NAME_CHARS = 200
MAX_PROFILE_HOSTS = 20


class BrowserProfileState(str, Enum):
    PENDING_LOGIN = "pending_login"
    READY = "ready"


class BrowserScope(str, Enum):
    SESSION = "session"
    LOGIN = "login"


class BrowserProfile(BaseModel):
    id: UUID
    name: str
    allowed_hosts: List[str]
    state: BrowserProfileState
    generation: int

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by_id: Optional[UUID] = None


class BrowserProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_PROFILE_NAME_CHARS)
    allowed_hosts: List[str] = Field(min_length=1, max_length=MAX_PROFILE_HOSTS)


class BrowserProfileEdit(BaseModel):
    name: Optional[str] = Field(
        default=None, min_length=1, max_length=MAX_PROFILE_NAME_CHARS
    )
    allowed_hosts: Optional[List[str]] = Field(
        default=None, min_length=1, max_length=MAX_PROFILE_HOSTS
    )


class BrowserSessionState(BaseModel):
    """The decrypted storage state of a profile and the generation it belongs to."""

    storage_state: Optional[Dict[str, Any]] = None
    generation: int


class BrowserSandbox(BaseModel):
    """`label` is a login browser's profile id, or `session_label(user)` of a session browser."""

    sandbox_id: str
    url: str
    headers: Dict[str, str]
    label: str


class BrowserLiveStatus(BaseModel):
    running: bool


class BrowserOpResult(BaseModel):
    text: str = ""
    state_dirty: bool = False


class BrowserControllerState(BaseModel):
    """`generation` echoes setup: an int for a login browser, `{profile_id: int}` for a session."""

    storage_state: Dict[str, Any]
    generation: Any
