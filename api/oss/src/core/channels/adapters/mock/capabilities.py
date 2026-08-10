"""Capability builders for `mock` — a shape per capability arm, not one
constant. `full()` declares every capability true; the other builders start
from `full()` and turn exactly the one arm `capabilities.md` describes off.
"""

from copy import deepcopy
from typing import Any, Dict

from oss.src.core.channels.adapters.normalise import normalise_capabilities
from oss.src.core.channels.dtos import ChannelCapabilities

# A shared-secret header scheme matching the contract suite's own fixture, so
# mock's signature check is whatever the suite asserts. Overridable per instance.
DEFAULT_SIGNATURE_HEADER = "x-fake-signature"
DEFAULT_SIGNATURE_VALUE = "valid"

_FULL: Dict[str, Any] = {
    "channel": "mock",
    "protocol": {"versions": ["0.1.0"]},
    "addressing": {
        "sigils": {"agent": "~", "command": "!"},
        "mention": True,
        "commands": {"native": True, "in_conversation": False},
    },
    "spaces": {"private": True, "group": True, "topic": True},
    "conversation": {"units": ["thread", "space"], "default": "thread"},
    "fill": {
        "backfill": {"supported": True, "requires_permission": None},
        "forwardfill": {"supported": True, "requires_permission": None},
    },
    "rendering": {
        "controls": {"update": True, "ephemeral": True},
        "buttons": {"supported": True, "max": 5},
        "text": {"format": "markdown", "max_chars": 3000},
        "files": {
            "send": {"supported": True, "max_bytes": 1024},
            "receive": {"supported": True, "max_bytes": 1024},
        },
    },
    "identity": {
        "scope": "workspace",
        "stable": True,
        "keys": {
            "space": ["team", "channel"],
            "thread": ["team", "channel", "thread_ts"],
        },
    },
    "commands": ["new", "sessions", "use"],
}


def _deep_merge(base: Dict[str, Any], overrides: Dict[str, Any]) -> Dict[str, Any]:
    merged = deepcopy(base)
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


def declare(**overrides: Any) -> ChannelCapabilities:
    """Arbitrary shape: `full()` merged with whatever nested overrides a test
    needs. Keys are merged by dict path, so `declare(rendering={"buttons":
    {"max": 2}})` leaves every other field at `full()`'s value."""

    return normalise_capabilities(_deep_merge(_FULL, overrides))


def full() -> ChannelCapabilities:
    """Every capability arm on — the counterpart every `no_*` builder is
    paired against."""

    return declare()


def no_threads() -> ChannelCapabilities:
    """No thread grain: `units` degrades to `["space"]`, `default` follows it
    (it must be a member of `units`), and `identity.keys["thread"] = []` so
    `compose_external_key` returns None at THREAD grain rather than raising."""

    return declare(
        conversation={"units": ["space"], "default": "space"},
        identity={"keys": {"thread": []}},
    )


def no_buttons() -> ChannelCapabilities:
    """No button rendering: the renderer's numbered-text fallback is the only
    path, at any button count."""

    return declare(rendering={"buttons": {"supported": False, "max": 0}})


def no_history() -> ChannelCapabilities:
    """No backfill: `fetch_history` must never be called, and if it were it
    would raise `ChannelBackfillRefused` rather than returning a page."""

    return declare(
        fill={
            "backfill": {"supported": False, "requires_permission": None},
            "forwardfill": {"supported": False, "requires_permission": None},
        }
    )
