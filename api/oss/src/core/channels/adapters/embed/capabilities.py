"""Capability declaration for `embed`: the `agenta` ceiling, narrowed to what a
public chat widget is. One visitor is one private space, the embed id in the
path is the connection, and uploads are capped because they ride the body."""

import copy

from oss.src.core.channels.adapters.agenta.capabilities import AGENTA_CAPABILITIES
from oss.src.core.channels.adapters.normalise import normalise_capabilities
from oss.src.core.channels.dtos import ChannelCapabilities
from oss.src.utils.env import env

# None (any site may embed), or http(s) origins separated by spaces or new
# lines; a host may start with one `*.` label. Checked on create only: an edit
# skips it, so readers sanitize again at use time.
_ORIGIN = r"https?://(\*\.)?[A-Za-z0-9.-]+(:[0-9]{1,5})?"
ALLOWED_ORIGINS_PATTERN = rf"({_ORIGIN}(\s+{_ORIGIN})*)?"

EMBED_CAPABILITIES: dict = copy.deepcopy(AGENTA_CAPABILITIES)
EMBED_CAPABILITIES.update(
    {
        "channel": "embed",
        "spaces": {"private": True, "group": False, "topic": False},
        "identity": {
            "scope": "embed",
            "stable": True,
            "keys": {
                "connection": ["embed"],
                # as for `agenta`: the agent, not the locator, tells a
                # visitor's conversations apart, so both carry the key hash
                "space": ["visitor"],
                "thread": ["thread"],
            },
        },
        "setup": {
            "instructions": [
                "Optionally, list the websites that may show the chat.",
                "Copy the snippet into a page on your website.",
            ],
            "fields": [
                {
                    "name": "allowed_origins",
                    "label": "Specific domains",
                    "secret": False,
                    "required": False,
                    "help": "Enter each domain in a new line. Leave empty to allow "
                    "embedding the agent on any site.",
                    "pattern": ALLOWED_ORIGINS_PATTERN,
                    "pattern_error": "Enter domains like https://example.com or "
                    "https://*.example.com, one per line, with no path.",
                },
            ],
        },
    }
)
EMBED_CAPABILITIES["rendering"]["files"]["receive"]["max_bytes"] = (
    env.channels.embed.max_file_bytes
)


def fetch_embed_capabilities() -> ChannelCapabilities:
    return normalise_capabilities(EMBED_CAPABILITIES)
