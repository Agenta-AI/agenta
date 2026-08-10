# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Re-render the summary table from a stored results.json, and diff two runs.

    uv run table.py results/20260806-190000/results.json
    uv run table.py results/20260806-190000/results.json --against results/20260805-120000/results.json

WHY THIS IS SEPARATE FROM THE RUNNER. Re-tabulating must never require re-running: the numbers
cost real money, the results files are append-only history, and the whole improvement loop is
"measure, change one instruction surface, measure again, compare". `--against` is that comparison,
and it prints the stamps of both runs next to the delta so a reader can see WHICH text moved the
number — a per-scenario delta without the stamps is a rumor.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import bench_lib as B  # noqa: E402
from run_benchmark import build_summary, score  # noqa: E402


def load(path: str) -> dict:
    """Read a results file and RE-LABEL every trial under the current taxonomy.

    Re-labelling on read, rather than trusting the label the run wrote, is what lets an
    append-only history stay comparable while the outcome definitions improve. The stored file is
    never modified; only the in-memory view is corrected, and `results.json` keeps whatever the run
    recorded at the time."""
    results = json.loads(pathlib.Path(path).read_text())
    for cell in results.get("cells", {}).values():
        for scenario in cell.get("scenarios", {}).values():
            for trial in scenario.get("trials", []):
                relabelled = B.classify_record(trial)
                if relabelled is not None:
                    trial["outcome"] = relabelled
    return results


def scenario_rates(results: dict) -> dict:
    out = {}
    for sid in results["scenarios"]:
        trials = [
            t
            for cell in results["cells"].values()
            for t in cell["scenarios"].get(sid, {}).get("trials", [])
        ]
        out[sid] = score(trials)
    return out


def cell_rates(results: dict) -> dict:
    return {
        cell_id: score([t for sc in cell["scenarios"].values() for t in sc["trials"]])
        for cell_id, cell in results["cells"].items()
    }


def measured_trials(results: dict) -> int:
    return sum(
        1
        for cell in results.get("cells", {}).values()
        for scenario in cell.get("scenarios", {}).values()
        for trial in scenario.get("trials", [])
        if not trial.get("skip")
    )


def comparable(new: dict, old: dict) -> str | None:
    """Why these two runs cannot be compared by raw counts, or None when they can.

    A shape count is only a like-for-like signal when the two runs measured the SAME cells and the
    SAME scenarios. Comparing a one-cell baseline against a three-cell slice shows `wrong_surface`
    rising by 54 and reads as a catastrophic regression when nothing regressed at all. Rates are
    printed either way; the warning is what stops the counts being read as a delta."""
    new_cells, old_cells = set(new.get("cells", {})), set(old.get("cells", {}))
    new_scen, old_scen = set(new.get("scenarios", [])), set(old.get("scenarios", []))
    problems = []
    if new_cells != old_cells:
        problems.append(
            f"cells differ (old {sorted(old_cells)}, new {sorted(new_cells)})"
        )
    if new_scen != old_scen:
        problems.append(f"{len(new_scen ^ old_scen)} scenario(s) differ")
    return "; ".join(problems) or None


def shape_counts(results: dict) -> dict:
    """How many trials landed on each failing shape, across every cell.

    Counted after `load` has re-labelled, so two runs recorded under different versions of the
    taxonomy are still compared under one definition."""
    counts: dict = {}
    for cell in results.get("cells", {}).values():
        for scenario in cell.get("scenarios", {}).values():
            for trial in scenario.get("trials", []):
                if trial.get("skip"):
                    continue
                shape = trial.get("outcome")
                if shape in B.FAILING_OUTCOMES:
                    counts[shape] = counts.get(shape, 0) + 1
    return counts


def diff(new: dict, old: dict) -> str:
    lines = [
        "# Run comparison",
        "",
        f"new: {new['run']['started_at']} · old: {old['run']['started_at']}",
        "",
        "## Instruction surfaces that changed between the runs",
        "",
    ]
    changed = False
    for label in B.INSTRUCTION_SURFACES:
        a = (new["run"]["stamps"].get(label) or {}).get("sha256")
        b = (old["run"]["stamps"].get(label) or {}).get("sha256")
        if a != b:
            changed = True
            lines.append(f"- **{label}** `{b}` -> `{a}`")
    mismatch = comparable(new, old)
    if mismatch:
        lines.insert(
            3,
            "> **These runs are not like-for-like: "
            + mismatch
            + ".** Counts below are not a delta; read the share-of-trials column only.\n",
        )
    if not changed:
        lines.append(
            "None. Any movement below is run-to-run variance, not an effect of a wording change — "
            "treat it as a measurement of this benchmark's own noise floor."
        )
    lines += [
        "",
        "## One-shot rate by scenario",
        "",
        "| scenario | old | new | delta |",
        "|---|---|---|---|",
    ]
    new_rates, old_rates = scenario_rates(new), scenario_rates(old)
    for sid in new["scenarios"]:
        a = new_rates.get(sid, {}).get("one_shot_rate")
        b = old_rates.get(sid, {}).get("one_shot_rate")
        if a is None or b is None:
            lines.append(f"| {sid} | {_pct(b)} | {_pct(a)} | — |")
            continue
        lines.append(f"| {sid} | {_pct(b)} | {_pct(a)} | {(a - b):+.0%} |")
    lines += [
        "",
        "## Failure shapes: did the PREDICTED shape move?",
        "",
        "A change aimed at one shape that moves a different one has not been understood, and the "
        "next change built on top of it is guesswork. This table is the check on the prediction, "
        "not a summary of the score.",
        "",
        "| shape | old | new | delta (share of trials) |",
        "|---|---|---|---|",
    ]
    new_shapes, old_shapes = shape_counts(new), shape_counts(old)
    new_n, old_n = max(measured_trials(new), 1), max(measured_trials(old), 1)
    for shape in B.FAILING_OUTCOMES:
        a, b = new_shapes.get(shape, 0), old_shapes.get(shape, 0)
        if a == 0 and b == 0:
            continue
        lines.append(
            f"| {shape} | {b} ({b / old_n:.0%}) | {a} ({a / new_n:.0%}) | "
            f"{a / new_n - b / old_n:+.0%} |"
        )
    lines += [
        "",
        "## One-shot rate by cell",
        "",
        "| cell | old | new | delta |",
        "|---|---|---|---|",
    ]
    new_cells, old_cells = cell_rates(new), cell_rates(old)
    for cell_id in new_cells:
        a = new_cells[cell_id].get("one_shot_rate")
        b = old_cells.get(cell_id, {}).get("one_shot_rate")
        delta = f"{(a - b):+.0%}" if (a is not None and b is not None) else "—"
        lines.append(f"| {cell_id} | {_pct(b)} | {_pct(a)} | {delta} |")
    return "\n".join(lines) + "\n"


def _pct(value) -> str:
    return "—" if value is None else f"{value:.0%}"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("results")
    p.add_argument("--against", help="an earlier results.json to compare against")
    p.add_argument(
        "--write", action="store_true", help="write summary.md next to results.json"
    )
    args = p.parse_args()

    results = load(args.results)
    if args.against:
        print(diff(results, load(args.against)))
        return 0
    summary = build_summary(results, results["run"].get("threshold", 0.95))
    print(summary)
    if args.write:
        out = pathlib.Path(args.results).with_name("summary.md")
        out.write_text(summary)
        print(f"wrote {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
