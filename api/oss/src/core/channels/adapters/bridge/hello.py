"""The `bridge.hello` registration handshake: parse the bridge's declaration,
normalise it at the boundary like any other adapter's, and pin the one
protocol version this package speaks.
"""

from typing import Any, Dict

from oss.src.core.channels.adapters.normalise import normalise_capabilities
from oss.src.core.channels.dtos import ChannelCapabilities

# Unproven until a non-Slack channel ships on this contract, so this pins
# "0.1.0" rather than claiming a 1.0 stability not yet earned.
SUPPORTED_PROTOCOL_VERSION = "0.1.0"


class BridgeProtocolUnsupported(Exception):
    """Raised when a `bridge.hello` does not declare the one protocol
    version this package speaks."""

    def __init__(self, *, versions: Any):
        self.versions = versions
        super().__init__(f"bridge.hello did not declare {SUPPORTED_PROTOCOL_VERSION}")


def parse_hello(payload: Dict[str, Any]) -> ChannelCapabilities:
    """`bridge.hello` -> the normalised capability declaration. Raises
    BridgeProtocolUnsupported if the bridge's protocol.versions excludes the
    one version this package speaks."""

    protocol = payload.get("protocol") or {}
    versions = protocol.get("versions") or []
    if SUPPORTED_PROTOCOL_VERSION not in versions:
        raise BridgeProtocolUnsupported(versions=versions)

    # bridge.name is identity, carried on the connection's integration_key --
    # never part of the normalised capability declaration itself.
    raw_capabilities = dict(payload.get("capabilities") or {})
    raw_capabilities.setdefault("channel", "bridge")
    raw_capabilities.setdefault("protocol", protocol)

    return normalise_capabilities(raw_capabilities)
