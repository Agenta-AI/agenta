"""What the channel tools return to the model. No credential, provider id,
tenant id, or binding id appears here: destinations, threads, and messages
are the opaque references from `tools/ids.py`."""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class ChannelDestination(BaseModel):
    destination_id: str
    type: Literal["channel"] = "channel"
    platform: str
    name: Optional[str] = None
    can_post: bool
    can_read: bool
    can_search: bool
    supports_threads: bool


class ChannelDestinationsPage(BaseModel):
    destinations: List[ChannelDestination] = Field(default_factory=list)
    cursor: Optional[str] = None
    notes: List[str] = Field(default_factory=list)
