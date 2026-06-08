"""Print a per-case, per-evaluator summary for a finished evaluation run.

    cd examples/python/hotel_agent/draft
    uv run python evals/summarize.py <run_id>

Pulls the run's result records, then fetches each evaluator's annotation trace to
read back the score / success / detail it produced. Read-only; hits only the
Agenta REST API.
"""

from __future__ import annotations

import os
import sys
from collections import defaultdict
from pathlib import Path

import httpx
from dotenv import load_dotenv

_DRAFT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_DRAFT_ROOT / ".env")

HOST = os.environ["AGENTA_HOST"].rstrip("/")
KEY = os.environ["AGENTA_API_KEY"]
_HEADERS = {"Authorization": f"ApiKey {KEY}", "Content-Type": "application/json"}


def _span_of(trace: dict) -> dict:
    spans = next(iter(trace.get("traces", {}).values()), {}).get("spans", {})
    return next(iter(spans.values()), {})


def _detail(slug: str, out: dict) -> str:
    if slug == "rubric_correctness":
        return f"{out.get('passed')}/{out.get('total')} rubrics"
    if slug == "tool_usage":
        bits = []
        if out.get("missing"):
            bits.append(f"missing={out['missing']}")
        if out.get("used_forbidden"):
            bits.append(f"forbidden={out['used_forbidden']}")
        return ", ".join(bits) or f"ok ({out.get('tools_used')})"
    if slug == "faithful_pricing":
        if out.get("unfaithful_prices"):
            return f"unfaithful={out['unfaithful_prices']}"
        return out.get("note") or f"ok ({out.get('prices_found')})"
    return ""


def main(run_id: str) -> None:
    with httpx.Client(timeout=30.0) as client:
        results = client.post(
            f"{HOST}/api/evaluations/results/query",
            headers=_HEADERS,
            json={"run_id": run_id},
        ).json()["results"]
        rows = [
            r
            for r in results
            if r.get("run_id") == run_id and r["step_key"].startswith("evaluator")
        ]

        per_case: dict[str, dict] = defaultdict(dict)
        messages: dict[str, str] = {}
        for r in rows:
            trace = client.get(
                f"{HOST}/api/tracing/traces/{r['trace_id']}", headers=_HEADERS
            ).json()
            span = _span_of(trace)
            data = span.get("attributes", {}).get("ag", {}).get("data", {})
            slug = (
                span.get("attributes", {})
                .get("ag", {})
                .get("references", {})
                .get("evaluator", {})
                .get("slug", span.get("span_name", "?"))
            )
            out = data.get("outputs", {})
            msg = data.get("inputs", {}).get("message", r["scenario_id"])
            messages[r["scenario_id"]] = msg
            per_case[r["scenario_id"]][slug] = out

    evals = ["rubric_correctness", "tool_usage", "faithful_pricing"]
    tally = {e: [0, 0] for e in evals}  # [passed, total]

    print(f"\nRun {run_id}: {len(per_case)} cases\n" + "=" * 78)
    for i, (sid, outs) in enumerate(per_case.items(), 1):
        msg = messages[sid]
        print(f"\n{i:>2}. {msg[:70]}")
        for e in evals:
            out = outs.get(e)
            if not out:
                continue
            ok = bool(out.get("success"))
            tally[e][1] += 1
            tally[e][0] += int(ok)
            mark = "PASS" if ok else "FAIL"
            print(f"      [{mark}] {e:<20} {_detail(e, out)}")

    print("\n" + "=" * 78)
    print("Overall:")
    for e in evals:
        p, t = tally[e]
        print(f"  {e:<20} {p}/{t} passed")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: uv run python evals/summarize.py <run_id>")
    main(sys.argv[1])
