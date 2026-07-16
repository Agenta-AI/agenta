# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""Minimal wire probe: can we drive the product path (/services/agent/v0/invoke) at all?

Sends one turn with an inline agent config and prints every SSE frame type seen, plus the
assistant text. If this works, the full QA driver is just scenarios on top of it.

  uv run qa_probe.py --harness pi_core --sandbox local --model gpt-5.6-luna
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import uuid

import httpx

# Credentials come from the environment FIRST (AGENTA_BASE, AGENTA_PROJECT_ID, AGENTA_API_KEY),
# then from an env file (default below, overridable with --env-file). Resolved in main() so that
# --help works with no credentials present.
REQUIRED_CREDS = ("AGENTA_BASE", "AGENTA_PROJECT_ID", "AGENTA_API_KEY")
DEFAULT_ENV_FILE = pathlib.Path.home() / ".agenta-bighetzner.env"

BASE = ""
PROJECT = ""
KEY = ""


def _read_env_file(path: pathlib.Path) -> dict:
    values: dict = {}
    path = pathlib.Path(path).expanduser()
    if not path.exists():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            values[k.strip()] = v.strip()
    return values


def resolve_credentials(env_file: str | pathlib.Path | None = None) -> None:
    """Populate BASE/PROJECT/KEY from the environment first, then the env file. Raises SystemExit
    naming exactly which credentials are missing."""
    global BASE, PROJECT, KEY
    file_values = _read_env_file(env_file or DEFAULT_ENV_FILE)
    resolved: dict = {}
    missing: list = []
    for name in REQUIRED_CREDS:
        value = os.environ.get(name) or file_values.get(name)
        if value:
            resolved[name] = value
        else:
            missing.append(name)
    if missing:
        raise SystemExit(
            "Missing credentials: "
            + ", ".join(missing)
            + f".\nSet them as environment variables or pass --env-file <path> "
            f"(default: {DEFAULT_ENV_FILE})."
        )
    BASE = resolved["AGENTA_BASE"]
    PROJECT = resolved["AGENTA_PROJECT_ID"]
    KEY = resolved["AGENTA_API_KEY"]


def agent_template(harness: str, sandbox: str, model: str, provider: str) -> dict:
    return {
        "instructions": {"agents_md": "Be terse. Do exactly what is asked."},
        "llm": {
            "model": model,
            "provider": provider,
            "connection": {"mode": "agenta", "slug": None},
            "extras": {},
        },
        "tools": [],
        "mcps": [],
        "skills": [],
        "harness": {"kind": harness},
        "sandbox": {"kind": sandbox},
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--harness", default="pi_core")
    p.add_argument("--sandbox", default="local")
    p.add_argument("--model", default="gpt-5.6-luna")
    p.add_argument("--provider", default="openai")
    p.add_argument("--msg", default="Reply with exactly: PONG")
    p.add_argument(
        "--env-file",
        help=f"credentials file (fallback when env vars are unset; default {DEFAULT_ENV_FILE})",
    )
    args = p.parse_args()

    resolve_credentials(args.env_file)

    session_id = str(uuid.uuid4())
    url = f"{BASE}/services/agent/v0/invoke"
    body = {
        "session_id": session_id,
        "data": {
            "inputs": {
                "messages": [
                    {
                        "id": str(uuid.uuid4()),
                        "role": "user",
                        "parts": [{"type": "text", "text": args.msg}],
                    }
                ]
            },
            "parameters": {
                "agent": agent_template(
                    args.harness, args.sandbox, args.model, args.provider
                )
            },
        },
    }
    headers = {
        "Authorization": f"ApiKey {KEY}",
        "Accept": "text/event-stream",
        "x-ag-messages-format": "vercel",
        "Content-Type": "application/json",
    }

    print(f"session={session_id}", file=sys.stderr)
    frames: list[str] = []
    text: list[str] = []
    with httpx.Client(timeout=180.0) as client:
        with client.stream(
            "POST", url, params={"project_id": PROJECT}, json=body, headers=headers
        ) as r:
            print(f"HTTP {r.status_code}", file=sys.stderr)
            if r.status_code >= 400:
                print(r.read().decode()[:2000])
                return 1
            for line in r.iter_lines():
                if not line or line.startswith(":"):
                    continue
                if not line.startswith("data: "):
                    continue
                payload = line[6:]
                if payload == "[DONE]":
                    break
                try:
                    frame = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                t = frame.get("type", "?")
                frames.append(t)
                if t == "text-delta":
                    text.append(frame.get("delta", ""))
                if t in ("error", "finish", "tool-approval-request"):
                    print(f"  !! {t}: {json.dumps(frame)[:400]}", file=sys.stderr)

    print("\n--- frame types (in order, deduped consecutive) ---")
    dedup = [f for i, f in enumerate(frames) if i == 0 or frames[i - 1] != f]
    print(" -> ".join(dedup))
    print("\n--- assistant text ---")
    print("".join(text).strip() or "(empty)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
