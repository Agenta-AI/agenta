"""Shared detection of unresolved embeds in a configuration tree.

Used by skill parsing and the running resolver so the two cannot drift. A real
embed is a mapping keyed ``@ag.embed``, a string containing the ``@{{`` snippet
token, or a string containing the ``@ag.embed[`` form the resolve API still
inlines. Literal ``@ag.embed`` in a string (without ``[``) is documentation,
not an embed.
"""

from collections.abc import Mapping
from typing import Any

OBJECT_KEY = "@ag.embed"
SNIPPET_TOKEN = "@{{"
STRING_PREFIX = "@ag.embed["
_MAX_DEPTH = 20


def has_embed_markers(config: Any, _depth: int = 0) -> bool:
    if _depth > _MAX_DEPTH:
        return False

    if isinstance(config, Mapping):
        if OBJECT_KEY in config:
            return True
        return any(has_embed_markers(v, _depth + 1) for v in config.values())

    if isinstance(config, (list, tuple)):
        return any(has_embed_markers(item, _depth + 1) for item in config)

    if isinstance(config, str):
        return SNIPPET_TOKEN in config or STRING_PREFIX in config

    return False
