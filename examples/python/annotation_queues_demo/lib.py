"""Shared HTTP client for the Agenta API. Reads credentials from
~/.agenta-linkflow.env (or the env vars AGENTA_API_KEY / AGENTA_HOST).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx


ENV_FILE = Path.home() / ".agenta-linkflow.env"


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_env_file(ENV_FILE)


AGENTA_API_KEY = os.environ.get("AGENTA_API_KEY")
AGENTA_HOST = os.environ.get("AGENTA_HOST", "https://cloud.agenta.ai").rstrip("/")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

if not AGENTA_API_KEY:
    sys.exit(
        f"AGENTA_API_KEY not set. Add it to {ENV_FILE} or export it before running."
    )


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"ApiKey {AGENTA_API_KEY}",
        "Content-Type": "application/json",
    }


def api_post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    url = f"{AGENTA_HOST}{path}"
    resp = httpx.post(url, json=body, headers=_headers(), timeout=60.0)
    if resp.status_code >= 400:
        print(f"POST {path} -> {resp.status_code}", file=sys.stderr)
        print(resp.text, file=sys.stderr)
        resp.raise_for_status()
    return resp.json()


def api_get(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{AGENTA_HOST}{path}"
    resp = httpx.get(url, params=params, headers=_headers(), timeout=60.0)
    if resp.status_code >= 400:
        print(f"GET {path} -> {resp.status_code}", file=sys.stderr)
        print(resp.text, file=sys.stderr)
        resp.raise_for_status()
    return resp.json()


def pretty(label: str, payload: Any) -> None:
    print(f"\n=== {label} ===")
    print(json.dumps(payload, indent=2, default=str))


# --- demo constants ----------------------------------------------------------

APP_SLUG = "agenta-docs-bot"
APP_NAME = "Agenta Docs Bot"

TESTSET_SLUG = "agenta-faq"
TESTSET_NAME = "Agenta FAQ"

EVAL_REFERENCE_ANSWER_SLUG = "reference-answer"
EVAL_TRACE_CORRECTNESS_SLUG = "trace-correctness"

ENV_SLUG = "production"
