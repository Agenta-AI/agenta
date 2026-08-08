from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from uuid import UUID

from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelInboundEvent,
    ChannelSpaceCandidate,
)


class ChannelAdapterInterface(ABC):
    """One platform, reached in process. A bridge is the same interface reached
    over the wire."""

    channel: str  # the registry key: "slack", "telegram"

    # --- declaration ---

    @abstractmethod
    async def fetch_capabilities(self) -> ChannelCapabilities:
        """Normalised by core, never trusted."""

    # --- ingress ---

    @abstractmethod
    async def verify_signature(self, *, headers: Dict[str, str], body: bytes) -> str:
        """Verify HMAC with timestamp replay protection; return the platform's own
        installation id. Verification and identification are one act — the caller
        maps that id to a connection. Raises ChannelSignatureInvalid.

        Where the payload also carries a self-asserted sender identity (a
        bridge's envelope `source`), that value is a cross-check against the
        id derived here, never a substitute for it: a mismatch must raise
        ChannelSignatureInvalid rather than resolve against the unverified
        value."""

    @abstractmethod
    async def parse_event(self, *, body: bytes) -> Optional[ChannelInboundEvent]:
        """Platform payload → the normalised event, or None for anything we do not
        act on (acks, bot echoes, platform noise). Carries `addressed`, which is
        the adapter's answer to trigger-or-fill: the adapter knows its own
        platform's addressing conventions and core does not."""

    # --- egress ---

    @abstractmethod
    async def post_message(
        self,
        *,
        connection: ChannelConnection,
        locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        """Post, and return the `external_locator` receipt — a structured object,
        not a bare id, since editing needs `(channel, ts)` on one platform and
        `(chat_id, message_id)` on another. Drop a command whose
        idempotency_key was already accepted; dedupe on that token and nothing
        else."""

    @abstractmethod
    async def edit_message(
        self,
        *,
        connection: ChannelConnection,
        external_locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        """Edit in place — the indicator becoming the answer. Offered only
        where the declaration says `rendering.controls.update`."""

    # --- discovery ---

    @abstractmethod
    async def discover_spaces(
        self, *, connection: ChannelConnection
    ) -> List[ChannelSpaceCandidate]:
        """Which places this install can actually see, so configuration is a
        pick-list rather than a paste-the-channel-id form. Returns
        candidates, not rows — nothing is persisted until an operator chooses."""

    # --- history ---

    @abstractmethod
    async def fetch_history(
        self, *, connection: ChannelConnection, locator: Dict[str, Any], limit: int
    ) -> List[ChannelInboundEvent]:
        """The one-time backfill. Called only where the declaration says
        `fill.backfill.supported`. A permission refusal raises rather than
        returning empty — an empty fetch is a legitimate result and the two must
        stay distinguishable."""
