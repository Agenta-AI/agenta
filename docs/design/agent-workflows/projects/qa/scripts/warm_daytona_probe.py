# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""Warm-daytona verification probe: timed turns against one session.

Drives the live agent service /invoke with sandbox=daytona and measures wall time per turn.
Turn 1 (no session header) is the cold create; turn 2 reuses the returned session id
immediately (park-to-running hit); a later rerun with --session <id> exercises the
stopped-restart path after the live window expires.

Usage:
  uv run warm_daytona_probe.py                 # cold turn + immediate warm turn
  uv run warm_daytona_probe.py --session <id>  # one more turn on an existing session
  uv run warm_daytona_probe.py --turns 1       # single cold turn only
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import time

import httpx

BASE = os.environ.get("AGENTA_BASE", "http://localhost:8280")
PROJ = os.environ.get("AGENTA_PROJECT_ID", "019e8df5-2a58-7501-8fe2-56f7b332bd00")
MODEL = os.environ.get("AGENTA_QA_MODEL", "openai/gpt-4o-mini")


def api_key() -> str:
    key = os.environ.get("AGENTA_API_KEY")
    if key:
        return key
    repo = pathlib.Path(__file__).resolve().parents[6]
    envf = repo / "examples/python/hotel_agent/draft/.env"
    for line in envf.read_text().splitlines():
        if line.startswith("AGENTA_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("no AGENTA_API_KEY in env or hotel-agent .env")


def turn(
    client: httpx.Client,
    key: str,
    history: list[dict],
    message: str,
    session_id: str | None,
) -> dict:
    messages = [*history, {"role": "user", "content": message}]
    body = {
        "data": {
            "inputs": {"messages": messages},
            "parameters": {
                "agent": {
                    "harness": {"kind": "pi_core"},
                    "sandbox": {"kind": "daytona"},
                    "llm": {"model": MODEL},
                    "instructions": {
                        "agents_md": "Reply with exactly the requested word and nothing else."
                    },
                }
            },
        }
    }
    headers = {"Authorization": f"ApiKey {key}", "content-type": "application/json"}
    if session_id:
        headers["x-ag-session-id"] = session_id
    started = time.monotonic()
    resp = client.post(
        f"{BASE}/services/agent/v0/invoke",
        params={"project_id": PROJ},
        headers=headers,
        json=body,
        timeout=240.0,
    )
    elapsed = time.monotonic() - started
    out: dict = {"wall_s": round(elapsed, 2), "http": resp.status_code}
    try:
        payload = resp.json()
        out["session_id"] = payload.get("session_id")
        data = payload.get("data") or {}
        outputs = data.get("outputs")
        if isinstance(outputs, dict) and isinstance(outputs.get("messages"), list):
            for msg in outputs["messages"]:
                if msg.get("role") == "assistant":
                    out["reply"] = (msg.get("content") or "")[:120]
        elif isinstance(outputs, dict):
            out["reply"] = (outputs.get("content") or "")[:120]
        out["status_message"] = ((payload.get("status") or {}).get("message") or "")[:200]
    except Exception as exc:  # noqa: BLE001
        out["parse_error"] = str(exc)
        out["raw"] = resp.text[:300]
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", default=None)
    ap.add_argument("--turns", type=int, default=2)
    ap.add_argument(
        "--wait-before-last",
        type=float,
        default=0.0,
        help="seconds to sleep before the final turn (to outlive the live window)",
    )
    args = ap.parse_args()

    key = api_key()
    session_id = args.session
    history: list[dict] = []
    with httpx.Client() as client:
        for index in range(args.turns):
            if args.wait_before_last and index == args.turns - 1:
                print(json.dumps({"sleeping_s": args.wait_before_last}))
                time.sleep(args.wait_before_last)
            word = f"PING{index + 1}"
            prompt = f"Reply with exactly the word {word}"
            result = turn(client, key, history, prompt, session_id)
            session_id = result.get("session_id") or session_id
            history.append({"role": "user", "content": prompt})
            history.append({"role": "assistant", "content": result.get("reply") or word})
            label = "cold" if index == 0 and not args.session else "warm-candidate"
            print(json.dumps({"turn": index + 1, "label": label, **result}))


if __name__ == "__main__":
    main()
