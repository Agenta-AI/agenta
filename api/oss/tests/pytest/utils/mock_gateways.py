"""Where the mock gateways answer, from inside the compose network and from the host.

Two different addresses, and only one of them moves.

Inside the network the mock listens on a fixed container port, so `mock-mcp-gateway:9092`
is right on every stack and is what an endpoint's `base_url` must be: the API container is
what dials it. On the host that same container is reached through a published port, and
`env.sh` allocates that port per worktree so two stacks can run side by side. Four suites
wrote `9092` for both meanings, and nothing on the Python side read the variable that says
which port was allocated, so a stack given a different one had its host-side cases dial
somebody else's mock, or nothing at all, without saying so (D76, CR8).

One place, so the next suite cannot pick the wrong meaning of `9092`.
"""

import os


# What the mock listens on inside the compose network. Fixed: the published port is
# remapped onto this one, so it is not the value that moves.
_MCP_CONTAINER_PORT = 9092
_LLM_CONTAINER_PORT = 9091


def _published_port(variable: str, default: int) -> int:
    """The host port compose published, or the default when nothing allocated one."""
    raw = (os.getenv(variable) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        # A malformed allocation is the operator's to see. Falling back silently is how a
        # suite ends up dialling a port nobody asked for.
        raise AssertionError(f"{variable} is not a port number: {raw!r}") from None


def mock_mcp_container_url() -> str:
    """The address the API container dials, and therefore what endpoints register."""
    return os.getenv(
        "AGENTA_MOCK_MCP_GATEWAY_URL", f"http://mock-mcp-gateway:{_MCP_CONTAINER_PORT}"
    ).rstrip("/")


def mock_mcp_published_port() -> int:
    return _published_port("AGENTA_MOCK_MCP_GATEWAY_PORT", _MCP_CONTAINER_PORT)


def mock_llm_published_port() -> int:
    return _published_port("AGENTA_MOCK_LLM_GATEWAY_PORT", _LLM_CONTAINER_PORT)


def mock_mcp_published_url() -> str:
    """The address the host dials, which is where this process and a browser stand."""
    explicit = (os.getenv("AGENTA_MOCK_MCP_GATEWAY_PUBLISHED_URL") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    return f"http://localhost:{mock_mcp_published_port()}"
