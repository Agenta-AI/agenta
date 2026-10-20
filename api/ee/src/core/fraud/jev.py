"""One Noul question to TypeSafe's Jev model over the HTTP API (`POST /v1/systemone`)."""

import asyncio
from typing import Any, Optional

import httpx

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

# The whole call, connect included. A slow vendor must not slow signup or key creation.
JEV_TIMEOUT_SECONDS = 2.0

_QUESTION_ID = "fraud"


def _build_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=env.typesafe.api_url,
        timeout=JEV_TIMEOUT_SECONDS,
        headers={"Authorization": f"Bearer {env.typesafe.api_key}"},
    )


async def ask_noul(*, state: Any, question: str) -> Optional[float]:
    """The probability that the answer to `question` about `state` is yes, or None when
    Jev gave no usable answer within the timeout. The caller treats None as allow."""
    if not env.typesafe.enabled:
        log.warning("[fraud] TypeSafe API key not configured; no score")
        return None

    payload = {
        "model": env.typesafe.model,
        "state": state,
        "questions": {_QUESTION_ID: {"type": "noul", "instructions": question}},
    }

    try:
        async with asyncio.timeout(JEV_TIMEOUT_SECONDS):
            async with _build_client() as client:
                response = await client.post("/v1/systemone", json=payload)
                response.raise_for_status()
                score = response.json()["answers"][_QUESTION_ID]["noul"]
        return float(score)
    except Exception as exc:
        log.warning("[fraud] Jev call failed; no score", reason=repr(exc))
        return None
