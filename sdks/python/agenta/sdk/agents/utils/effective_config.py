"""The effective turn config stamped onto the ``/run`` wire (``effectiveParameters``).

**Why it exists.** When a HITL gate is answered from a client that cannot reproduce the
turn's config — mobile, or the server-side M2 dispatcher — the resume arrives
references-only, so the SDK hydrates the referenced variant's HEAD revision instead of what
the gated turn was actually running (see
``docs/design/agenta-mobile/plans/2026-07-29-effective-turn-config.md``). The runner echoes
this blob onto the durable interaction row, and the answering client replays it inline as
``data.parameters``, which suppresses hydration
(``middlewares/running/resolver.py`` ``_caller_supplied_configuration``) and reproduces the
turn — tool permissions included.

Two guards run before a config becomes durable:

- **Redaction.** The blob is author intent, and the one place the schema permits a raw
  credential VALUE is an MCP server's static ``connection.headers``
  (``agents/mcp/models.py`` ``MCPConnection``). Those are dropped. The secret REFS
  (``connection.credentials``, which hold vault key NAMES, never values) survive, so a
  replayed run re-resolves the same credentials from the project vault. The cost is
  deliberate: an author who inlines a static header into an MCP connection loses that header
  on a replayed resume rather than having it persisted in a second place.
- **Size cap.** Measured over the dev corpus (n=326 revisions with parameters): avg 761 B,
  p90 1.4 KB, max 20 KB — the large ones are entirely tool JSON-Schema. Anything over
  :data:`MAX_STAMPED_BYTES` is dropped WHOLE with a warning (a truncated blob would be
  invalid JSON, and a silently truncated config is worse than none); the resume then degrades
  to today's references-only hydration.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

from agenta.sdk.utils.logging import get_module_logger

log = get_module_logger(__name__)

# 3x the largest config measured in the dev corpus. Over this the blob is not stamped at all.
MAX_STAMPED_BYTES = 64 * 1024

# Keys that can hold a raw credential VALUE on a tool/MCP entry or its connection descriptor.
# `credentials` is deliberately NOT here: it holds vault key names, which the replay needs.
_CREDENTIAL_KEYS = frozenset({"headers", "authorization"})

# Only these lists carry connection descriptors; the rest of the config is inert authored text
# and JSON-Schema, and blanket key-stripping there would mangle a tool's input schema
# (a schema property may legitimately be named "headers").
_CONNECTION_BEARING_LISTS = ("mcps", "tools")
_NESTED_CONNECTION_KEYS = ("connection", "call")


def _redact_entry(entry: Any, stripped: list) -> Any:
    if not isinstance(entry, dict):
        return entry
    cleaned = dict(entry)
    for key in _CREDENTIAL_KEYS:
        if cleaned.pop(key, None) is not None:
            stripped.append(key)
    for nested_key in _NESTED_CONNECTION_KEYS:
        nested = cleaned.get(nested_key)
        if not isinstance(nested, dict):
            continue
        nested_clean = dict(nested)
        for key in _CREDENTIAL_KEYS:
            if nested_clean.pop(key, None) is not None:
                stripped.append(f"{nested_key}.{key}")
        cleaned[nested_key] = nested_clean
    return cleaned


def redact_effective_parameters(parameters: Dict[str, Any]) -> Dict[str, Any]:
    """Copy ``parameters`` with credential-shaped values dropped from ``agent.mcps``/``tools``.

    Returns the input unchanged (a shallow copy) when there is nothing to redact.
    """
    agent = parameters.get("agent")
    if not isinstance(agent, dict):
        return parameters

    stripped: list = []
    agent_clean = dict(agent)
    for list_key in _CONNECTION_BEARING_LISTS:
        entries = agent_clean.get(list_key)
        if not isinstance(entries, list):
            continue
        agent_clean[list_key] = [_redact_entry(entry, stripped) for entry in entries]

    if not stripped:
        return parameters

    log.warning(
        "agent: stripped %d credential-shaped field(s) from the stamped effective config: %s",
        len(stripped),
        sorted(set(stripped)),
    )
    cleaned = dict(parameters)
    cleaned["agent"] = agent_clean
    return cleaned


def stamp_effective_parameters(
    parameters: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """The blob to put on the wire, or ``None`` when there is nothing safe to stamp.

    ``None`` for an empty/non-dict config, for one that does not serialize, and for one over
    :data:`MAX_STAMPED_BYTES` — each logged, never silent.
    """
    if not isinstance(parameters, dict) or not parameters:
        return None

    redacted = redact_effective_parameters(parameters)

    try:
        size = len(json.dumps(redacted).encode("utf-8"))
    except (TypeError, ValueError) as e:
        log.warning(
            "agent: effective config is not JSON-serializable; not stamped (%s)", e
        )
        return None

    if size > MAX_STAMPED_BYTES:
        log.warning(
            "agent: effective config is %d B, over the %d B stamp cap; not stamped "
            "(a resume against this turn falls back to reference hydration)",
            size,
            MAX_STAMPED_BYTES,
        )
        return None

    return redacted
