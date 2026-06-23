"""Server-authoritative per-harness connection-capability table for the resolver.

The connection resolver consults this to fail loud (Concern 3b in
``docs/design/agent-workflows/projects/provider-model-auth/design.md``) when a request asks for
a provider or a connection mode the selected harness cannot reach. Guarding this on the server
side, not only the frontend, means a direct API caller is also checked.

This is a small subset; the full capability-table mechanism is owned by the sibling
``harness-capabilities`` project. A copy of the same shape lives on the SDK side
(``sdks/python/agenta/sdk/agents/capabilities.py``) for the standalone-SDK / frontend paths; the
duplication is intentional (the API must not import the SDK, the SDK must not import the API).
Keep the two tables in agreement.
"""

# Pi and the Agenta harness (Pi under the hood) reach any provider; Claude is narrow (Anthropic
# only). All three support every connection mode. ``["*"]`` providers means any.
_ALL_MODES = ["default", "self_managed", "agenta"]

HARNESS_CONNECTION_CAPABILITIES = {
    "pi": {"providers": ["*"], "connection_modes": _ALL_MODES},
    "agenta": {"providers": ["*"], "connection_modes": _ALL_MODES},
    "claude": {"providers": ["anthropic"], "connection_modes": _ALL_MODES},
}


def harness_allows_provider(harness: str, provider: str) -> bool:
    """Whether ``harness`` can reach ``provider``. Unknown harness = permissive (True)."""
    entry = HARNESS_CONNECTION_CAPABILITIES.get(harness)
    if entry is None:
        return True
    providers = entry["providers"]
    if "*" in providers:
        return True
    return provider.lower() in {p.lower() for p in providers}


def harness_allows_mode(harness: str, mode: str) -> bool:
    """Whether ``harness`` supports the connection ``mode``. Unknown harness = permissive (True)."""
    entry = HARNESS_CONNECTION_CAPABILITIES.get(harness)
    if entry is None:
        return True
    return mode in entry["connection_modes"]
