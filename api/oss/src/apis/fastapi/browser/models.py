from typing import Optional

from pydantic import BaseModel


class BrowserLiveStatusRequest(BaseModel):
    session_id: str


class BrowserLiveStatusResponse(BaseModel):
    running: bool
    # The agent's ask while it waits for the person; absent when it is not waiting.
    waiting: Optional[str] = None
    url: Optional[str] = None
    title: Optional[str] = None
