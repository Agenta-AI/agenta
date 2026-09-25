from oss.src.core.channels.types import ChannelsError


class ChannelToolsError(ChannelsError):
    """Base for a channel tool call that cannot go ahead. The message is
    written for the model and never carries a provider or tenant id."""


class ChannelToolsRefused(ChannelToolsError):
    """The call is well formed but not allowed: no connected bot, an
    ambiguous binding, or a bot setting that turns this action off."""


class ChannelToolsNotFound(ChannelToolsError):
    """The reference does not resolve inside the caller's project and bots.
    Says nothing about whether it exists elsewhere."""

    def __init__(self, message: str = "Destination not found."):
        super().__init__(message)
