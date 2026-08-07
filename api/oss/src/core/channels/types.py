from typing import Optional
from uuid import UUID

from oss.src.core.channels.dtos import ChannelPolicyLevel


class ChannelsError(Exception):
    """Base exception for the channels domain."""

    def __init__(self, message: str = "Channels error"):
        self.message = message
        super().__init__(self.message)


class ChannelNotSupported(ChannelsError):
    """Raised when a channel key has no registered adapter."""

    def __init__(self, *, channel: str):
        self.channel = channel
        super().__init__(f"Channel not supported: {channel}")


class ChannelSpaceNotFound(ChannelsError):
    def __init__(
        self,
        *,
        space_id: Optional[UUID] = None,
        external_key: Optional[UUID] = None,
    ):
        self.space_id = space_id
        self.external_key = external_key
        super().__init__(f"Channel space not found: {space_id or external_key}")


class ChannelLocatorIncomplete(ChannelsError):
    """A declared key field is missing from the locator. Raised rather than
    composing over what is present, which would key a different conversation."""

    def __init__(self, *, channel: str, grain: str, missing: str):
        self.channel = channel
        self.grain = grain
        self.missing = missing
        super().__init__(
            f"Locator for {channel} is missing declared {grain} key field: {missing}"
        )


class ChannelAgentNotFound(ChannelsError):
    def __init__(
        self,
        *,
        agent_id: Optional[UUID] = None,
        slug: Optional[str] = None,
    ):
        self.agent_id = agent_id
        self.slug = slug
        super().__init__(f"Channel agent not found: {agent_id or slug}")


class ChannelAgentNotGranted(ChannelsError):
    """Raised when an agent has grants, but none for this space."""

    def __init__(self, *, agent_id: UUID, space_id: UUID):
        self.agent_id = agent_id
        self.space_id = space_id
        super().__init__(f"Agent {agent_id} is not granted in space {space_id}")


class ChannelThreadNotFound(ChannelsError):
    def __init__(self, *, thread_id: UUID):
        self.thread_id = thread_id
        super().__init__(f"Channel thread not found: {thread_id}")


class ChannelSignatureInvalid(ChannelsError):
    """Raised when ingress HMAC verification fails. Carries no detail on purpose."""

    def __init__(self, *, channel: str):
        self.channel = channel
        super().__init__(f"Invalid signature for channel: {channel}")


class ChannelConnectionNotFound(ChannelsError):
    def __init__(self, *, connection_id: UUID):
        self.connection_id = connection_id
        super().__init__(f"Connection not found: {connection_id}")


class ChannelPolicyDenied(ChannelsError):
    """Raised when the effective policy forbids what was asked."""

    def __init__(self, *, field: str, level: ChannelPolicyLevel):
        self.field = field
        self.level = level
        super().__init__(f"Denied by {level.value} policy: {field}")
