#!/usr/bin/env python3
"""Measure the advertised token cost of the playground build kit.

Counts what the model actually sees on every turn: for each op in `DEFAULT_BUILD_KIT_OPS`, the
`{name, description, inputSchema}` projection the runner advertises — the same shape
`advertisedToolSpec()` builds in `services/runner/src/tools/public-spec.ts`.

One lever, switchable, so a run can be attributed:

  --no-diet   count the pre-diet schemas (reconstructs the inlined agent-template tree)

`--no-diet` reconstructs Phase 1 only. Phase 2 deleted the `query_spans` `$defs` from the catalog
source, so there is nothing left to reconstruct; the pre-diet column is therefore ~1,000 tokens
below the true 18,353 baseline. The baseline is the measured figure in baseline.md, not a
`--no-diet` run.

Lazy schemas (Phase 3) are NOT in the tree — that work is stashed pending a lab run, see
results.md. This script therefore measures the diet alone.

Run from the repo root:
    api/.venv/bin/python docs/design/agent-workflows/projects/progressive-tool-disclosure/measure.py
"""

from __future__ import annotations

import argparse
import json
import sys
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / "sdks/python"))
sys.path.insert(0, str(ROOT / "api"))

import tiktoken  # noqa: E402

from agenta.sdk.agents.platform import op_catalog  # noqa: E402
from agenta.sdk.agents.platform.op_catalog import get_platform_op  # noqa: E402
from oss.src.core.workflows.build_kit import DEFAULT_BUILD_KIT_OPS  # noqa: E402

# The measured pre-project baseline (2026-07-26), for the cut column.
BASELINE_TOTAL = 18_353

ENCODER = tiktoken.get_encoding("o200k_base")


def tokens(value) -> int:
    return len(ENCODER.encode(json.dumps(value)))


def undiet(schema: dict, op_name: str) -> dict:
    """Put the full agent-template tree back where the diet collapsed it."""
    schema = deepcopy(schema)
    properties = schema.get("properties", {})
    delta = (
        properties.get("workflow_revision", {}).get("properties", {}).get("delta")
        if op_name == "commit_revision"
        else properties.get("delta")
    )
    if not delta:
        return schema
    parameters = delta["properties"]["set"]["properties"]["parameters"]
    parameters["properties"]["agent"] = deepcopy(
        op_catalog._AGENT_TEMPLATE_DELTA_SCHEMA_FULL
    )
    return schema


def advertised(op_name: str, *, diet: bool):
    """The advertised projection for one op."""
    op = get_platform_op(op_name)
    schema = op.resolved_input_schema()
    if not diet:
        schema = undiet(schema, op_name)
    return {
        "name": f"tools.agenta.{op_name}",
        "description": op.description,
        "inputSchema": schema,
    }


def measure(*, diet: bool):
    rows = [
        (op_name, tokens(advertised(op_name, diet=diet)))
        for op_name in DEFAULT_BUILD_KIT_OPS
    ]
    return rows, sum(count for _, count in rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-diet", action="store_true", help="undo phases 1-2")
    parser.add_argument("--all", action="store_true", help="both lever states")
    args = parser.parse_args()

    if args.all:
        print(
            "Advertised per turn (what every turn pays, before the model does anything)"
        )
        print(f"{'diet':>6}{'total':>9}{'cut':>8}")
        for diet in (False, True):
            _, total = measure(diet=diet)
            cut = (BASELINE_TOTAL - total) / BASELINE_TOTAL * 100
            print(f"{str(diet):>6}{total:>9}{cut:>7.1f}%")

        print(
            "\nPrivate specs on the /run wire (sent once per run, never re-read by the model)"
        )
        for label, diet in (("pre-diet", False), ("shipped", True)):
            total = sum(
                tokens(
                    undiet(get_platform_op(name).resolved_input_schema(), name)
                    if not diet
                    else get_platform_op(name).resolved_input_schema()
                )
                for name in DEFAULT_BUILD_KIT_OPS
            )
            print(f"{label:24}{total:>10}")
        return

    diet = not args.no_diet
    rows, total = measure(diet=diet)
    print(f"diet={diet}")
    print(f"{'op':24}{'tokens':>8}")
    for op_name, count in sorted(rows, key=lambda row: -row[1]):
        print(f"{op_name:24}{count:>8}")
    print(f"{'TOTAL':24}{total:>8}")
    print(
        f"\n{(BASELINE_TOTAL - total) / BASELINE_TOTAL * 100:.1f}% below the "
        f"{BASELINE_TOTAL:,} baseline"
    )


if __name__ == "__main__":
    main()
