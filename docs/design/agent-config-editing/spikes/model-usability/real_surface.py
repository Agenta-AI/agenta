"""The SHIPPED surfaces, imported rather than copied.

The first spike hand-wrote the tool schema and imported the engine from a worktree that no
longer exists. Both are now in the repository, so this module imports them. A hand-copy
answers a question about the copy: a benchmark that measures a schema the product does not
serve is worse than no benchmark, because it reads as evidence.

Two things come from here:

- ``commit_tool_schema()``: the model-visible input schema of the `commit_revision`
  platform op, with ordered operations ON, straight out of `op_catalog.py`.
- ``change_set``: the engine module, loaded from `api/oss/src/core/workflows/change_set.py`
  by path. It is dependency-free by contract, so a path load is safe and needs no app.

``describe_divergence()`` compares the shipped schema against the spike's original
hand-written one, so a run can state what changed rather than assume.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import os
import pathlib
import sys
from typing import Any, Dict, List

REPO = pathlib.Path(__file__).resolve().parents[5]
ENGINE_PATH = REPO / "api" / "oss" / "src" / "core" / "workflows" / "change_set.py"

# The catalog reads this at import time, and the arm under test is the shipped one.
os.environ.setdefault("AGENTA_WORKFLOWS_ORDERED_OPERATIONS_ENABLED", "true")


def _load_engine():
    """The shipped engine, under the module name the harness already imports."""
    if "change_set" in sys.modules:
        return sys.modules["change_set"]
    spec = importlib.util.spec_from_file_location("change_set", ENGINE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["change_set"] = module
    spec.loader.exec_module(module)
    return module


change_set = _load_engine()


def commit_tool_schema() -> Dict[str, Any]:
    """The model-visible schema of the shipped `commit_revision` op."""
    from agenta.sdk.agents.platform.op_catalog import get_platform_op

    return get_platform_op("commit_revision").resolved_input_schema()


def commit_tool_description() -> str:
    from agenta.sdk.agents.platform.op_catalog import get_platform_op

    return get_platform_op("commit_revision").description


def strip_placement_sentence(schema: Dict[str, Any]) -> Dict[str, Any]:
    """The same schema with the placement sentence removed from `description`.

    This is the control arm. It reproduces the field exactly as it shipped BEFORE the
    placement fix, so the fix's effect is a measured difference between two arms that
    differ in one sentence and nothing else.
    """
    from agenta.sdk.agents.platform.op_catalog import EPHEMERAL_DESCRIPTION_ARG

    control = copy.deepcopy(schema)
    field = control.get("properties", {}).get(EPHEMERAL_DESCRIPTION_ARG)
    if isinstance(field, dict) and "Send it at the top level" in field.get(
        "description", ""
    ):
        field["description"] = field["description"].split(" Send it at the top level")[
            0
        ]
    return control


def describe_divergence(spike_schema: Dict[str, Any]) -> List[str]:
    """What the spike's hand-written schema got wrong about the shipped one.

    Structural differences only, at the top two levels. A full leaf diff is noise: the
    operation sub-schema was always going to be reworded.
    """
    shipped = commit_tool_schema()
    notes: List[str] = []

    def keys(schema: Dict[str, Any], *path: str) -> set:
        node: Any = schema
        for step in path:
            node = (node or {}).get(step, {})
        return set((node or {}).get("properties", {}) or {})

    for label, path in (
        ("top level", ()),
        ("workflow_revision", ("properties", "workflow_revision")),
        ("delta", ("properties", "workflow_revision", "properties", "delta")),
    ):
        shipped_keys = keys(shipped, *path)
        spike_keys = keys(spike_schema, *path)
        missing = sorted(shipped_keys - spike_keys)
        extra = sorted(spike_keys - shipped_keys)
        if missing:
            notes.append(f"{label}: the spike schema is MISSING {missing}")
        if extra:
            notes.append(f"{label}: the spike schema has EXTRA {extra}")

    shipped_required = (
        shipped.get("properties", {}).get("workflow_revision", {}).get("required", [])
    )
    spike_required = (
        spike_schema.get("properties", {})
        .get("workflow_revision", {})
        .get("required", [])
    )
    if sorted(shipped_required) != sorted(spike_required):
        notes.append(
            f"workflow_revision.required: shipped {sorted(shipped_required)}, "
            f"spike {sorted(spike_required)}"
        )
    return notes


if __name__ == "__main__":
    print(json.dumps(commit_tool_schema(), indent=2)[:4000])
