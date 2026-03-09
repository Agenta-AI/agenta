import httpx

from supertokens_python.framework.request import BaseRequest

from oss.src.services.exceptions import UnauthorizedException
from oss.src.utils.common import is_ee
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
TURNSTILE_TOKEN_HEADER = "x-turnstile-token"
TURNSTILE_FAILURE_MESSAGE = "Security check failed. Please try again."

log = get_module_logger(__name__)


def is_turnstile_enabled() -> bool:
    return is_ee() and env.auth.turnstile_enabled


def _extract_client_ip(request: BaseRequest) -> str | None:
    for header_name in ("cf-connecting-ip", "x-forwarded-for", "x-real-ip"):
        header_value = request.get_header(header_name)
        if header_value:
            return header_value.split(",")[0].strip()

    return None


async def verify_turnstile_or_raise(*, request: BaseRequest) -> None:
    if not is_turnstile_enabled():
        return

    token = (request.get_header(TURNSTILE_TOKEN_HEADER) or "").strip()
    if not token:
        raise UnauthorizedException(detail="Please complete the security check.")

    payload = {
        "secret": env.auth.turnstile_secret_key or "",
        "response": token,
    }

    remote_ip = _extract_client_ip(request)
    if remote_ip:
        payload["remoteip"] = remote_ip

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(TURNSTILE_VERIFY_URL, data=payload)
            response.raise_for_status()
        verification_result = response.json()
    except httpx.HTTPError:
        log.error("[AUTH] Turnstile verification request failed", exc_info=True)
        raise UnauthorizedException(detail=TURNSTILE_FAILURE_MESSAGE) from None

    if verification_result.get("success") is True:
        return

    log.warning(
        "[AUTH] Turnstile verification failed error_codes=%s hostname=%s action=%s",
        verification_result.get("error-codes"),
        verification_result.get("hostname"),
        verification_result.get("action"),
    )
    raise UnauthorizedException(detail=TURNSTILE_FAILURE_MESSAGE)
