from abc import ABC, abstractmethod
from typing import Any, Dict, List, Literal, Optional, Tuple, Union
from uuid import UUID

from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelHistoryPage,
    ChannelInboundEvent,
    ChannelRequestContext,
    ChannelSetupDoc,
    ChannelSetupIdentity,
    ChannelSpaceCandidate,
)
from oss.src.core.channels.types import ChannelNotSupported


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

    # --- setup ---

    async def build_setup_document(
        self,
        *,
        request_url: str,
        identity: Optional[ChannelSetupIdentity] = None,
    ) -> Optional[ChannelSetupDoc]:
        """What we generate for the operator to apply — a manifest, a
        package, whatever the platform's setup form takes. Defaults to
        nothing: a channel with no document to generate answers with none,
        the same discipline as an empty capability slot. `identity` is how
        the app built from the document presents itself; a document that
        names nothing ignores it."""

        return None

    async def verify_connection(
        self,
        *,
        connection: ChannelConnectionCreate,
        credentials: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Prove the credential works, and return what it discovered — the
        fields a human should not have to type because the platform will
        hand them back. Defaults to trivial success: a channel with nothing
        to verify verifies by declaring nothing.

        Called before any row is written; a raised exception here means
        nothing is stored. Where the platform's own setup call WRITES
        (Telegram's `setWebhook`, not built yet) the order has to invert —
        store, call, verify — so nothing is left pointing at a row that does
        not exist; this default assumes a read-only check."""

        return {}

    def hosted_setup_available(self) -> bool:
        """True when this deployment offers a one-click, Agenta-owned
        install for this channel. Defaults to false: a channel with no
        hosted app never shows the install option."""

        return False

    async def activate_connection(
        self,
        *,
        connection: ChannelConnection,
        credentials: Dict[str, Any],
    ) -> None:
        """Run any platform setup call that WRITES, after the row is stored.

        This is the inverted half of verify_connection: `verify_connection`
        proves a credential before anything is written, and this registers the
        connection with the platform once the row exists. Telegram's setWebhook
        lives here — it points the bot at our per-bot ingress URL, so it must
        run only after the row (and its stored secret) exist to receive the
        first update. `credentials` carries the plaintext the create path still
        holds, since the stored row keeps only a vault reference; the public
        ingress URL is a deployment fact the adapter reads for itself.
        Defaults to nothing: a channel with no write-time setup does nothing
        here."""

        return None

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
    ) -> Union[None, ChannelInboundEvent, List[ChannelInboundEvent]]:
        """Platform payload → the normalised event, or None for anything we do not
        act on (acks, bot echoes, platform noise). A platform that batches
        several messages in one delivery (WhatsApp) returns a list, one event
        per message. Carries `addressed`, which is
        the adapter's answer to trigger-or-fill: the adapter knows its own
        platform's addressing conventions and core does not.

        `connection` is available for adapters that need one of its own
        fields to parse correctly (Slack's bot user id, for bot-echo
        filtering); ignored where nothing in the parse depends on it."""

    async def detect_deactivation(self, *, body: bytes) -> bool:
        """True when this inbound payload is the platform telling us an
        installation stopped, not a message to route (Slack's
        `app_uninstalled` / `tokens_revoked`). Defaults to false: a channel
        with no such signal is never deactivated from the inside."""

        return False

    async def revoke_installation(
        self, *, connection: ChannelConnection
    ) -> Optional[str]:
        """Best-effort revoke on the platform's side when we own the app,
        called on removal from ours. Returns the notice to show the operator
        in place of the generic one, or None to leave the generic wording —
        the branch on "do we own this app" stays inside the adapter that
        knows it; the caller never learns the word "hosted"."""

        return None

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

    async def dismiss_choices(
        self,
        *,
        connection: ChannelConnection,
        external_locator: Dict[str, Any],
        content: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        """Remove resolved message controls without changing the message text.
        `content` is the message as it was posted, for platforms (Slack) that
        can only drop buttons by re-sending the rest of the message."""
        return None

    async def set_message_status(
        self,
        *,
        connection: ChannelConnection,
        locator: Dict[str, Any],
        status: Literal["received", "completed", "failed"],
    ) -> None:
        """Optional, best-effort status on the original request, not the reply."""
        return None

    async def signal_activity(
        self,
        *,
        connection: ChannelConnection,
        locator: Dict[str, Any],
    ) -> None:
        """The platform's own "the bot is working" signal (Telegram's typing
        action), sent again every few seconds while a turn runs. Best-effort
        and optional: a platform without one leaves this a no-op."""

        return None

    async def reopen_conversation(
        self,
        *,
        connection: ChannelConnection,
        locator: Dict[str, Any],
    ) -> bool:
        """Ask the person to come back after a reply was held because the
        platform's reply window closed (WhatsApp's re-open template). True
        when something was sent. Defaults to sending nothing."""

        return False

    async def fetch_media(
        self,
        *,
        connection: ChannelConnection,
        media: Dict[str, Any],
        max_bytes: Optional[int] = None,
    ) -> Optional[Tuple[bytes, Optional[str]]]:
        """Download an inbound file named by a `media` content part, as
        `(bytes, media type)`. None when it is larger than `max_bytes`.
        Defaults to None: a channel that never emits media parts."""

        return None

    # --- discovery ---

    @abstractmethod
    async def discover_spaces(
        self, *, connection: ChannelConnection
    ) -> List[ChannelSpaceCandidate]:
        """Which places this install can actually see, so configuration is a
        pick-list rather than a paste-the-channel-id form. Returns
        candidates, not rows — nothing is persisted until an operator chooses."""

    async def list_member_spaces(
        self, *, connection: ChannelConnection
    ) -> List[ChannelSpaceCandidate]:
        """The channels the bot is a member of, for the agent's destination
        list. Group conversations only: never direct messages or group DMs.
        Raises ChannelNotSupported where the platform cannot list them
        (a Telegram bot cannot list its chats)."""

        raise ChannelNotSupported(channel=self.channel)

    async def join_space(
        self, *, connection: ChannelConnection, locator: Dict[str, Any]
    ) -> None:
        """Put the bot in the space being added, before its row is written.
        Raises ChannelSpaceJoinFailed with a message the operator can act on.
        Defaults to nothing: a channel whose bot is already wherever it can
        be discovered has nothing to join."""

        return None

    # --- history ---

    @abstractmethod
    async def fetch_history(
        self, *, connection: ChannelConnection, locator: Dict[str, Any], limit: int
    ) -> List[ChannelInboundEvent]:
        """The one-time backfill. Called only where the declaration says
        `fill.backfill.supported`. A permission refusal raises rather than
        returning empty — an empty fetch is a legitimate result and the two must
        stay distinguishable."""

    async def read_history(
        self,
        *,
        connection: ChannelConnection,
        locator: Dict[str, Any],
        thread_ts: Optional[str] = None,
        latest: Optional[str] = None,
        cursor: Optional[str] = None,
        limit: int,
    ) -> ChannelHistoryPage:
        """One live history page for the channel read tool, oldest first.
        A channel page holds the newest messages strictly before `latest`; a
        thread page (`thread_ts`) holds the root and replies from the start,
        paging forward with `cursor`. Nothing is stored. Raises
        ChannelRateLimited when the platform says to wait, and
        ChannelNotSupported where bots cannot read history (Telegram)."""

        raise ChannelNotSupported(channel=self.channel)
