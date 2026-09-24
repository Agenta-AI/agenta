"""What the channel tools return to the model. No credential, provider id,
tenant id, or binding id appears here: destinations, threads, and messages
are the opaque references from `tools/ids.py`."""

from datetime import datetime
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


class ChannelSendResult(BaseModel):
    """`sent` only with the provider's acknowledgement; `unknown` when the post
    may have reached the chat without a receipt, which is never retried."""

    delivery_id: str
    state: Literal["sent", "failed", "unknown"]
    message_id: Optional[str] = None
    thread_id: Optional[str] = None
    reason: Optional[str] = None


class ChannelMessage(BaseModel):
    message_id: str
    thread_id: Optional[str] = None
    # omitted when only the platform's user id is known; never the raw id
    sender_name: Optional[str] = None
    from_bot: bool = False  # posted by the bot this agent speaks through
    text: str = ""
    sent_at: Optional[datetime] = None


class ChannelMessagesPage(BaseModel):
    messages: List[ChannelMessage] = Field(default_factory=list)
    # pages to older messages; None when there is nothing older to read
    cursor: Optional[str] = None
    notes: List[str] = Field(default_factory=list)
