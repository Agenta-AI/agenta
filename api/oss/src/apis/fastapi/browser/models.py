from typing import Optional

from pydantic import BaseModel


class BrowserLiveStatusRequest(BaseModel):
    session_id: str


class BrowserLiveStatusResponse(BaseModel):
    running: bool
    # The reason the agent gave `wait`; absent when it is not waiting for the person.
    wait_reason: Optional[str] = None
    url: Optional[str] = None
    title: Optional[str] = None
