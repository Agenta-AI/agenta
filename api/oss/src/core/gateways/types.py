"""Domain exception base for the gateways (entities.md §5).

One domain base so the router decorator can catch broadly; no HTTP status on any
exception — mapping happens at the boundary (`apis/fastapi/gateways/exceptions.py`).
"""


class GatewaysError(Exception):
    """Base exception for the gateways domain."""

    def __init__(self, message: str = "Gateways error"):
        self.message = message
        super().__init__(self.message)


class GatewayEndpointInactiveError(GatewaysError):
    """The operator's switch is off (§2.6). One type for both planes: the flag, the
    refusal and the reason are identical, only the endpoint named differs."""

    def __init__(self, *, target: str):
        self.target = target
        self.flag = "is_active"
        super().__init__(f"Endpoint is deactivated: {target}")
