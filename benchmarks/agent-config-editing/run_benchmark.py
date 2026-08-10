# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""The agent-config-editing one-shot benchmark, wire tier.

    uv run run_benchmark.py --cell claude-haiku-local --trials 3
    uv run run_benchmark.py --all-cells --trials 5 --threshold 0.95

Re-runnable against ANY deployment from three environment variables — AGENTA_BASE,
AGENTA_PROJECT_ID, AGENTA_API_KEY — or an --env-file holding them. Nothing else about the target
stack is assumed.

WHAT A RUN PRODUCES

  results/<utc-stamp>/results.json   every trial: verdict, checks, wire evidence, usage, cost
  results/<utc-stamp>/summary.md     the cell x scenario one-shot table
  results/MANIFEST.md                one appended line per run: when, what, where, the score

The results directory is append-only. A benchmark whose history can be edited cannot show that a
wording change helped, which is the entire point of the improvement loop.

EXIT CODE

  0  every cell met the threshold and no hard fail fired
  1  the run missed the threshold, or a hard fail fired, or a cell could not be measured

A gate that always exits 0 is invisible to CI and to release automation, so a real miss fails the
process rather than printing red text a human might not read (the lesson `qa_product.py` records).
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys
import time
import traceback

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import bench_lib as B  # noqa: E402

# A leg that cannot run because the deployment lacks a credential is SKIPPED with its reason, never
# quietly omitted and never counted as a pass. A skip is an untested claim.
#
# THE MARKERS MUST BE SPECIFIC, AND THE FIRST VERSION WAS NOT. It matched the bare word
# "connection", which also appears in "All connection attempts failed" and "peer closed connection
# without sending complete message body". Four genuine TRANSPORT failures on pi-haiku were
# therefore labelled "missing credential" and SKIPPED — removed from the denominator, so the cell
# scored 12/44 when it should have scored 12/48, and four real failures disappeared from the
# result rather than counting against it.
#
# That is the precise failure this benchmark exists to shout about, committed by the benchmark:
# a skip is an untested claim, and a MISCLASSIFIED skip is worse, because it hides a real failure
# behind a reassuring word. Transport errors are checked FIRST and never skip; they fall through
# to `unsettled`, which is a counted, visible, failing outcome.
TRANSPORT_MARKERS = (
    "connection attempts failed",
    "peer closed connection",
    "incomplete chunked read",
    "connection reset",
    "connection refused",
    "timed out",
    "read timeout",
)

MISSING_CREDENTIAL_MARKERS = (
    "not found for provider",
    "no connections",
    "multiple connections",
    "ambiguous connection",
    "requires a mounted subscription",
    "missing credential",
    "no credential",
    "provider_key",
    "does not support value",
)


def looks_like_missing_credential(text: str) -> bool:
    lowered = (text or "").lower()
    if any(marker in lowered for marker in TRANSPORT_MARKERS):
        return False
    return any(marker in lowered for marker in MISSING_CREDENTIAL_MARKERS)


# ---------------------------------------------------------------------------
# Driving one scenario turn
# ---------------------------------------------------------------------------


def run_turn(
    session_id: str, msgs: list, params: dict, references: dict, max_rounds: int
):
    """One scenario turn: invoke, auto-approve every gate it raises, until it settles.

    Approving is the right default for a benchmark about whether the model can complete the task:
    a denial measures the refusal path, which the release gate already covers. Every gate is
    counted, so an approval-heavy trial is visible in the results even though it is not penalized.

    Returns (wire turns, gates answered, status, messages for the next turn)."""
    w = B.wire()
    turns, gates = [], 0
    for _ in range(max_rounds):
        t = w.invoke(session_id, msgs, params, references, log=False)
        turns.append(t)
        if t.errors:
            return (
                turns,
                gates,
                {"settled": False, "why": f"wire errors: {t.errors}"},
                msgs,
            )
        if not t.approval:
            return turns, gates, {"settled": True}, msgs + [t.assistant_message()]
        gates += 1
        msgs = msgs + [w.approval_reply(t, approved=True)]
    return (
        turns,
        gates,
        {"settled": False, "why": f"still gated after {max_rounds} rounds"},
        msgs,
    )


def run_trial(cell_id: str, cell: dict, scenario: dict, index: int) -> dict:
    """One trial: a fresh agent, the scenario's turns, the stored-row verdict, then archive.

    The workflow is created here and archived in `finally`, so a crash mid-trial leaves no agent
    behind in the project. Create/destroy per trial is what keeps trial N+1 measuring the task the
    scenario states rather than whatever trial N left behind."""
    w = B.wire()
    token = B.new_token()
    started = time.time()
    record: dict = {
        "cell": cell_id,
        "scenario": scenario["id"],
        "class": scenario["class"],
        "trial": index,
        "token": token,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started)),
    }
    trial = None
    try:
        trial = B.create_trial_agent(
            cell, scenario, token, f"{cell_id}-{scenario['id']}"
        )
        record["workflow_id"] = trial["workflow_id"]

        # The RUN parameters mount the platform tools; the SEEDED baseline does not. That split is
        # deliberate: `read_config`/`commit_revision` are the surface under test, not part of the
        # configuration the model is asked to edit, and a baseline carrying them would make every
        # `stored_unchanged_except` check argue with the harness instead of with the model.
        run_agent = json.loads(json.dumps(trial["seeded_agent"]))
        run_agent["tools"] = B.LIVE_TOOLS + (scenario.get("tools") or [])
        params = {"agent": run_agent}
        references = w.refs(
            trial["workflow_id"], trial["variant_id"], trial["baseline_revision_id"]
        )

        session_id = str(__import__("uuid").uuid4())
        record["session_id"] = session_id
        msgs: list = []
        groups: list = []
        gates_total = 0
        settled = {"settled": True}
        for turn_index, turn_spec in enumerate(scenario["turns"]):
            before = turn_spec.get("before_turn")
            if before and before.get("action") == "commit_out_of_band":
                moved = B.commit_out_of_band(
                    trial,
                    before["patch"],
                    token,
                    before.get("message", "out-of-band change"),
                )
                record.setdefault("out_of_band", []).append(
                    {
                        "turn": turn_index,
                        "revision_id": moved.get("id"),
                        "version": moved.get("version"),
                    }
                )
            msgs = msgs + [w.user_msg(B.substitute_token(turn_spec["prompt"], token))]
            wire_turns, gates, settled, msgs = run_turn(
                session_id, msgs, params, references, scenario["budget"]["max_rounds"]
            )
            groups.append(wire_turns)
            gates_total += gates
            if not settled.get("settled"):
                break

        # A missing or ambiguous credential arrives as a wire ERROR, not as an exception, so it
        # never reaches the `except` below. Without this it was scored as a model FAIL: the pi
        # cells on a project with two OpenAI connections read "the reply does not carry the token"
        # when the truth was "this cell was never measured". A skip must say so.
        if not settled.get("settled") and looks_like_missing_credential(
            settled.get("why", "")
        ):
            record.update(
                {
                    "skip": True,
                    "one_shot": False,
                    "eventual": False,
                    "why": f"cell {cell_id} could not be measured: {settled.get('why', '')[:400]}",
                    "duration_s": round(time.time() - started, 1),
                }
            )
            return record

        time.sleep(
            1.0
        )  # the commit lands through the API; give the row a moment to be readable
        stored, version = B.stored_agent(trial["workflow_id"])
        ctx = B.Ctx(
            stored=stored,
            seeded=trial["seeded_agent"],
            groups=groups,
            token=token,
            baseline_version=trial["baseline_version"],
            final_version=version,
        )
        checks = B.evaluate_checks(scenario["checks"], ctx)
        flat = ctx.turns
        errors = B.tool_error_details(flat)
        repeats = B.identical_repeat_after_refusal(flat)
        commit_calls = B.count_calls(flat, "commit_revision")
        budget = scenario["budget"]

        failures = [c for c in checks if c["failure"]]
        functional = not failures and settled.get("settled", False)
        within_budget = (
            settled.get("settled", False)
            and len(errors) <= budget["max_tool_errors"]
            and commit_calls <= budget["max_commit_calls"]
        )
        # The global instrument. A model that re-sends a refused call verbatim has read `retryable`
        # and ignored `next_step`, and that is a hard fail wherever it happens — including in a
        # scenario that never expected a refusal at all.
        hard_fails = []
        if repeats:
            hard_fails.append(
                {"instrument": "identical_call_resent_after_refusal", "detail": repeats}
            )

        outcome = B.classify_outcome(
            turns=flat,
            passed_checks=functional,
            within_budget=within_budget,
            settled=settled.get("settled", False),
            hard_failed=bool(hard_fails),
        )
        record.update(
            {
                "outcome": outcome,
                "infra_signature": B.infra_signature(flat),
                "blocked_only_by_harness": B.blocked_only_by_harness(
                    errors, commit_calls, budget
                ),
                "one_shot": bool(functional and within_budget and not hard_fails),
                "eventual": bool(functional and not hard_fails),
                "settled": settled,
                "checks": checks,
                "failures": [
                    {"check": c["check"], "why": c["failure"]} for c in failures
                ],
                "hard_fails": hard_fails,
                "wire": {
                    "tool_calls": [
                        {"name": call["toolName"], "outcome": call["outcome"]}
                        for call in B.distinct_calls(flat)
                    ],
                    "tool_errors": errors,
                    "commit_calls": commit_calls,
                    "approval_gates": gates_total,
                    "wire_turns": len(flat),
                    "finish_reasons": [t.finish_reason for t in flat],
                },
                "usage": B.usage_of(flat),
                "final_reply": (flat[-1].reply[-500:] if flat else ""),
            }
        )
        if not record["one_shot"]:
            # Kept only for a failing trial: enough to diagnose without carrying every passing
            # trial's full argument payloads into an append-only history. The FULL reply is part
            # of that evidence, because `described_no_action` is decided on what the model said,
            # and a truncated tail would decide it on a fragment.
            record["full_reply"] = "\n\n".join(t.reply for t in flat)
            record["debug_calls"] = [
                {
                    "name": call["toolName"],
                    "input": call["input"],
                    "outcome": call["outcome"],
                    "error": (call["payload"] or {}).get("errorText", "")[:600],
                }
                for call in B.distinct_calls(flat)
            ]
    except Exception as e:  # a crash is a result, not a reason to lose the run
        detail = f"{type(e).__name__}: {e}"
        record["one_shot"] = False
        record["eventual"] = False
        if looks_like_missing_credential(detail):
            record["skip"] = True
            record["why"] = f"missing credential for cell {cell_id}: {detail}"
        else:
            record["error"] = detail
            record["traceback"] = traceback.format_exc()[-1500:]
    finally:
        if trial:
            w.archive(trial["workflow_id"])
    record["duration_s"] = round(time.time() - started, 1)
    return record


# ---------------------------------------------------------------------------
# Skips a scenario declares for itself
# ---------------------------------------------------------------------------


def scenario_skip_reason(scenario: dict, cell: dict | None = None) -> str | None:
    if cell and cell["harness"] in (scenario.get("unsupported_harness") or []):
        return scenario.get(
            "unsupported_reason", f"not supported on the {cell['harness']} harness"
        )
    for requirement in scenario.get("requires") or []:
        if requirement == "gateway":
            connected = B.connected_integrations()
            if connected is None:
                return (
                    "the deployment has no gateway (Composio) provider configured, so a "
                    "committed-without-connection assertion would prove nothing"
                )
        else:
            return f"unknown requirement {requirement!r}"
    return None


# ---------------------------------------------------------------------------
# Scoring and the table
# ---------------------------------------------------------------------------


def score(trials: list) -> dict:
    """Aggregate a set of trials.

    `one_shot_excl_harness_rate` is the same number with harness errors forgiven — a trial that
    would have been one-shot but for a malformed tool-input serialization or an EISDIR. It reads
    from the stored record, so an old results file re-scores under a new definition without being
    re-run, which is what keeps an append-only history comparable. Report BOTH: the raw rate is
    what a user experiences, and the corrected rate is what a wording change can actually move."""
    measured = [t for t in trials if not t.get("skip")]
    excused = [
        t
        for t in measured
        if not t.get("one_shot")
        and t.get("eventual")
        and t.get("blocked_only_by_harness")
    ]
    return {
        "one_shot_excl_harness": sum(1 for t in measured if t.get("one_shot"))
        + len(excused),
        "harness_blocked": len(excused),
        "one_shot_excl_harness_rate": (
            round(
                (sum(1 for t in measured if t.get("one_shot")) + len(excused))
                / len(measured),
                3,
            )
            if measured
            else None
        ),
        "trials": len(trials),
        "measured": len(measured),
        "skipped": len(trials) - len(measured),
        "one_shot": sum(1 for t in measured if t.get("one_shot")),
        "eventual": sum(1 for t in measured if t.get("eventual")),
        "hard_fails": sum(1 for t in measured if t.get("hard_fails")),
        "one_shot_rate": (
            round(sum(1 for t in measured if t.get("one_shot")) / len(measured), 3)
            if measured
            else None
        ),
        "eventual_rate": (
            round(sum(1 for t in measured if t.get("eventual")) / len(measured), 3)
            if measured
            else None
        ),
        "cost_usd": round(
            sum((t.get("usage") or {}).get("cost", 0.0) for t in trials), 4
        ),
        "tokens": sum((t.get("usage") or {}).get("total", 0) for t in trials),
    }


def build_summary(results: dict, threshold: float) -> str:
    """The cell x scenario one-shot table, plus the error-then-fix gap.

    Two numbers per cell, always: one-shot and eventual. Reporting only one of them is how a
    product that errors on half its turns and recovers reports itself as correct."""
    cell_ids = list(results["cells"])
    scenario_ids = results["scenarios"]
    lines = [
        f"# One-shot config editing — {results['run']['started_at']}",
        "",
        f"threshold {threshold:.0%} one-shot · deployment `{results['run']['base']}` · "
        f"HEAD `{results['run']['stamps']['_head']['commit']}`",
        "",
        "## One-shot rate by cell and scenario",
        "",
        "| cell | "
        + " | ".join(scenario_ids)
        + " | one-shot | excl. harness | eventual | cost |",
        "|" + "---|" * (len(scenario_ids) + 5),
    ]
    for cell_id in cell_ids:
        cell = results["cells"][cell_id]
        row = []
        for sid in scenario_ids:
            trials = cell["scenarios"].get(sid, {}).get("trials", [])
            if not trials:
                row.append("—")
                continue
            if all(t.get("skip") for t in trials):
                row.append("SKIP")
                continue
            s = score(trials)
            mark = "!" if s["hard_fails"] else ""
            row.append(f"{s['one_shot']}/{s['measured']}{mark}")
        total = score(
            [t for sc in cell["scenarios"].values() for t in sc.get("trials", [])]
        )
        one = "—" if total["one_shot_rate"] is None else f"{total['one_shot_rate']:.0%}"
        ev = "—" if total["eventual_rate"] is None else f"{total['eventual_rate']:.0%}"
        corrected = (
            "—"
            if total["one_shot_excl_harness_rate"] is None
            else f"{total['one_shot_excl_harness_rate']:.0%}"
        )
        lines.append(
            f"| {cell_id} | " + " | ".join(row) + f" | {one} | {corrected} | {ev} | "
            f"${total['cost_usd']:.2f} |"
        )
    lines += [
        "",
        "`n/m` is one-shot passes over measured trials. `!` marks a cell where a hard-fail "
        "instrument fired. `SKIP` is untested, never a pass.",
        "",
        "**`excl. harness`** forgives trials that would have been one-shot but for a runtime "
        "failure carrying no error code — a malformed tool-input serialization, an EISDIR. `one-"
        "shot` is what a user experiences; `excl. harness` is what an instruction change can "
        "actually move, and the distance between them is a plumbing bug worth its own fix. Runs "
        "recorded before this column existed show the two as equal.",
        "",
        "## Scenario totals across cells",
        "",
        "| scenario | class | one-shot | eventual | gap | top failure |",
        "|---|---|---|---|---|---|",
    ]
    for sid in scenario_ids:
        trials = [
            t
            for cell in results["cells"].values()
            for t in cell["scenarios"].get(sid, {}).get("trials", [])
        ]
        s = score(trials)
        if s["one_shot_rate"] is None:
            lines.append(f"| {sid} | | SKIP | SKIP | | |")
            continue
        gap = s["eventual_rate"] - s["one_shot_rate"]
        reasons: dict = {}
        for t in trials:
            for f in t.get("failures") or []:
                reasons[f["check"]] = reasons.get(f["check"], 0) + 1
            for e in (t.get("wire") or {}).get("tool_errors") or []:
                if e.get("code"):
                    reasons[e["code"]] = reasons.get(e["code"], 0) + 1
        top = max(reasons.items(), key=lambda kv: kv[1])[0] if reasons else ""
        cls = next(
            (
                cell["scenarios"][sid]["class"]
                for cell in results["cells"].values()
                if sid in cell["scenarios"]
            ),
            "",
        )
        lines.append(
            f"| {sid} | {cls} | {s['one_shot_rate']:.0%} | {s['eventual_rate']:.0%} | "
            f"{gap:+.0%} | {top} |"
        )
    lines += [
        "",
        "`gap` is the error-then-fix rate: work the model got right only after a refusal. The goal "
        "drives it to zero, not just `eventual` to 100%.",
        "",
        "## Failure shapes",
        "",
        "Two cells can score the same and need opposite fixes, so a failure is labelled by SHAPE. "
        "`described_no_action` (knew the mechanism, never reached for it) wants directive "
        "guidance; `attempt_refused` (reached for it and got the details wrong) wants a mechanical "
        "correction; `wrong_surface` (did the job in the workspace and reported success) wants a "
        "location sentence. A wording change that moves one and not the others is only visible "
        "here.",
        "",
        "| cell | " + " | ".join(B.FAILING_OUTCOMES) + " |",
        "|" + "---|" * (len(B.FAILING_OUTCOMES) + 1),
    ]
    for cell_id, cell in results["cells"].items():
        trials = [t for sc in cell["scenarios"].values() for t in sc["trials"]]
        counts = collections.Counter(
            t.get("outcome") for t in trials if not t.get("skip")
        )
        row = [str(counts.get(label, 0)) for label in B.FAILING_OUTCOMES]
        lines.append(f"| {cell_id} | " + " | ".join(row) + " |")
    worst = collections.Counter()
    for cell in results["cells"].values():
        for sid, sc in cell["scenarios"].items():
            for t in sc["trials"]:
                if t.get("outcome") in B.FAILING_OUTCOMES:
                    worst[(sid, t["outcome"])] += 1
    if worst:
        lines += [
            "",
            "| scenario | shape | trials |",
            "|---|---|---|",
        ]
        for (sid, shape), n in worst.most_common(12):
            lines.append(f"| {sid} | {shape} | {n} |")
    lines += [
        "",
        "## Protocol version stamps",
        "",
        "The instruction surfaces these numbers measure. A results file read against different "
        "text is a different measurement.",
        "",
        "| surface | path | commit | sha256 | dirty |",
        "|---|---|---|---|---|",
    ]
    for label, stamp in results["run"]["stamps"].items():
        if label == "_head":
            continue
        lines.append(
            f"| {label} | `{stamp['path']}` | `{stamp.get('commit', '')}` | "
            f"`{stamp.get('sha256', '')}` | {'YES' if stamp.get('dirty') else 'no'} |"
        )
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--cell", action="append", help="cell id; repeatable")
    p.add_argument("--all-cells", action="store_true")
    p.add_argument("--scenario", action="append", help="scenario id; repeatable")
    p.add_argument(
        "--class", dest="klass", action="append", help="scenario class; repeatable"
    )
    p.add_argument("--trials", type=int, default=3)
    p.add_argument("--tier", default="wire", choices=sorted(B.TIERS))
    p.add_argument("--env-file")
    p.add_argument(
        "--threshold",
        type=float,
        default=0.95,
        help="one-shot rate a measured cell must reach for exit code 0 (default: Mahmoud's 0.95)",
    )
    p.add_argument("--out", help="results directory (default: results/<utc-stamp>)")
    p.add_argument(
        "--list", action="store_true", help="list cells and scenarios, then exit"
    )
    p.add_argument(
        "--no-preflight",
        action="store_true",
        help="skip the endpoint health probe. Only for deliberately measuring a broken stack.",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="resolve everything and print the plan without spending a single token",
    )
    args = p.parse_args()

    if args.tier != "wire":
        raise SystemExit(
            f"tier {args.tier!r} is not built.\n{B.TIERS[args.tier]}\n"
            "Implement it by replacing run_turn() only."
        )

    creds = B.resolve_credentials(args.env_file)
    scenarios = B.load_scenarios(only=args.scenario, classes=args.klass)
    all_cells = B.cells()
    cell_ids = (
        list(all_cells) if args.all_cells else (args.cell or ["claude-haiku-local"])
    )
    unknown = [c for c in cell_ids if c not in all_cells]
    if unknown:
        raise SystemExit(f"unknown cell(s): {unknown}\nknown: {', '.join(all_cells)}")

    if args.list:
        print("CELLS")
        for cid, cell in all_cells.items():
            print(
                f"  {cid:26s} {cell['harness']:8s} {cell['model']:36s} "
                f"{cell['sandbox']:8s} {cell['connection']['mode']}"
            )
        print("\nSCENARIOS")
        for s in B.load_scenarios():
            print(f"  {s['id']:42s} {s['class']:14s} {s['title']}")
        return 0

    plan = len(cell_ids) * len(scenarios) * args.trials
    print(
        f"tier={args.tier} cells={len(cell_ids)} scenarios={len(scenarios)} "
        f"trials={args.trials} -> {plan} trials against {creds['base']}",
        file=sys.stderr,
    )
    if args.dry_run:
        for cid in cell_ids:
            for s in scenarios:
                print(f"  {cid} x {s['id']} x{args.trials}")
        return 0

    # PRE-FLIGHT BEFORE SPEND. A direct, model-free probe of the endpoints under test. On 6 August
    # a migration broke `read_config` on a stack whose own suite was green, and this benchmark
    # spent 63 trials before noticing; every result had to be quarantined. Refusing to start costs
    # one throwaway workflow. Not refusing cost half an hour and a run nobody could read.
    if args.no_preflight:
        health = {"ok": None, "skipped": True, "checks": []}
    else:
        print("preflight ...", end=" ", flush=True, file=sys.stderr)
        health = B.preflight(all_cells[cell_ids[0]])
        for check in health["checks"]:
            if not check["ok"]:
                print(
                    f"\n  FAIL {check['check']}: HTTP {check.get('status', '?')} "
                    f"{str(check.get('detail', ''))[:200]}",
                    file=sys.stderr,
                )
        if not health["ok"]:
            print(
                "\nPREFLIGHT FAILED — refusing to spend trials against a deployment that cannot "
                "serve the endpoints under test. Such a run measures the outage, not the model. "
                "Re-run when the deployment is healthy, or pass --no-preflight to override.",
                file=sys.stderr,
            )
            return 1
        print("ok", file=sys.stderr)

    stamps = B.protocol_stamps()
    outdir = pathlib.Path(args.out) if args.out else B.RESULTS_DIR / B.utc_stamp()
    outdir.mkdir(parents=True, exist_ok=True)

    results: dict = {
        "run": {
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "tier": args.tier,
            "trials_per_cell_scenario": args.trials,
            "threshold": args.threshold,
            "base": creds["base"],
            "project_id": creds["project_id"],
            "credentials_context": creds["credentials_context"],
            "stamps": stamps,
            "preflight": health,
        },
        "scenarios": [s["id"] for s in scenarios],
        "scenario_defs": {
            s["id"]: {k: v for k, v in s.items() if k != "seed"} for s in scenarios
        },
        "cells": {},
    }

    for cell_id in cell_ids:
        cell = all_cells[cell_id]
        results["cells"][cell_id] = {"config": cell, "scenarios": {}}
        for scenario in scenarios:
            entry = {"class": scenario["class"], "trials": []}
            results["cells"][cell_id]["scenarios"][scenario["id"]] = entry
            skip = scenario_skip_reason(scenario, cell)
            for i in range(1, args.trials + 1):
                label = f"[{cell_id}] {scenario['id']} #{i}"
                if skip:
                    entry["trials"].append(
                        {
                            "cell": cell_id,
                            "scenario": scenario["id"],
                            "trial": i,
                            "skip": True,
                            "why": skip,
                        }
                    )
                    print(f"{label} SKIP — {skip}", file=sys.stderr)
                    continue
                record = run_trial(cell_id, cell, scenario, i)
                entry["trials"].append(record)
                verdict = (
                    "SKIP"
                    if record.get("skip")
                    else (
                        "ONE-SHOT"
                        if record.get("one_shot")
                        else ("recovered" if record.get("eventual") else "FAIL")
                    )
                )
                why = (
                    record.get("why")
                    or record.get("error")
                    or (record.get("failures") or [{}])[0].get("why", "")
                )
                print(
                    f"{label} {verdict} ({record['duration_s']}s, "
                    f"${(record.get('usage') or {}).get('cost', 0):.3f}) {why[:110]}",
                    file=sys.stderr,
                )
                (outdir / "results.json").write_text(
                    json.dumps(results, indent=2, default=str)
                )

    (outdir / "results.json").write_text(json.dumps(results, indent=2, default=str))
    summary = build_summary(results, args.threshold)
    (outdir / "summary.md").write_text(summary)
    print("\n" + summary)

    all_trials = [
        t
        for cell in results["cells"].values()
        for sc in cell["scenarios"].values()
        for t in sc["trials"]
    ]
    overall = score(all_trials)
    results["score"] = overall
    (outdir / "results.json").write_text(json.dumps(results, indent=2, default=str))

    append_manifest(outdir, results, overall)

    print(f"\nresults: {outdir}", file=sys.stderr)

    # Three independent reasons to fail the process, and they are reported separately because they
    # mean different things: a threshold miss is a model/instruction result, a hard fail is a
    # regression, and an unmeasured cell is an absence of evidence.
    reasons = []
    if overall["one_shot_rate"] is None:
        reasons.append("nothing was measured (every trial skipped or errored)")
    elif overall["one_shot_rate"] < args.threshold:
        reasons.append(
            f"one-shot rate {overall['one_shot_rate']:.0%} below threshold "
            f"{args.threshold:.0%}"
        )
    if overall["hard_fails"]:
        reasons.append(
            f"{overall['hard_fails']} trial(s) tripped a hard-fail instrument"
        )
    if overall["skipped"]:
        reasons.append(f"{overall['skipped']} trial(s) SKIPPED — untested, not passed")
    for reason in reasons:
        print(f"MISS: {reason}", file=sys.stderr)
    return 1 if reasons else 0


def append_manifest(outdir: pathlib.Path, results: dict, overall: dict) -> None:
    """One line per run, appended, never rewritten.

    The manifest is the only place a reader can see the SHAPE of the history — that a wording
    change was measured before and after, on the same cells, against stamped text. A results
    directory without it is a pile of timestamps."""
    manifest = B.RESULTS_DIR / "MANIFEST.md"
    if not manifest.exists():
        manifest.write_text(
            "# Run manifest\n\nAppend-only. One line per benchmark run. A row whose path is "
            "marked `(outside results/)` is a harness-validation run written to scratch, "
            "not a measurement — read the in-tree rows.\n\n"
            "| run | cells | scenarios | trials | one-shot | eventual | hard fails | skipped | "
            "cost | tool desc | guidance |\n"
            "|---|---|---|---|---|---|---|---|---|---|---|\n"
        )
    stamps = results["run"]["stamps"]

    def stamp(label: str) -> str:
        entry = stamps.get(label, {})
        return f"{entry.get('sha256', '?')}{'*' if entry.get('dirty') else ''}"

    rate = (
        "—" if overall["one_shot_rate"] is None else f"{overall['one_shot_rate']:.0%}"
    )
    ev = "—" if overall["eventual_rate"] is None else f"{overall['eventual_rate']:.0%}"
    # A run written outside `results/` — a --out to scratch, which is how the harness itself gets
    # debugged — records its absolute path instead of a relative link that would point at nothing.
    # The manifest must never link to a file that is not there.
    try:
        link = f"[{outdir.name}]({outdir.relative_to(B.RESULTS_DIR)}/summary.md)"
    except ValueError:
        link = f"`{outdir}` (outside results/)"
    with manifest.open("a") as fh:
        fh.write(
            f"| {link} | {len(results['cells'])} | "
            f"{len(results['scenarios'])} | {overall['trials']} | {rate} | {ev} | "
            f"{overall['hard_fails']} | {overall['skipped']} | ${overall['cost_usd']:.2f} | "
            f"`{stamp('tool_descriptions')}` | `{stamp('platform_guidance')}` |\n"
        )


if __name__ == "__main__":
    raise SystemExit(main())
