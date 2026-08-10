"""Fake adapters for the contract suite.

`WellBehavedFakeAdapter` is the default fixture other test modules can use.
The `Lying*` variants exist only to prove the contract suite has teeth —
nothing outside this suite should construct them.
"""

from copy import deepcopy
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelEventKind,
    ChannelInboundEvent,
    ChannelInboxEventProcessed,
    ChannelRequestContext,
    ChannelSpaceCandidate,
    ChannelSpaceKind,
)
from oss.src.core.channels.types import ChannelSignatureInvalid

VALID_SIGNATURE_HEADER = "x-fake-signature"
VALID_SIGNATURE_VALUE = "valid"
INSTALLATION_ID = "fake-installation"

# Two thread locators sharing team/channel but differing in thread_ts — the
# fixtures the identity contract-suite assertions compose keys from.
THREAD_LOCATOR_A = {"team": "T1", "channel": "C1", "thread_ts": "1000.1"}
THREAD_LOCATOR_B = {"team": "T1", "channel": "C1", "thread_ts": "2000.2"}
# Missing the declared thread_ts field entirely.
THREAD_LOCATOR_INCOMPLETE = {"team": "T1", "channel": "C1"}

_BASE_CAPABILITIES: Dict[str, Any] = {
    "channel": "fake",
    "protocol": {"versions": ["0.1.0"]},
    "addressing": {
        "sigils": {"agent": "~", "command": "!"},
        "mention": True,
        "commands": {"native": True, "in_conversation": False},
    },
    "spaces": {"private": True, "group": True, "topic": True},
    "conversation": {"units": ["thread", "space"], "default": "thread"},
    "fill": {
        "backfill": {"supported": True, "requires_permission": None},
        "forwardfill": {"supported": True, "requires_permission": None},
    },
    "rendering": {
        "controls": {"update": True, "ephemeral": True},
        "buttons": {"supported": True, "max": 5},
        "text": {"format": "markdown", "max_chars": 3000},
        "files": {
            "send": {"supported": True, "max_bytes": 1024},
            "receive": {"supported": True, "max_bytes": 1024},
        },
    },
    "identity": {
        "scope": "workspace",
        "stable": True,
        "keys": {
            "space": ["team", "channel"],
            "thread": ["team", "channel", "thread_ts"],
        },
    },
    "commands": ["new", "sessions", "use"],
}


def _connection() -> ChannelConnection:
    from oss.src.core.gateway.connections.dtos import ConnectionProviderKind

    return ChannelConnection(
        id=uuid4(),
        slug="fake-connection",
        provider_key=ConnectionProviderKind.AGENTA,
        integration_key="fake",
    )


class WellBehavedFakeAdapter(ChannelAdapterInterface):
    """An in-memory adapter that actually does what it declares.

    Tracks posted/edited messages keyed by a fake locator, enforces its own
    `buttons.max` by rejecting an over-long request, and edits in place when
    given a locator it already holds.
    """

    channel = "fake"

    def __init__(self, *, capabilities_override: Optional[Dict[str, Any]] = None):
        self._capabilities = deepcopy(_BASE_CAPABILITIES)
        if capabilities_override:
            self._capabilities.update(capabilities_override)
        # locator-string -> stored message state
        self._messages: Dict[str, Dict[str, Any]] = {}
        self._next_id = 0

    async def fetch_capabilities(
        self, *, connection: Optional[ChannelConnection] = None
    ) -> ChannelCapabilities:
        return ChannelCapabilities.model_validate(self._capabilities)

    def connection_locator(
        self, *, request: ChannelRequestContext
    ) -> Optional[Dict[str, Any]]:
        return {"installation_id": INSTALLATION_ID}

    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        if request.headers.get(VALID_SIGNATURE_HEADER) != VALID_SIGNATURE_VALUE:
            raise ChannelSignatureInvalid(channel=self.channel)
        return INSTALLATION_ID

    async def parse_event(
        self, *, body: bytes, connection: Optional[ChannelConnection] = None
    ) -> Optional[ChannelInboundEvent]:
        if body == b"ignore-me":
            return None

        return ChannelInboundEvent(
            external_id="fake-event-1",
            kind=ChannelEventKind.MESSAGE,
            space_kind=ChannelSpaceKind.TOPIC,
            external_locator=THREAD_LOCATOR_A,
            processed=ChannelInboxEventProcessed(
                content=[{"type": "text", "text": body.decode() if body else ""}],
                sender={"id": "U1"},
            ),
            addressed=True,
        )

    async def post_message(
        self,
        *,
        connection: ChannelConnection,
        locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        buttons_max = self._capabilities["rendering"]["buttons"]["max"]
        n_buttons = sum(1 for item in content if item.get("type") == "button")
        if n_buttons > buttons_max:
            raise ValueError(
                f"buttons.max={buttons_max} exceeded: got {n_buttons} buttons"
            )

        self._next_id += 1
        new_locator = {"message_id": str(self._next_id)}
        key = _locator_key(new_locator)
        self._messages[key] = {"content": content, "locator": new_locator}
        return new_locator

    async def edit_message(
        self,
        *,
        connection: ChannelConnection,
        external_locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        key = _locator_key(external_locator)
        if key not in self._messages:
            raise KeyError(f"no such message: {external_locator}")

        self._messages[key]["content"] = content
        return self._messages[key]["locator"]

    async def discover_spaces(
        self, *, connection: ChannelConnection
    ) -> List[ChannelSpaceCandidate]:
        return [
            ChannelSpaceCandidate(
                kind=ChannelSpaceKind.TOPIC,
                external_locator={"team": "T1", "channel": "C1"},
                display_name="#fake",
            )
        ]

    async def fetch_history(
        self, *, connection: ChannelConnection, locator: Dict[str, Any], limit: int
    ) -> List[ChannelInboundEvent]:
        return []

    def inspect_posted(self, locator: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Test-only seam, not part of the port: what content is actually
        stored under a receipt. Lets the contract suite check truncation
        rather than only "accepted or rejected"."""

        return self._messages[_locator_key(locator)]["content"]


class LyingEditAdapter(WellBehavedFakeAdapter):
    """Declares `rendering.controls.update: true` but `edit_message` always
    posts a new message instead of editing — the silent-no-op failure mode.
    """

    async def edit_message(
        self,
        *,
        connection: ChannelConnection,
        external_locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        self._next_id += 1
        new_locator = {"message_id": str(self._next_id)}
        key = _locator_key(new_locator)
        self._messages[key] = {"content": content, "locator": new_locator}
        return new_locator


class LyingButtonsAdapter(WellBehavedFakeAdapter):
    """Declares `rendering.buttons.max: 5` but accepts a 6th button without
    truncating or rejecting."""

    async def post_message(
        self,
        *,
        connection: ChannelConnection,
        locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        self._next_id += 1
        new_locator = {"message_id": str(self._next_id)}
        key = _locator_key(new_locator)
        self._messages[key] = {"content": content, "locator": new_locator}
        return new_locator


class LyingIdentityKeysAdapter(WellBehavedFakeAdapter):
    """Declares `identity.keys["thread"] = ["team", "channel"]`, omitting
    `thread_ts` — the too-small declared field set. Against fixture locators
    that vary only in `thread_ts`, this collapses two distinct threads onto
    one key."""

    def __init__(self):
        super().__init__(
            capabilities_override={
                "identity": {
                    "scope": "workspace",
                    "stable": True,
                    "keys": {
                        "space": ["team", "channel"],
                        "thread": ["team", "channel"],
                    },
                }
            }
        )


def _locator_key(locator: Dict[str, Any]) -> str:
    return "|".join(f"{k}={v}" for k, v in sorted(locator.items()))
