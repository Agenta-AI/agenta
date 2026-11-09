"""Teams activities in the shapes Microsoft documents, with fixed test ids."""

import json
from typing import Any, Dict, List, Optional
from uuid import uuid4

from oss.src.core.channels.dtos import ChannelConnection

APP_ID = "0e5c5b8a-1f6b-4b9c-9d27-3f8b8f4a1c11"
TENANT_ID = "6a1d2c3b-4e5f-4a7b-8c9d-0e1f2a3b4c5d"
OTHER_TENANT_ID = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a"
USER_OBJECT_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f"
CLIENT_SECRET = "test-fixture-teams-client-secret-not-real"
SERVICE_URL = "https://smba.trafficmanager.net/amer/"

PERSONAL_CONVERSATION = "a:1qhNLqT3stPersonalChat"
GROUP_CONVERSATION = "19:testgroupchat@thread.v2"
CHANNEL_CONVERSATION = "19:testchannel@thread.tacv2"


def connection(**data: Any) -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug="teams-test",
        channel="teams",
        external_key=uuid4(),
        data={
            "connection_locator": {"app_id": APP_ID},
            "tenant_id": TENANT_ID,
            "client_secret": CLIENT_SECRET,
            **data,
        },
    )


def bot_mention(name: str = "Helper") -> Dict[str, Any]:
    return {
        "type": "mention",
        "text": f"<at>{name}</at>",
        "mentioned": {"id": f"28:{APP_ID}", "name": name},
    }


def message(
    *,
    text: str = "hello",
    conversation_type: str = "personal",
    conversation_id: str = PERSONAL_CONVERSATION,
    activity_id: str = "1700000000001",
    entities: Optional[List[Dict[str, Any]]] = None,
    tenant_id: str = TENANT_ID,
    sender: Optional[Dict[str, Any]] = None,
    **extra: Any,
) -> Dict[str, Any]:
    activity: Dict[str, Any] = {
        "type": "message",
        "id": activity_id,
        "timestamp": "2026-11-09T10:15:30.1234567Z",
        "serviceUrl": SERVICE_URL,
        "channelId": "msteams",
        "from": sender
        if sender is not None
        else {"id": "29:1abcUserTeamsId", "name": "Ada", "aadObjectId": USER_OBJECT_ID},
        "conversation": {
            "id": conversation_id,
            "conversationType": conversation_type,
            "tenantId": tenant_id,
        },
        "recipient": {"id": f"28:{APP_ID}", "name": "Helper"},
        "text": text,
        "entities": entities or [],
        "channelData": {"tenant": {"id": tenant_id}},
    }
    activity.update(extra)
    return activity


def channel_message(
    *,
    text: str,
    activity_id: str = "1700000000222",
    root: Optional[str] = None,
    **extra,
) -> Dict[str, Any]:
    conversation_id = CHANNEL_CONVERSATION
    if root:
        conversation_id = f"{CHANNEL_CONVERSATION};messageid={root}"
    activity = message(
        text=text,
        conversation_type="channel",
        conversation_id=conversation_id,
        activity_id=activity_id,
        **extra,
    )
    activity["channelData"]["channel"] = {"id": CHANNEL_CONVERSATION, "name": "General"}
    activity["channelData"]["team"] = {"id": "19:testteam@thread.tacv2"}
    return activity


def card_click(
    *, token: str, card_id: str = "1700000000555", activity_id: str = "1700000000556"
) -> Dict[str, Any]:
    activity = message(activity_id=activity_id, replyToId=card_id)
    activity.pop("text")
    activity["value"] = {"choice_token": token}
    return activity


def encode(activity: Dict[str, Any]) -> bytes:
    return json.dumps(activity).encode()
