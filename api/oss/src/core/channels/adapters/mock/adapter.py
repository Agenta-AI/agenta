"""`MockAdapter` — `ChannelAdapterInterface` for a channel that does not
exist. Declares whatever capability set it is constructed with, records what
it is told to post, and replays a scripted inbound queue. No credentials, no
workspace, no network, no clock: every varying value is a constructor
parameter, so a test asserting a receipt or an idempotency key gets the same
value every run.
"""

from typing import Any, Dict, List, Optional
from uuid import UUID

from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.adapters.mock.capabilities import (
    DEFAULT_SIGNATURE_HEADER,
    DEFAULT_SIGNATURE_VALUE,
    full,
)
from oss.src.core.channels.adapters.mock.script import PostRecorder, ScriptedEvents
from oss.src.core.channels.adapters.slack.adapter import ChannelBackfillRefused
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelInboundEvent,
    ChannelRequestContext,
    ChannelSpaceCandidate,
)
from oss.src.core.channels.types import ChannelSignatureInvalid

# Same installation id on every run — verify_signature identifies as well as
# verifies, and a test asserting on it must get a fixed value.
DEFAULT_INSTALLATION_ID = "mock-installation"


class MockAdapter(ChannelAdapterInterface):
    """One class, any declared shape: the constructor's `capabilities` is
    returned verbatim by `fetch_capabilities`, so `full()`, `no_threads()`,
    `no_buttons()`, `no_history()` and `declare(...)` all construct the same
    adapter type."""

    channel = "mock"

    def __init__(
        self,
        *,
        capabilities: Optional[ChannelCapabilities] = None,
        script: Optional[ScriptedEvents] = None,
        recorder: Optional[PostRecorder] = None,
        signature_header: str = DEFAULT_SIGNATURE_HEADER,
        signature_value: str = DEFAULT_SIGNATURE_VALUE,
        installation_id: str = DEFAULT_INSTALLATION_ID,
        discoverable_spaces: Optional[List[ChannelSpaceCandidate]] = None,
        history: Optional[List[ChannelInboundEvent]] = None,
    ) -> None:
        self._capabilities = capabilities or full()
        self._script = script if script is not None else ScriptedEvents()
        self._recorder = recorder if recorder is not None else PostRecorder()
        self._signature_header = signature_header
        self._signature_value = signature_value
        self._installation_id = installation_id
        self._discoverable_spaces = list(discoverable_spaces or [])
        self._history = list(history or [])
        self._next_receipt_id = 0

    # --- declaration --- #

    async def fetch_capabilities(
        self, *, connection: Optional[ChannelConnection] = None
    ) -> ChannelCapabilities:
        return self._capabilities

    # --- ingress --- #

    def connection_locator(
        self, *, request: ChannelRequestContext
    ) -> Optional[Dict[str, Any]]:
        # Fixed, like the id verification returns: this adapter has one install.
        return {"installation_id": self._installation_id}

    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        lowered = {k.lower(): v for k, v in request.headers.items()}
        if lowered.get(self._signature_header) != self._signature_value:
            raise ChannelSignatureInvalid(channel=self.channel)
        return self._installation_id

    async def parse_event(
        self, *, body: bytes, connection: Optional[ChannelConnection] = None
    ) -> Optional[ChannelInboundEvent]:
        return self._script.pop()

    # --- egress --- #

    async def post_message(
        self,
        *,
        connection: ChannelConnection,
        locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        rendered = self._render_for_declared_buttons(content)
        receipt = self._next_receipt()
        return self._recorder.record_post(
            locator=locator,
            content=rendered,
            idempotency_key=idempotency_key,
            receipt=receipt,
        )

    async def edit_message(
        self,
        *,
        connection: ChannelConnection,
        external_locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        rendered = self._render_for_declared_buttons(content)
        return self._recorder.record_edit(
            external_locator=external_locator,
            content=rendered,
            idempotency_key=idempotency_key,
        )

    # --- discovery --- #

    async def discover_spaces(
        self, *, connection: ChannelConnection
    ) -> List[ChannelSpaceCandidate]:
        return list(self._discoverable_spaces)

    # --- history --- #

    async def fetch_history(
        self, *, connection: ChannelConnection, locator: Dict[str, Any], limit: int
    ) -> List[ChannelInboundEvent]:
        if not self._capabilities.fill.backfill.supported:
            raise ChannelBackfillRefused(reason="mock declares no backfill support")
        return list(self._history[:limit]) if limit else list(self._history)

    # --- test seam (optional; mirrors the contract suite's own fake) --- #

    def inspect_posted(self, locator: Dict[str, Any]) -> List[Dict[str, Any]]:
        return self._recorder.inspect_posted(locator)

    # --- internals --- #

    def _next_receipt(self) -> Dict[str, Any]:
        self._next_receipt_id += 1
        return {"mock_id": str(self._next_receipt_id)}

    def _render_for_declared_buttons(
        self, content: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Buttons beyond the declared max degrade to numbered text, the same
        under-declaring-degrades rule `capabilities.md` states for a real
        renderer — never a silent truncation and never a platform-side
        rejection, since `mock` has no platform to reject on."""

        if not self._capabilities.rendering.buttons.supported:
            return [item for item in content if item.get("type") != "button"] + (
                [_numbered_text(content)] if _has_buttons(content) else []
            )

        buttons_max = self._capabilities.rendering.buttons.max
        buttons = [item for item in content if item.get("type") == "button"]
        if len(buttons) <= buttons_max:
            return list(content)

        return [item for item in content if item.get("type") != "button"] + [
            _numbered_text(content)
        ]


def _has_buttons(content: List[Dict[str, Any]]) -> bool:
    return any(item.get("type") == "button" for item in content)


def _numbered_text(content: List[Dict[str, Any]]) -> Dict[str, Any]:
    buttons = [item for item in content if item.get("type") == "button"]
    lines = [
        f"{i + 1}. {item.get('label', item.get('id', ''))}"
        for i, item in enumerate(buttons)
    ]
    return {"type": "text", "text": "\n".join(lines)}
