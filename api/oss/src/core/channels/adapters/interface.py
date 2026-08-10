from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from uuid import UUID

from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelInboundEvent,
    ChannelRequestContext,
    ChannelSpaceCandidate,
)


class ChannelAdapterInterface(ABC):
    """One platform, reached in process. A bridge is the same interface reached
    over the wire."""

    channel: str  # the registry key: "slack", "telegram"

    # --- declaration ---

    @abstractmethod
    async def fetch_capabilities(
        self, *, connection: Optional[ChannelConnection] = None
    ) -> ChannelCapabilities:
        """Normalised by core, never trusted. A channel with one fixed
        declaration ignores `connection`; one whose declaration varies by
        installation reads it."""

    # --- ingress ---

    @abstractmethod
    def connection_locator(
        self, *, request: ChannelRequestContext
    ) -> Optional[Dict[str, Any]]:
        """The connection this request claims to come from, read without any
        secret. Returns the platform's own fields; core composes the key.

        Unverified and untrusted: it only selects which credential the
        signature is then checked with. A wrong or forged locator resolves to
        no connection, or to one whose credential fails — refused either way,
        so the signature stays the only thing that decides.

        Abstract rather than defaulted: returning None here means the ingress
        resolves no connection and refuses every event for that channel,
        which is silent. An adapter must say what its claim is, even if it is
        fixed.
        """

    @abstractmethod
    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        """Prove the caller may speak for this connection, and return the id
        it speaks for. Verification and identification are one act — the
        caller maps that id to a connection. Raises ChannelSignatureInvalid.

        Not intrinsically HMAC: an API key validated against its owner
        satisfies this the same way a signing secret does.

        Where the payload also carries a self-asserted sender identity (a
        bridge's envelope `source`), that value is a cross-check against the
        id derived here, never a substitute for it: a mismatch must raise
        ChannelSignatureInvalid rather than resolve against the unverified
        value."""

    @abstractmethod
    async def parse_event(
        self, *, body: bytes, connection: Optional[ChannelConnection] = None
    ) -> Optional[ChannelInboundEvent]:
        """Platform payload → the normalised event, or None for anything we do not
        act on (acks, bot echoes, platform noise). Carries `addressed`, which is
        the adapter's answer to trigger-or-fill: the adapter knows its own
        platform's addressing conventions and core does not.

        `connection` is available for adapters that need one of its own
        fields to parse correctly (Slack's bot user id, for bot-echo
        filtering); ignored where nothing in the parse depends on it."""

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
