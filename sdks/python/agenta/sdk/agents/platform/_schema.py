"""Expand Agenta catalog type-references in a JSON Schema into concrete JSON Schema.

A ``type:"reference"`` workflow tool carries the referenced workflow's input schema, and that
schema can use Agenta's catalog shorthand: a node marked ``{"x-ag-type-ref": "<key>"}`` stands
in for a named catalog type (``messages``, ``model``, ...) instead of spelling the shape out
inline. That marker is an Agenta-internal pointer, not standard JSON Schema. When such a schema
reaches a harness (Claude, an MCP client), the harness sees, for example, an ``array`` with no
``items`` and cannot construct a valid call, so it returns ``null``.

:func:`expand_type_refs` resolves those pointers against the in-process catalog
(:data:`agenta.sdk.utils.types.CATALOG_TYPES`) BEFORE the tool spec is built, so the emitted
``inputSchema`` is concrete, standard JSON Schema the harness can actually use. This changes only
the CONTENT of the schema (it gains the structure the pointer elided), never the wire shape.

Lives under ``platform/`` rather than ``tools/`` on purpose: importing ``CATALOG_TYPES`` from a
``tools`` module is circular (``CATALOG_TYPES`` is defined in ``utils.types``, which imports
``agents.tools``), whereas the platform package is imported lazily and sits below that cycle.

Pure function, no I/O: the catalog is an in-memory dict shipped with the SDK.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, Mapping

from agenta.sdk.utils.types import CATALOG_TYPES

# The Agenta-internal marker: a JSON Schema node carrying ``{"x-ag-type-ref": "<key>"}`` stands
# in for the catalog type ``<key>``.
_TYPE_REF_KEY = "x-ag-type-ref"

# JSON Schema keywords that describe the *shape* of a value. When a node is expanded these come
# from the catalog entry — supplying the concrete structure the author elided behind the pointer
# is the whole point of the expansion. Every other key on the author's node (``description``,
# ``title``, ``examples``, ``default``, ...) is an annotation the author chose, so it is preserved
# and wins over the catalog's.
_STRUCTURAL_KEYS = frozenset(
    {
        "type",
        "items",
        "prefixItems",
        "properties",
        "patternProperties",
        "additionalProperties",
        "required",
        "enum",
        "const",
        "anyOf",
        "oneOf",
        "allOf",
        "not",
        "$ref",
        "$defs",
        "definitions",
        "discriminator",
        "format",
    }
)


def expand_type_refs(
    schema: Any,
    catalog: Mapping[str, Dict[str, Any]] = CATALOG_TYPES,
) -> Any:
    """Return ``schema`` with every ``x-ag-type-ref`` pointer expanded to concrete JSON Schema.

    Walks ``schema`` recursively. For any node carrying ``{"x-ag-type-ref": "<key>"}`` where
    ``<key>`` is a key in ``catalog``, the node is replaced by a merge of the catalog entry and
    the author's node:

    - the catalog entry supplies the concrete structure (``type``, ``items``, ``properties``, ...);
    - the author's annotations (``description``, ``title``, ...) are preserved and override the
      catalog's, EXCEPT structural keywords the catalog already defines, which always come from the
      catalog;
    - the ``x-ag-type-ref`` marker itself is dropped (it has been resolved).

    An unknown ``<key>`` (not in ``catalog``) is left exactly as it is — the marker stays and
    nothing crashes. Nested and transitively-referenced types expand too (e.g. an ``llm`` whose
    ``model`` field is itself an ``x-ag-type-ref``). The input is never mutated; a fresh structure
    is returned.
    """
    return _expand(schema, catalog)


def _expand(node: Any, catalog: Mapping[str, Dict[str, Any]]) -> Any:
    if isinstance(node, list):
        return [_expand(item, catalog) for item in node]
    if not isinstance(node, dict):
        return node

    ref = node.get(_TYPE_REF_KEY)
    if isinstance(ref, str) and ref in catalog:
        merged: Dict[str, Any] = deepcopy(dict(catalog[ref]))
        for key, value in node.items():
            if key == _TYPE_REF_KEY:
                continue  # the marker has been resolved; drop it
            if key in _STRUCTURAL_KEYS and key in merged:
                continue  # the concrete shape always comes from the catalog
            merged[key] = value  # preserve the author's annotation
        # Recurse so a catalog type that itself references another type, and any nested author
        # refs, also expand. The current catalog types are acyclic, so this terminates.
        return {key: _expand(value, catalog) for key, value in merged.items()}

    # No resolvable ref here. Rebuild the node so nested refs inside it expand; an unknown ref key
    # falls through to here and is left untouched (its scalar marker value is returned as-is).
    return {key: _expand(value, catalog) for key, value in node.items()}
