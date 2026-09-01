# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: mechanical (no model discovery). Every case is a malformed configuration driven straight
at the product API. Never cite this cell for a model behaviour claim.

H1: a malformed harness must fail closed. The harness value selects which coding agent a run
drives (`harness.kind`, one of `pi_core` / `claude` / `codex`). The invariant this cell pins is
narrow and absolute:

  A malformed harness must produce a STRUCTURED REFUSAL at some boundary, and must NEVER run as a
  silent Pi turn.

The dangerous failure is not a crash. It is a DEFAULT: a config whose harness the platform cannot
read, quietly resolved to whichever harness the code falls back to, running a full turn and
storing output the user never asked for. That output looks legitimate afterwards -- the stored
turn row carries a real `harness_kind` -- so nothing downstream can tell it apart from a run the
user configured. The refusal is the only place the truth exists.

WHICH BOUNDARY REFUSES IS NOT THE POINT, AND THE CELL SAYS SO. Three boundaries can legitimately
own the refusal, and the cell records which one did rather than demanding a particular one:

  commit_api     the workflow revision API refuses to persist the malformed config (a clean 4xx).
  invoke_http    `/services/agent/v0/invoke` refuses the request before streaming.
  runner_stream  the run starts and the SDK/runner streams a coded `data-agent-error`.

Per the code as of v0.114.4, the deepest of those is `HarnessKind.coerce` in
`sdks/python/agenta/sdk/agents/dtos.py`, reached from `make_harness` in
`sdks/python/agenta/sdk/agents/adapters/harnesses.py:158`. `coerce` normalizes the value and calls
`cls(normalized)`, which raises `ValueError` for anything that is not a member -- a wrong-type
value included, since `str(value).lower()` of an int is not a member either. A refusal at an outer
boundary is BETTER, not worse, and passes here.

  PASS  a boundary refused, the refusal names the harness, and no turn produced output.
  FAIL  a turn executed and stored output (the defaulted-harness failure this cell exists for).
  FAIL  nothing refused, or the refusal is unattributable to the harness.
  SKIP  the run failed for an unrelated infra reason (credentials), so the invariant was never
        reached. Printed with the exact reason.

  uv run matrix_h1_bad_harness.py
"""

import copy
import json
import pathlib
import re
import sys
import time
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (  # noqa: E402
    agent_config,
    archive,
    commit_direct,
    create_workflow,
    invoke,
    refs,
    seed_and_baseline,
    turn_ledger_or_unavailable,
    user_msg,
)

#: A refusal must be attributable to the harness. A generic 500, or a refusal about something
#: else entirely, does not prove the harness was checked.
HARNESS_REFUSAL = re.compile(r"harness|\bkind\b", re.I)

#: An HTTP failure `invoke` recorded on the turn, as `HTTP <status>: <body>`.
HTTP_STATUS = re.compile(r"^HTTP (\d{3}):")

MISSING_CREDENTIAL_MARKERS = (
    "connection",
    "not found for provider",
    "no connections",
    "multiple connections",
    "credential",
    "subscription",
    "oauth",
)

#: Each case is a harness block the platform must not be able to read. `wrong_type` is the one the
#: brief calls for; the other two cover the neighbouring shapes a client can send by accident.
CASES = {
    "wrong_type": {"kind": 12345},
    "unknown_string": {"kind": "not_a_harness"},
    "null_kind": {"kind": None},
}


#: The one FAIL shape that is already known, filed, and NOT a fresh regression.
#:
#: A cleared harness (`{"kind": None}`) is not rejected: it silently defaults to `pi_core`, so on
#: any config whose model spelling suits Pi the turn runs and this cell goes red. That is SF2,
#: found by this cell and deliberately filed rather than fixed for this release.
#:
#: The FAIL is NOT softened, because the invariant really is broken -- a malformed harness ran.
#: What the name buys is that the next reader recognizes it in a gate report instead of chasing it
#: as new breakage, which is how W5's standing red is handled. When SF2 is fixed this case turns
#: green on its own and `known_finding` stops appearing; that is the signal to delete this.
SF2_NOTE = (
    "known finding SF2 (cleared harness silently defaults to pi_core), filed for the "
    "next release -- expected red, not a fresh regression"
)


def known_finding(harness: dict, stored_harnesses: list) -> str | None:
    """The note for a FAIL shape that is already filed, or None when the failure is new.

    Narrow on purpose: only a CLEARED harness, and only when nothing contradicts the default.
    A wrong-type or unknown-string harness that runs is a different, unfiled defect and must read
    as one.
    """
    if harness.get("kind") is not None:
        return None
    if stored_harnesses and stored_harnesses != ["pi_core"]:
        return None
    return SF2_NOTE


def bad_config(harness: dict) -> dict:
    cfg = copy.deepcopy(agent_config())
    cfg["harness"] = harness
    return cfg


def coded_errors(turn) -> list[dict]:
    return [
        f.get("data") or {}
        for f in turn.raw_frames
        if f.get("type") == "data-agent-error"
    ]


def probe(wf: str, var: str, references: dict, name: str, harness: dict) -> dict:
    """Drive one malformed harness at both boundaries and report which refused."""
    cfg = bad_config(harness)
    boundaries: list[str] = []
    detail: dict = {"case": name, "harness": harness}

    # Boundary 1: can the malformed config even be PERSISTED? A clean 4xx here is a pass, and it
    # is the outermost place the invariant can hold.
    try:
        r = commit_direct(
            wf,
            var,
            {"agent": cfg},
            f"h1 {name}",
            f"qa-h1-{name}-{uuid.uuid4().hex[:6]}",
        )
        detail["commit_status"] = r.status_code
        detail["commit_body"] = r.text[:300]
        if 400 <= r.status_code < 500 and HARNESS_REFUSAL.search(r.text):
            boundaries.append("commit_api")
    except Exception as e:  # noqa: BLE001 -- a transport fault here is evidence, not a crash
        detail["commit_status"] = None
        detail["commit_body"] = f"{type(e).__name__}: {e}"

    # Boundary 2 and 3: run it. The references point at a VALID baseline, so the only malformed
    # thing in the request is the live harness -- nothing else can explain a refusal.
    session_id = str(uuid.uuid4())
    detail["session_id"] = session_id
    turn = invoke(
        session_id,
        [user_msg("Reply with exactly the word READY and nothing else.")],
        {"agent": cfg},
        references,
        log=False,
    )
    detail["frames"] = turn.frames

    coded = coded_errors(turn)
    codes = [c.get("code") for c in coded if c.get("code")]
    error_text = " ".join(
        [str(c.get("errorText") or "") for c in coded] + list(turn.errors)
    )
    detail["error_codes"] = codes
    detail["error_text"] = error_text[:400]

    http_refusals = [
        int(m.group(1))
        for m in (HTTP_STATUS.match(e) for e in turn.errors)
        if m is not None
    ]
    if any(400 <= s < 500 for s in http_refusals) and HARNESS_REFUSAL.search(
        error_text
    ):
        boundaries.append("invoke_http")
    if codes and HARNESS_REFUSAL.search(error_text):
        boundaries.append("runner_stream")
    detail["http_status"] = http_refusals or None

    # The failure this cell exists for: a turn that RAN. Read it back from storage, because a
    # defaulted harness is only visible after the fact as a stored row with a real harness_kind.
    time.sleep(1.0)
    ledger, ledger_available = turn_ledger_or_unavailable(session_id)
    stored_harnesses = sorted(
        {row.get("harness_kind") for row in ledger if row.get("harness_kind")}
    )
    produced_output = bool(turn.reply.strip()) or bool(turn.tool_calls)
    detail["stored_turn_rows"] = len(ledger)
    detail["stored_harness_kinds"] = stored_harnesses
    detail["produced_output"] = produced_output
    detail["ledger_available"] = ledger_available
    detail["reply"] = turn.reply.strip()[:120]

    # EXECUTION EVIDENCE OUTRANKS A LATER REFUSAL. A turn that emitted text or called a tool RAN,
    # and a `data-agent-error` arriving afterwards does not undo that: the malformed harness was
    # defaulted to something runnable first and complained second. The earlier version required
    # `not error_text`, so a streamed error let a genuinely defaulted run pass. A stored
    # harness_kind is the same evidence read from the other side, and is checked here too.
    if produced_output or stored_harnesses:
        detail["status"] = "FAIL"
        detail["why"] = (
            f"a malformed harness {harness!r} RAN: produced_output={produced_output}, stored "
            f"harness_kind={stored_harnesses} -- the harness was defaulted, not refused "
            f"(a later refusal does not undo an executed turn; error={error_text[:200]!r})"
        )
        known = known_finding(harness, stored_harnesses)
        if known:
            detail["known_finding"] = "SF2"
            detail["why"] = f"{detail['why']} -- {known}"
        return detail

    # A PASS here asserts that NOTHING was stored, so an unanswered ledger query cannot support
    # it: that would be the strongest claim drawn from the weakest evidence. `turn_ledger` alone
    # cannot tell "no rows" from "no answer", which is why this cell reads availability too.
    if not ledger_available:
        detail["status"] = "FAIL"
        detail["why"] = (
            "the turn ledger did not answer, so there is no evidence the malformed harness "
            f"stored nothing; refusing to infer a PASS from a failed query (boundaries={boundaries})"
        )
        return detail

    if boundaries:
        detail["status"] = "PASS"
        detail["refused_by"] = boundaries[0]
        detail["why"] = (
            f"refused at {boundaries[0]} (all refusing boundaries: {boundaries})"
        )
        return detail

    low = error_text.lower()
    if error_text and any(m in low for m in MISSING_CREDENTIAL_MARKERS):
        detail["status"] = "SKIP"
        detail["why"] = (
            "the run failed on credentials before any harness check, so the invariant was "
            f"never reached: {error_text[:200]}"
        )
        return detail

    detail["status"] = "FAIL"
    detail["why"] = (
        "no boundary refused the malformed harness in a way attributable to it "
        f"(commit={detail.get('commit_status')}, http={http_refusals}, codes={codes}, "
        f"error={error_text[:200]!r})"
    )
    return detail


def h1_bad_harness() -> dict:
    hexid = uuid.uuid4().hex[:8]
    # Created BEFORE the try so the `finally` can never raise UnboundLocalError over the real
    # result. A create that fails must surface its own SKIP or FAIL, not a cleanup crash on top
    # of it -- the cell's whole contract is that every outcome is explained.
    wf: str | None = None
    try:
        wf, var = create_workflow(hexid, "qa-h1harness")
        rev_id, _ver = seed_and_baseline(wf, var, agent_config(), hexid)
        references = refs(wf, var, rev_id)

        cases = [probe(wf, var, references, name, h) for name, h in CASES.items()]
        statuses = [c["status"] for c in cases]
        if "FAIL" in statuses:
            status = "FAIL"
            why = "; ".join(c["why"] for c in cases if c["status"] == "FAIL")
        elif all(s == "SKIP" for s in statuses):
            status = "SKIP"
            why = "; ".join(c["why"] for c in cases)
        else:
            status = "PASS"
            refused = {
                c["case"]: c.get("refused_by") for c in cases if c["status"] == "PASS"
            }
            skipped = [c["case"] for c in cases if c["status"] == "SKIP"]
            why = f"every readable case failed closed: {refused}"
            if skipped:
                why += f"; skipped (credentials, invariant not reached): {skipped}"
        return {
            "status": status,
            "why": why,
            "workflow_id": wf,
            "cases": cases,
        }
    except Exception as e:  # noqa: BLE001 -- classify infra faults as SKIP, never crash the run
        msg = str(e)
        if any(m in msg.lower() for m in MISSING_CREDENTIAL_MARKERS):
            return {
                "status": "SKIP",
                "why": f"missing or ambiguous vault credential: {msg}",
            }
        return {
            "status": "FAIL",
            "why": f"unhandled exception: {type(e).__name__}: {msg}",
        }
    finally:
        if wf is not None:
            archive(wf)


if __name__ == "__main__":
    r = h1_bad_harness()
    print("\n=== H1-BAD-HARNESS RESULT ===")
    print(json.dumps(r, indent=2, default=str))
    sys.exit(0 if r["status"] in ("PASS", "SKIP") else 1)
