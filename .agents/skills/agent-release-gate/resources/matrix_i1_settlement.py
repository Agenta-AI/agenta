# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: coached, mechanism-level. No model behaviour is asserted.

I1: the interaction-card settlement table against a live API.

This cell creates rows directly through `POST /sessions/interactions/` because it pins the ROW
lifecycle contract, not whether a model chooses to raise a particular card. Driving nine real
agent turns would add cost and model variance without exercising a different persistence path.

For every card kind it covers complete, decline, and walk away:

  - `user_approval` complete/decline -> `resolved` with a strict verdict.
  - `user_input` complete/decline -> `responded` with the browser's open resolution envelope.
  - `client_tool` complete/decline -> `responded` with the browser's open resolution envelope.
  - every walk-away row stays `pending` until a later-turn `cancel-stale` call moves it to
    `cancelled`, without inventing a resolution.

WIRE-LEVEL CAVEAT. This script has no browser. Recording a form or client-tool answer is the
CLIENT's job, so the cell itself sends the browser's ONE atomic `/transition` call with status and
resolution together. A purely in-band tool-output resume would correctly leave the row pending
until the sweep cancelled it; that would test abandonment, not answer recording.

The cell also proves `resolved` remains approval-only by requiring HTTP 409 for both non-approval
kinds. It deliberately does not assert rendering, replay, popup behaviour, or model discovery.

  uv run matrix_i1_settlement.py
"""

import json
import pathlib
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import api_call  # noqa: E402


def create_row(*, session_id: str, turn_id: str, token: str, kind: str) -> dict:
    tool_name = "request_input" if kind == "user_input" else "request_connection"
    if kind == "user_approval":
        tool_name = "create_schedule"
    response = api_call(
        "POST",
        "/sessions/interactions/",
        json={
            "session_id": session_id,
            "turn_id": turn_id,
            "token": token,
            "kind": kind,
            "data": {
                "request": {
                    "tool": tool_name,
                    "tool_call_id": f"call-{token}",
                }
            },
        },
    )
    if response.status_code != 200:
        raise RuntimeError(
            f"create {kind} row HTTP {response.status_code}: {response.text[:300]}"
        )
    return response.json()["interaction"]


def fetch_row(interaction_id: str) -> dict:
    response = api_call("GET", f"/sessions/interactions/{interaction_id}")
    if response.status_code != 200:
        raise RuntimeError(
            f"fetch interaction HTTP {response.status_code}: {response.text[:300]}"
        )
    return response.json()["interaction"]


def answer(
    *, session_id: str, token: str, status: str, resolution: dict
) -> tuple[int, dict | None, str]:
    response = api_call(
        "POST",
        "/sessions/interactions/transition",
        json={
            "session_id": session_id,
            "token": token,
            "status": status,
            "resolution": resolution,
        },
    )
    interaction = None
    if response.status_code == 200:
        interaction = response.json().get("interaction")
    return response.status_code, interaction, response.text[:300]


def resolution_for(kind: str, outcome: str, token: str) -> tuple[str, dict]:
    tool_call_id = f"call-{token}"
    if kind == "user_approval":
        return "resolved", {
            "verdict": "approved" if outcome == "complete" else "denied",
            "tool_call_id": tool_call_id,
        }
    if kind == "user_input":
        output = (
            {"action": "accept", "content": {"timezone": "UTC"}}
            if outcome == "complete"
            else {"action": "decline"}
        )
        return "responded", {
            "tool_call_id": tool_call_id,
            "tool_name": "request_input",
            "outcome": "completed",
            "output": output,
        }
    output = (
        {"connected": True, "integration": "telegram", "slug": "telegram"}
        if outcome == "complete"
        else {
            "connected": False,
            "integration": "telegram",
            "slug": "telegram",
            "reason": "declined",
        }
    )
    return "responded", {
        "tool_call_id": tool_call_id,
        "tool_name": "request_connection",
        "outcome": "completed",
        "output": output,
    }


def run_case(kind: str, outcome: str) -> dict:
    session_id = str(uuid.uuid4())
    token = f"i1-{kind}-{outcome}-{uuid.uuid4().hex[:8]}"
    row = create_row(
        session_id=session_id,
        turn_id="turn-1",
        token=token,
        kind=kind,
    )

    if outcome == "walk_away":
        sweep = api_call(
            "POST",
            "/sessions/interactions/cancel-stale",
            json={"session_id": session_id, "turn_id": "turn-2"},
        )
        final = fetch_row(row["id"])
        resolution = (final.get("data") or {}).get("resolution")
        ok = (
            sweep.status_code == 200
            and sweep.json().get("cancelled") == 1
            and final.get("status") == "cancelled"
            and resolution is None
        )
        return {
            "kind": kind,
            "outcome": outcome,
            "status": "PASS" if ok else "FAIL",
            "why": (
                "the later-turn sweep cancelled the still-pending row without inventing an answer"
                if ok
                else (
                    f"sweep_http={sweep.status_code}, cancelled="
                    f"{sweep.json().get('cancelled') if sweep.status_code == 200 else None}, "
                    f"final_status={final.get('status')!r}, resolution={resolution!r}"
                )
            ),
            "interaction_id": row["id"],
            "final_status": final.get("status"),
            "saved_resolution": resolution,
        }

    expected_status, resolution = resolution_for(kind, outcome, token)
    http_status, transitioned, detail = answer(
        session_id=session_id,
        token=token,
        status=expected_status,
        resolution=resolution,
    )
    final = fetch_row(row["id"])
    saved = (final.get("data") or {}).get("resolution")
    ok = (
        http_status == 200
        and transitioned is not None
        and final.get("status") == expected_status
        and saved == resolution
    )
    return {
        "kind": kind,
        "outcome": outcome,
        "status": "PASS" if ok else "FAIL",
        "why": (
            f"the answer settled as {expected_status} with its exact resolution"
            if ok
            else (
                f"transition_http={http_status}, expected_status={expected_status!r}, "
                f"final_status={final.get('status')!r}, expected_resolution={resolution!r}, "
                f"saved_resolution={saved!r}, detail={detail!r}"
            )
        ),
        "interaction_id": row["id"],
        "final_status": final.get("status"),
        "saved_resolution": saved,
    }


def resolved_refusal(kind: str) -> dict:
    session_id = str(uuid.uuid4())
    token = f"i1-resolved-refusal-{kind}-{uuid.uuid4().hex[:8]}"
    create_row(
        session_id=session_id,
        turn_id="turn-1",
        token=token,
        kind=kind,
    )
    _, resolution = resolution_for(kind, "complete", token)
    http_status, _, detail = answer(
        session_id=session_id,
        token=token,
        status="resolved",
        resolution=resolution,
    )
    return {
        "kind": kind,
        "status": "PASS" if http_status == 409 else "FAIL",
        "why": (
            "the API refused non-approval `resolved` with HTTP 409"
            if http_status == 409
            else f"expected HTTP 409, got {http_status}: {detail}"
        ),
        "http_status": http_status,
    }


def i1() -> dict:
    cases = [
        run_case(kind, outcome)
        for kind in ("user_approval", "user_input", "client_tool")
        for outcome in ("complete", "decline", "walk_away")
    ]
    refusals = [resolved_refusal(kind) for kind in ("user_input", "client_tool")]
    failures = [r for r in cases + refusals if r["status"] != "PASS"]
    return {
        "status": "PASS" if not failures else "FAIL",
        "why": (
            "all nine settlement cases and both approval-only guards matched the contract"
            if not failures
            else " | ".join(
                f"{r.get('kind')}/{r.get('outcome', 'resolved')}: {r['why']}"
                for r in failures
            )
        ),
        "cases": cases,
        "non_approval_resolved_refusals": refusals,
    }


if __name__ == "__main__":
    try:
        result = i1()
    except Exception as error:  # noqa: BLE001
        result = {
            "status": "FAIL",
            "why": f"unhandled exception: {type(error).__name__}: {error}",
        }
    print("\n=== I1 RESULT ===")
    print(json.dumps(result, indent=2, default=str))
    sys.exit(0 if result["status"] == "PASS" else 1)
