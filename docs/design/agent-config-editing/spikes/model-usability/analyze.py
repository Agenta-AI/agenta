# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Summarize result files: rates per task, and the failure modes with examples."""

import argparse
import collections
import glob
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
import tasks as T  # noqa: E402

TASK_IDS = [t.tid for t in T.TASKS]


def classify(record):
    """One short label per failure."""
    if record["correct"]:
        return "correct"
    error = record["error"] or ""
    if error.startswith("api:") or "failed after" in error:
        return "harness/api error"
    if error == "no tool call":
        if record["attempts_used"] > 1:
            return "gave up and asked the user"
        return "answered in prose, never called the tool"
    if error == "unparseable tool arguments":
        return "malformed JSON arguments"
    if error.startswith("wrong result:"):
        return "engine accepted, wrong config: " + error[len("wrong result: ") :]
    if error.startswith("gave up"):
        codes = []
        for attempt in record["attempts"]:
            reason = (attempt.get("error") or {}).get("reason") or {}
            codes.append(reason.get("code") or (attempt.get("error") or {}).get("code"))
        return "3 rejections: " + ",".join(str(c) for c in codes)
    return error[:80]


def load(paths):
    rows = []
    for path in paths:
        for line in open(path):
            rows.append(json.loads(line))
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("globs", nargs="+")
    parser.add_argument("--failures", action="store_true")
    args = parser.parse_args()

    files = []
    for pattern in args.globs:
        files.extend(sorted(glob.glob(pattern)))
    rows = load(files)

    groups = collections.defaultdict(list)
    for row in rows:
        # (lenient, v3_surface, v4_surface) together identify one interface cohort. Two
        # arms sharing `instructions` but differing in surface must not pool their rates.
        key = (
            row["model"],
            row["instructions"],
            row.get("lenient", False),
            row.get("v3_surface", False),
            row.get("v4_surface", False),
        )
        groups[key].append(row)

    for key in sorted(groups):
        model, version, rich, v3_surface, v4_surface = key
        arm = groups[key]
        surface = "v4" if v4_surface else "v3" if v3_surface else "flat"
        label = f"{model} / {version}" + (" + lenient interface" if rich else "")
        label += f" [{surface}]"
        print(f"\n=== {label}  (n={len(arm)}) ===")
        header = "  task  tool_call  json_ok  engine_ok  correct"
        print(header)
        for tid in TASK_IDS:
            batch = [r for r in arm if r["task"] == tid]
            if not batch:
                continue
            n = len(batch)
            print(
                f"  {tid:>4}  {sum(r['tool_call_made'] for r in batch)}/{n:<8} "
                f"{sum(r['json_ok'] for r in batch)}/{n:<6} "
                f"{sum(r['engine_accepted'] for r in batch)}/{n:<8} "
                f"{sum(r['correct'] for r in batch)}/{n}"
            )
        n = len(arm)
        print(
            f"  ALL   {sum(r['tool_call_made'] for r in arm)}/{n:<8} "
            f"{sum(r['json_ok'] for r in arm)}/{n:<6} "
            f"{sum(r['engine_accepted'] for r in arm)}/{n:<8} "
            f"{sum(r['correct'] for r in arm)}/{n}"
        )
        # recovery tasks
        for tid in ("f", "g", "h"):
            batch = [r for r in arm if r["task"] == tid]
            if not batch:
                continue
            first_try = sum(1 for r in batch if r["correct"] and r["attempts_used"] == 1)
            after = sum(1 for r in batch if r["correct"] and r["attempts_used"] > 1)
            print(
                f"  recovery {tid}: correct first call {first_try}, "
                f"correct after a retry {after}, never {len(batch) - first_try - after}"
            )

    print("\n=== failure modes (all arms) ===")
    counter = collections.Counter()
    example = {}
    for row in rows:
        label = classify(row)
        if label == "correct":
            continue
        counter[label] += 1
        example.setdefault(label, row)
    for label, count in counter.most_common():
        row = example[label]
        print(f"  {count:>3}  [{row['model']}/{row['instructions']} task {row['task']}] {label}")

    if args.failures:
        print("\n=== verbatim examples ===")
        for label in counter:
            row = example[label]
            print(f"\n--- {label} :: {row['model']}/{row['instructions']} task {row['task']} trial {row['trial']}")
            for attempt in row["attempts"]:
                if attempt.get("no_tool_call"):
                    print("   NO TOOL CALL, model said:")
                    print("   " + attempt["text"][:700].replace("\n", "\n   "))
                    continue
                print(f"   attempt {attempt['attempt']} sent:")
                print("   " + json.dumps(attempt["envelope"], ensure_ascii=False)[:900])
                if attempt.get("error"):
                    print("   -> " + json.dumps(attempt["error"], ensure_ascii=False)[:400])
            if row["error"] and row["error"].startswith("wrong result"):
                print("   -> " + row["error"][:300])


if __name__ == "__main__":
    main()
