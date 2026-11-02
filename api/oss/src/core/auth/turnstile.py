import ipaddress

import httpx

from supertokens_python.framework.request import BaseRequest

from oss.src.utils.exceptions import UnauthorizedException
from oss.src.utils.common import is_ee
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
TURNSTILE_TOKEN_HEADER = "x-turnstile-token"
TURNSTILE_FAILURE_MESSAGE = "Security check failed. Please try again."

log = get_module_logger(__name__)
_turnstile_disabled_reason_logged = False


def is_turnstile_enabled() -> bool:
    return is_ee() and env.cloudflare.turnstile.enabled


def _normalize_ip(value: str) -> str | None:
    """Return the canonical spelling of an IP address, or None when it is not one."""
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return None


def get_client_ip(request: BaseRequest) -> str | None:
    """Return the client IP as the trusted proxies in front of the API saw it.

    `CF-Connecting-IP` counts only when `AGENTA_ACCESS_TRUST_CLOUDFLARE_IP` is on. With
    `AGENTA_ACCESS_TRUSTED_PROXY_HOPS` set to N, the IP is the Nth X-Forwarded-For entry
    from the right, because the trusted proxies append there and a client can only add
    entries on the left. A header shorter than N falls back to its first entry, which is
    the client when it sent no X-Forwarded-For of its own, so a hop count set too high
    does not put every client behind one proxy address. Unset, the first entry is used.
    A value that is not an IP address gives None.
    """
    access = env.agenta.access

    if access.trust_cloudflare_ip:
        cf_ip = (request.get_header("cf-connecting-ip") or "").strip()
        if cf_ip:
            return _normalize_ip(cf_ip)

    forwarded = [
        entry.strip()
        for entry in (request.get_header("x-forwarded-for") or "").split(",")
        if entry.strip()
    ]
    if forwarded:
        hops = access.trusted_proxy_hops
        if hops and len(forwarded) >= hops:
            return _normalize_ip(forwarded[-hops])
        return _normalize_ip(forwarded[0])

    real_ip = (request.get_header("x-real-ip") or "").strip()
    return _normalize_ip(real_ip) if real_ip else None


def has_turnstile_token(request: BaseRequest) -> bool:
    return bool((request.get_header(TURNSTILE_TOKEN_HEADER) or "").strip())


def _normalize_hostname(hostname: str | None) -> str:
    return (hostname or "").strip().lower()


def _get_turnstile_disabled_reason() -> str | None:
    if not is_ee():
        return "not_ee"

    if not env.cloudflare.turnstile.enabled:
        return "missing_keys"

    return None


async def verify_turnstile_or_raise(
    *,
    request: BaseRequest,
    auth_flow: str | None = None,
) -> None:
    global _turnstile_disabled_reason_logged

    disabled_reason = _get_turnstile_disabled_reason()
    if disabled_reason:
        if not _turnstile_disabled_reason_logged:
            log.info(
                "[AUTH] Turnstile verification skipped reason=%s",
                disabled_reason,
            )
            _turnstile_disabled_reason_logged = True
        return

    token = (request.get_header(TURNSTILE_TOKEN_HEADER) or "").strip()
    if not token:
        log.warning(
            "[AUTH] Turnstile token missing auth_flow=%s client_ip=%s",
            auth_flow,
            get_client_ip(request),
        )
        raise UnauthorizedException(message="Please complete the security check.")

    payload = {
        "secret": env.cloudflare.turnstile.secret_key or "",
        "response": token,
    }

    remote_ip = get_client_ip(request)
    if remote_ip:
        payload["remoteip"] = remote_ip

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(TURNSTILE_VERIFY_URL, data=payload)
            response.raise_for_status()
        verification_result = response.json()
    except (httpx.HTTPError, ValueError):
        log.error(
            "[AUTH] Turnstile verification failed auth_flow=%s client_ip=%s",
            auth_flow,
            remote_ip,
            exc_info=True,
        )
        raise UnauthorizedException(message=TURNSTILE_FAILURE_MESSAGE) from None

    if verification_result.get("success") is True:
        actual_hostname = _normalize_hostname(verification_result.get("hostname"))
        expected_hostnames = env.cloudflare.turnstile.allowed_hostnames

        if expected_hostnames and actual_hostname not in expected_hostnames:
            log.warning(
                "[AUTH] Turnstile verification rejected auth_flow=%s hostname=%s expected_hostnames=%s client_ip=%s",
                auth_flow,
                actual_hostname or None,
                sorted(expected_hostnames),
                remote_ip,
            )
            raise UnauthorizedException(message=TURNSTILE_FAILURE_MESSAGE)

        log.info(
            "[AUTH] Turnstile verification succeeded auth_flow=%s hostname=%s action=%s client_ip=%s",
            auth_flow,
            actual_hostname or None,
            verification_result.get("action"),
            remote_ip,
        )
        return

    log.warning(
        "[AUTH] Turnstile verification failed auth_flow=%s error_codes=%s hostname=%s action=%s client_ip=%s",
        auth_flow,
        verification_result.get("error-codes"),
        verification_result.get("hostname"),
        verification_result.get("action"),
        remote_ip,
    )
    raise UnauthorizedException(message=TURNSTILE_FAILURE_MESSAGE)
