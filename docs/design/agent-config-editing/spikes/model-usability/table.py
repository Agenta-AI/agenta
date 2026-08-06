# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Emit the markdown result tables for the spike report."""

import collections
import glob
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
import tasks as T  # noqa: E402

TASK_IDS = [t.tid for t in T.TASKS]
TITLES = {t.tid: t.title for t in T.TASKS}

# Each entry is (model, instructions, lenient, v3_surface, v4_surface, label). The last
# three fields together identify one interface cohort: two arms that share `instructions`
# but differ in surface must never land in the same aggregation bucket, and a v4-only task
# (see tasks.py TASKS, "l") only appears under a v4_surface arm.
ARMS = [
    ("haiku", "v0", False, False, False, "Haiku v0"),
    ("haiku", "v1", False, False, False, "Haiku v1"),
    ("haiku", "v2", False, False, False, "Haiku v2"),
    ("haiku", "v2", True, False, False, "Haiku v2+L"),
    ("haiku", "v3", True, True, False, "Haiku v3+fixes"),
    ("haiku", "v4a", True, False, True, "Haiku v4a"),
    ("haiku", "v4b", True, False, True, "Haiku v4b"),
    ("deepseek", "v0", False, False, False, "DS v0"),
    ("deepseek", "v1", False, False, False, "DS v1"),
    ("deepseek", "v2", False, False, False, "DS v2"),
    ("deepseek", "v2", True, False, False, "DS v2+L"),
    ("deepseek", "v3", True, True, False, "DS v3+fixes"),
    ("deepseek", "v4a", True, False, True, "DS v4a"),
    ("deepseek", "v4b", True, False, True, "DS v4b"),
]

rows = []
for path in sorted(glob.glob(str(HERE / "results" / "*.jsonl"))):
    if "smoke" in path:
        continue
    for line in open(path):
        rows.append(json.loads(line))

by_arm = collections.defaultdict(list)
for row in rows:
    key = (
        row["model"],
        row["instructions"],
        row.get("lenient", False),
        row.get("v3_surface", False),
        row.get("v4_surface", False),
    )
    by_arm[key].append(row)


def cell(batch, field):
    if not batch:
        return "-"
    return f"{sum(r[field] for r in batch)}/{len(batch)}"


print("### Correct final configuration, by task\n")
head = "| Task | What it asks | " + " | ".join(a[5] for a in ARMS) + " |"
print(head)
print("|---|---|" + "---|" * len(ARMS))
for tid in TASK_IDS:
    cells = []
    for model, version, lenient, v3_surface, v4_surface, _ in ARMS:
        batch = [
            r
            for r in by_arm[(model, version, lenient, v3_surface, v4_surface)]
            if r["task"] == tid
        ]
        cells.append(cell(batch, "correct"))
    print(f"| {tid} | {TITLES[tid]} | " + " | ".join(cells) + " |")
totals = []
for model, version, lenient, v3_surface, v4_surface, _ in ARMS:
    batch = by_arm[(model, version, lenient, v3_surface, v4_surface)]
    totals.append(cell(batch, "correct"))
print("| **all** | | " + " | ".join(f"**{t}**" for t in totals) + " |")

print("\n### Pipeline rates (all tasks pooled)\n")
print(
    "| Arm | n | called the tool | valid JSON (first call) | engine accepted | correct |"
)
print("|---|---|---|---|---|---|")
for model, version, lenient, v3_surface, v4_surface, label in ARMS:
    batch = by_arm[(model, version, lenient, v3_surface, v4_surface)]
    if not batch:
        continue
    n = len(batch)

    def pct(field):
        return f"{cell(batch, field)} ({100 * sum(r[field] for r in batch) // n}%)"

    print(
        f"| {label} | {n} | {pct('tool_call_made')} | {pct('json_ok')} | "
        f"{pct('engine_accepted')} | {pct('correct')} |"
    )

print("\n### Recovery tasks: did the model fix itself within two retries?\n")
print("| Arm | f (409 conflict) | g (ambiguous anchor) | h (wrong folder) |")
print("|---|---|---|---|")
for model, version, lenient, v3_surface, v4_surface, label in ARMS:
    arm = by_arm[(model, version, lenient, v3_surface, v4_surface)]
    if not arm:
        continue
    cells = []
    for tid in ("f", "g", "h"):
        batch = [r for r in arm if r["task"] == tid]
        if not batch:
            cells.append("-")
            continue
        first = sum(1 for r in batch if r["correct"] and r["attempts_used"] == 1)
        after = sum(1 for r in batch if r["correct"] and r["attempts_used"] > 1)
        never = len(batch) - first - after
        cells.append(f"{first} first call, {after} after retry, {never} never")
    print(f"| {label} | " + " | ".join(cells) + " |")

print("\n### Cost\n")
print("| Arm | input tokens | output tokens |")
print("|---|---|---|")
for model, version, lenient, v3_surface, v4_surface, label in ARMS:
    batch = by_arm[(model, version, lenient, v3_surface, v4_surface)]
    if not batch:
        continue
    print(
        f"| {label} | {sum(r['input_tokens'] for r in batch):,} | "
        f"{sum(r['output_tokens'] for r in batch):,} |"
    )
