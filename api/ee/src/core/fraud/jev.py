"""One Noul question to TypeSafe's Jev model over the HTTP API (`POST /v1/systemone`)."""

import asyncio
import math
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
    # The state carries the user's email: never send it, or the key, in clear text.
    if not env.typesafe.api_url.startswith("https://"):
        log.warning("[fraud] TypeSafe API URL is not https; no score")
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
    except Exception as exc:
        # The class and the HTTP status only. An exception message can carry response
        # text, and the response can echo the email back.
        status = (
            exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
        )
        log.warning(
            "[fraud] Jev call failed; no score",
            reason=type(exc).__name__,
            status=status,
        )
        return None

    return _probability(score)


def _probability(score: Any) -> Optional[float]:
    """A finite probability in [0, 1], or None. A boolean, a string or an out-of-range
    number is not a score, so it can never flag anyone."""
    if isinstance(score, bool) or not isinstance(score, (int, float)):
        log.warning("[fraud] Jev score is not a number; no score")
        return None
    value = float(score)
    if not math.isfinite(value) or not 0.0 <= value <= 1.0:
        log.warning("[fraud] Jev score is out of range; no score")
        return None
    return value
