"""Discord Gateway dispatches, shaped the way Discord sends them: the event
name in `t` and the event data in `d`."""

import json
from typing import Any, Dict, Optional

APPLICATION_ID = "1300000000000000001"
APPLICATION_NAME = "Support Bot"
BOT_USER_ID = "1300000000000000001"
BOT_USERNAME = "supportbot"
BOT_TOKEN = "fake-discord-bot-token-not-real"
GUILD_ID = "1100000000000000001"
CHANNEL_ID = "1100000000000000002"
CHANNEL_NAME = "support"
DM_CHANNEL_ID = "1100000000000000003"
THREAD_ID = "1200000000000000009"
BOT_ROLE_ID = "1100000000000000010"
OTHER_ROLE_ID = "1100000000000000011"
MESSAGE_ID = "1200000000000000001"
USER_ID = "1000000000000000001"

MESSAGE_CONTENT_FLAG = 1 << 18
MESSAGE_CONTENT_LIMITED_FLAG = 1 << 19

PERSON = {"id": USER_ID, "username": "kerry", "global_name": "Kerry Fisher"}
BOT_AUTHOR = {"id": BOT_USER_ID, "username": BOT_USERNAME, "bot": True}


def message(
    content: str = "Where is my order?",
    *,
    message_id: str = MESSAGE_ID,
    channel_id: str = CHANNEL_ID,
    guild_id: Optional[str] = GUILD_ID,
    author: Optional[Dict[str, Any]] = None,
    mentions_bot: bool = False,
    message_type: int = 0,
) -> Dict[str, Any]:
    data: Dict[str, Any] = {
        "id": message_id,
        "channel_id": channel_id,
        "type": message_type,
        "content": content,
        "author": author or PERSON,
        "timestamp": "2026-11-07T10:00:00.000000+00:00",
        "mentions": [BOT_AUTHOR] if mentions_bot else [],
    }
    if guild_id:
        data["guild_id"] = guild_id
        data["member"] = {"nick": None}
    return {"t": "MESSAGE_CREATE", "d": data}


def mention(text: str = "where is my order?", **kwargs) -> Dict[str, Any]:
    return message(f"<@{BOT_USER_ID}> {text}", mentions_bot=True, **kwargs)


def role_mention(
    text: str = "where is my order?", *, role_id: str = BOT_ROLE_ID, **kwargs
) -> Dict[str, Any]:
    payload = message(f"<@&{role_id}> {text}", **kwargs)
    payload["d"]["mention_roles"] = [role_id]
    return payload


def dm(content: str = "Where is my order?", **kwargs) -> Dict[str, Any]:
    return message(content, channel_id=DM_CHANNEL_ID, guild_id=None, **kwargs)


def in_thread(content: str, **kwargs) -> Dict[str, Any]:
    return message(content, channel_id=THREAD_ID, **kwargs)


def click(
    custom_id: str,
    *,
    interaction_id: str = "1400000000000000001",
    message_id: str = "1300000000000000555",
    channel: Optional[Dict[str, Any]] = None,
    guild_id: Optional[str] = GUILD_ID,
) -> Dict[str, Any]:
    channel = channel or {
        "id": THREAD_ID,
        "type": 11,
        "parent_id": CHANNEL_ID,
        "guild_id": GUILD_ID,
    }
    data: Dict[str, Any] = {
        "id": interaction_id,
        "application_id": APPLICATION_ID,
        "type": 3,
        "token": "fake-interaction-token",
        "data": {"custom_id": custom_id, "component_type": 2},
        "channel_id": channel["id"],
        "channel": channel,
        "message": {"id": message_id, "channel_id": channel["id"]},
    }
    if guild_id:
        data["guild_id"] = guild_id
        data["member"] = {"user": PERSON}
    else:
        data["user"] = PERSON
    return {"t": "INTERACTION_CREATE", "d": data}


def encode(payload: Dict[str, Any]) -> bytes:
    return json.dumps(payload).encode()
