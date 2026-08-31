# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: mechanical (no model discovery). The prompt asks for one short reply, so the turn makes
ONE model call and makes it as early as a cold sandbox can. Never cite this cell for a model
behaviour claim; it tests credential DELIVERY, not the agent.

C5: the first-call placeholder race. On a Daytona run the real model key never enters the sandbox.
It is stored as a Daytona Secret, and the sandbox holds a `dtn_secret_<id>` placeholder that
Daytona substitutes into egress to the key's exact host. That substitution propagates
ASYNCHRONOUSLY with no confirmation signal (measured 10-24s after Secret creation). When a fresh
sandbox's FIRST outbound model call beats the propagation, the provider receives the raw
placeholder and refuses it with a 401.

WHAT THIS CELL PINS. Not that the race never happens -- it is a vendor-side timing property and it
will happen again. What it pins is that the race is never REPORTED AS THE USER'S FAULT. A
placeholder 401 is `credential_delivery_failed` with retry copy. The failure this cell exists to
catch is the production incident of 2026-08-30: a free-credits user hit the race and the product
told them to add their own OpenAI key, which was wrong three ways (their key was fine, adding one
would not have helped, and the run was retryable).

  PASS  the turn succeeds, OR the run fails with code `credential_delivery_failed`.
  FAIL  the run advises adding a key (a `starter_credits_*` code, or "add ... key" wording) while
        the underlying refusal carries the placeholder signature (`Received=dtn_`/`dtn_secret_`).
  FAIL  any other error, or a stored ledger row that never appeared.
  SKIP  the project vault has no usable Daytona connection (printed with the exact reason).

COLD START IS THE POINT. The cell mints a brand new workflow and variant per run, so the session
pool key has never been seen and the sandbox is necessarily created cold. A warm reuse would make
the cell green for the wrong reason -- a warm sandbox's Secret was substituted minutes ago.

STORED-ROW ASSERTION. The turns table has NO error column (verified against
`api/oss/src/dbs/postgres/sessions/turns/dbas.py`: session_id, turn_id, stream_id, turn_index,
harness_kind, agent_session_id, sandbox_id, references, trace_id, span_id, start_time, end_time).
So the stored assertion is the ledger ROW -- it must exist, and it must name the sandbox the turn
ran on. An empty ledger is MISSING EVIDENCE and fails; it is never read as stability. The coded
error surface is the `data-agent-error` frame, whose `code` field is the runner's stable class.

PROXY LOG. When the deployment is local AND docker is reachable, the cell also counts
`Received=dtn_` lines in the litellm-proxy container since the cell started, and reports the
count. That count is diagnostic, never a verdict: a race that the runner classified correctly is
a PASS even when the proxy logged the refusal. On a remote deployment the cell reports
"proxy log not reachable" and does not fail for it.

  uv run matrix_c5_first_call_race.py
"""

import json
import pathlib
import re
import subprocess
import sys
import time
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (  # noqa: E402
    BASE,
    archive,
    create_workflow,
    invoke,
    refs,
    seed_and_baseline,
    turn_ledger,
    user_msg,
)

BASELINE = "Be terse. Answer in one word."

#: The runner's own class for a placeholder-shaped refusal. Source of truth:
#: `services/runner/src/engines/sandbox_agent/errors.ts`.
CREDENTIAL_DELIVERY_FAILED = "credential_delivery_failed"

#: Codes whose user-facing copy tells the reader to add their own provider key. Correct when the
#: credits really are gone; a false accusation when the refusal was a placeholder.
ADD_A_KEY_CODES = (
    "starter_credits_exhausted",
    "starter_credits_program_paused",
    "starter_credits_unavailable",
)

#: The placeholder signature, mirroring `PLACEHOLDER_CREDENTIAL` in the runner's errors.ts. The
#: first alternative is LiteLLM refusing a non-`sk-` bearer; the second is any provider echoing
#: the placeholder itself.
PLACEHOLDER_SIGNATURE = re.compile(
    r"virtual key expected.*received=dtn_|dtn_secret_", re.I
)

#: Prose that advises adding a key, for a runner that reports the advice without one of the coded
#: classes above. Deliberately narrow: it must not match the honest retry copy.
ADD_A_KEY_WORDING = re.compile(
    r"add (?:your own |the project's |a )?[\w .'-]*\bkey\b", re.I
)

MISSING_CREDENTIAL_MARKERS = (
    "connection",
    "not found for provider",
    "no connections",
    "multiple connections",
    "credential",
)


def daytona_agent_config() -> dict:
    return {
        "instructions": {"agents_md": BASELINE},
        "llm": {
            "model": "haiku",
            "provider": "anthropic",
            "connection": {"mode": "agenta", "slug": None},
            "extras": {},
        },
        "tools": [],
        "mcps": [],
        "skills": [],
        "harness": {"kind": "claude"},
        "sandbox": {"kind": "daytona"},
    }


def _base_is_local() -> bool:
    return any(h in BASE for h in ("localhost", "127.0.0.1", "0.0.0.0"))


def _find_proxy_container() -> str | None:
    """The litellm-proxy container of the local stack, or None when docker cannot answer."""
    try:
        out = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}"],
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    names = [n.strip() for n in out.stdout.splitlines() if n.strip()]
    return next((n for n in names if "litellm" in n.lower()), None)


def count_proxy_placeholder_refusals(since: str) -> tuple[int | None, str]:
    """Count `Received=dtn_` lines in the proxy log since `since`.

    Returns `(count, why)`. A `None` count means the log was not reachable, which is reported and
    never failed on: a remote deployment has no docker socket to ask.
    """
    if not _base_is_local():
        return None, f"proxy log not reachable (AGENTA_BASE={BASE} is not local)"
    container = _find_proxy_container()
    if container is None:
        return None, "proxy log not reachable (no litellm container in `docker ps`)"
    try:
        out = subprocess.run(
            ["docker", "logs", container, "--since", since],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as e:
        return None, f"proxy log not reachable (docker logs {container} failed: {e})"
    lines = (out.stdout + out.stderr).splitlines()
    hits = [ln for ln in lines if "Received=dtn_" in ln]
    return len(
        hits
    ), f"{len(hits)} `Received=dtn_` line(s) in {container} since {since}"


def agent_error_frames(turn) -> list[dict]:
    """Every coded runner error the turn streamed, as `{"code", "errorText"}` payloads."""
    return [
        f.get("data") or {}
        for f in turn.raw_frames
        if f.get("type") == "data-agent-error"
    ]


def c5_first_call_race() -> dict:
    hexid = uuid.uuid4().hex[:8]
    # A brand new workflow is a pool key never seen before, so the sandbox is created cold and the
    # first model call is genuinely a first call. This is the whole premise of the cell.
    wf, var = create_workflow(hexid, "qa-c5race")
    started_at = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
    try:
        cfg = daytona_agent_config()
        rev_id, _ver = seed_and_baseline(wf, var, cfg, hexid)
        references = refs(wf, var, rev_id)
        session_id = str(uuid.uuid4())

        # One short prompt, no tools: the turn's first act is the model call, so it lands as early
        # after sandbox create as the product allows.
        turn = invoke(
            session_id,
            [user_msg("Reply with exactly the word READY and nothing else.")],
            {"agent": cfg},
            references,
        )

        coded = agent_error_frames(turn)
        codes = [c.get("code") for c in coded if c.get("code")]
        error_text = " ".join(
            [str(c.get("errorText") or "") for c in coded] + list(turn.errors)
        )
        placeholder_seen = bool(PLACEHOLDER_SIGNATURE.search(error_text))
        proxy_count, proxy_why = count_proxy_placeholder_refusals(started_at)

        # The stored row, read back from the API. Empty is missing evidence, never stability.
        time.sleep(1.0)
        ledger = turn_ledger(session_id)
        stored_sandboxes = sorted(
            {row.get("sandbox_id") for row in ledger if row.get("sandbox_id")}
        )
        evidence = {
            "session_id": session_id,
            "workflow_id": wf,
            "stored_turn_rows": len(ledger),
            "stored_sandbox_ids": stored_sandboxes,
            "error_codes": codes,
            "placeholder_signature_seen": placeholder_seen,
            "proxy_placeholder_refusals": proxy_count,
            "proxy_log": proxy_why,
            "frames": turn.frames,
        }

        # The incident, in one condition: add-a-key advice over a placeholder refusal.
        advises_key = any(c in ADD_A_KEY_CODES for c in codes) or bool(
            ADD_A_KEY_WORDING.search(error_text)
        )
        if advises_key and placeholder_seen:
            return {
                "status": "FAIL",
                "why": (
                    "a placeholder refusal was reported as the user's key problem: "
                    f"codes={codes}, error={error_text[:400]!r}"
                ),
                **evidence,
            }

        if CREDENTIAL_DELIVERY_FAILED in codes:
            if not ledger:
                return {
                    "status": "FAIL",
                    "why": (
                        "classified as credential_delivery_failed, but no stored turn row came "
                        "back from /sessions/turns/query -- missing evidence, not stability"
                    ),
                    **evidence,
                }
            return {
                "status": "PASS",
                "why": (
                    "the race fired and was classified honestly as "
                    f"{CREDENTIAL_DELIVERY_FAILED} with retry copy; {proxy_why}"
                ),
                **evidence,
            }

        if turn.errors or codes:
            low = error_text.lower()
            if any(m in low for m in MISSING_CREDENTIAL_MARKERS):
                return {
                    "status": "SKIP",
                    "why": (
                        "missing or ambiguous Daytona vault credential, so the first-call race "
                        f"was never reached: {error_text[:300]}"
                    ),
                    **evidence,
                }
            return {
                "status": "FAIL",
                "why": f"turn failed for another reason: codes={codes}, error={error_text[:400]!r}",
                **evidence,
            }

        if not ledger:
            return {
                "status": "FAIL",
                "why": (
                    "the turn reported success but no stored turn row came back from "
                    "/sessions/turns/query -- missing evidence, not stability"
                ),
                **evidence,
            }
        if not turn.reply.strip():
            return {
                "status": "FAIL",
                "why": "the turn produced neither an error nor any text (a silent turn)",
                **evidence,
            }
        return {
            "status": "PASS",
            "why": (
                f"first call on a cold Daytona sandbox succeeded, reply={turn.reply.strip()[:40]!r}; "
                f"{proxy_why}"
            ),
            **evidence,
        }
    except Exception as e:  # noqa: BLE001 -- classify infra faults as SKIP, never crash the run
        msg = str(e)
        if any(m in msg.lower() for m in MISSING_CREDENTIAL_MARKERS):
            return {
                "status": "SKIP",
                "why": f"missing or ambiguous Daytona vault credential: {msg}",
            }
        return {
            "status": "FAIL",
            "why": f"unhandled exception: {type(e).__name__}: {msg}",
        }
    finally:
        archive(wf)


if __name__ == "__main__":
    r = c5_first_call_race()
    print("\n=== C5-FIRST-CALL-RACE RESULT ===")
    print(json.dumps(r, indent=2, default=str))
    sys.exit(0 if r["status"] in ("PASS", "SKIP") else 1)
