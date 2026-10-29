"""Receipt parsing and the bridge's own failure signal.

Idempotency keys themselves are derived by the shared
`compose_idempotency_key` (stable across a retry of one command, distinct for
a later edit of the same message) -- this module does not re-derive that, it
only carries the bridge-specific wire shapes around it.
"""

from typing import Any, Dict

from oss.src.core.channels.adapters.bridge.envelope import parse_receipt


class BridgeDeliveryFailed(Exception):
    """Raised when a bridge reports an explicit delivery failure rather than
    returning a receipt. Distinct from an empty locator, which is a bug, not
    a reported failure -- this package never infers failure from silence."""

    def __init__(self, *, reason: str = "bridge reported delivery failure"):
        self.reason = reason
        super().__init__(reason)


def read_delivery_response(payload: Dict[str, Any]) -> Dict[str, Any]:
    """The bridge's response to a delivery command -> the opaque
    `external_locator`. Raises BridgeDeliveryFailed on an explicit error;
    never guesses failure from a missing or empty field."""

    if payload.get("error") is not None:
        raise BridgeDeliveryFailed(reason=str(payload["error"]))

    locator = parse_receipt(payload)
    if locator is None:
        raise BridgeDeliveryFailed(reason="response was not a bridge.receipt")

    return locator
