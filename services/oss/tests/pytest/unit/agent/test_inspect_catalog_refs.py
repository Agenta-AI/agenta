"""Every ``x-ag-type-ref`` the agent ``/inspect`` schema emits must resolve in the catalog.

The agent self-describes its interface in ``AGENT_SCHEMAS`` (``services/oss/src/agent/schemas.py``)
instead of registering a static SDK interface. Its input/output/parameter schemas carry
``x-ag-type-ref`` markers (``messages``, ``message``, ``agent_config``) that the playground
resolves against ``GET /workflows/catalog/types/{type}`` to pick a control. That endpoint
resolves a marker via ``CATALOG_TYPES`` (``agenta.sdk.utils.types``): the router calls
``get_workflow_catalog_type(ag_type=...)``, which is ``CATALOG_TYPES.get(ag_type)`` and 404s
when the key is unknown (``oss.src.resources.workflows.catalog``).

Nothing else asserts that link, so renaming a marker on either side (or dropping a catalog
type) silently breaks the playground form: the control fails to resolve and renders nothing.
This guard fails fast instead.
"""

from __future__ import annotations

from typing import Any, Set

from agenta.sdk.utils.types import CATALOG_TYPES

from oss.src.agent.schemas import AGENT_SCHEMAS

# Markers the agent /inspect schema is expected to emit. Pinned so that *dropping* a marker
# (not just renaming it to something unresolvable) is caught too. Update this set
# deliberately when the agent interface changes.
EXPECTED_INSPECT_REFS = {"messages", "message", "agent_config"}


def _collect_type_refs(node: Any, acc: Set[str]) -> Set[str]:
    """Recursively gather every ``x-ag-type-ref`` string value reachable from ``node``."""
    if isinstance(node, dict):
        ref = node.get("x-ag-type-ref")
        if isinstance(ref, str):
            acc.add(ref)
        for value in node.values():
            _collect_type_refs(value, acc)
    elif isinstance(node, list):
        for value in node:
            _collect_type_refs(value, acc)
    return acc


def test_inspect_schema_emits_the_expected_type_refs():
    refs = _collect_type_refs(AGENT_SCHEMAS, set())

    assert refs == EXPECTED_INSPECT_REFS, (
        "The agent /inspect schema emits a different set of x-ag-type-ref markers than "
        "expected. If this is intentional, update EXPECTED_INSPECT_REFS (and make sure each "
        "new marker resolves in the workflow catalog)."
    )


def test_every_inspect_type_ref_resolves_in_the_catalog():
    refs = _collect_type_refs(AGENT_SCHEMAS, set())

    assert refs, "The agent /inspect schema emitted no x-ag-type-ref markers at all."

    unresolved = sorted(ref for ref in refs if ref not in CATALOG_TYPES)

    assert not unresolved, (
        "These x-ag-type-ref markers from the agent /inspect schema do not resolve in the "
        f"workflow catalog (GET /workflows/catalog/types/{{type}}): {unresolved}. "
        f"Available catalog types: {sorted(CATALOG_TYPES)}. "
        "Rename the marker to a catalog type, or add the type to CATALOG_TYPES."
    )
