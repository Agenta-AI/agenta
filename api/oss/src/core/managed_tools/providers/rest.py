"""A direct REST API on an Agenta-owned key."""

import json
from typing import Any, Dict, Optional

import httpx

from oss.src.core.gateways.dtos import no_cookie_jar
from oss.src.core.gateways.mcps.echo import credential_echo_scanner
from oss.src.core.managed_tools.dtos import (
    ManagedActionContext,
    ManagedActionRateLimit,
    ManagedActionResponse,
    ManagedActionUpstreamFailure,
)
from oss.src.core.managed_tools.interfaces import ManagedActionProviderInterface
from oss.src.core.managed_tools.types import ManagedActionNotSentError

# Answers that say our own credential is refused, not that the call was bad.
_AUTH_FAILED = {401, 403}
_DETAIL_LIMIT = 300


class RestActionProvider(ManagedActionProviderInterface):
    """`POST {base_url}/{operation}` with the arguments as JSON and the key in a header.

    `transport` exists for the in-process mock; production leaves it unset and gets an
    `httpx` transport with `retries=0`, because a retried paid call is a second purchase."""

    def __init__(
        self,
        *,
        name: str,
        base_url: str,
        credential_header: str,
        credential: str,
        rate_limit: Optional[ManagedActionRateLimit] = None,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ) -> None:
        self.name = name
        self.rate_limit = rate_limit
        self._credential_header = credential_header
        self._credential = credential
        self._echo = credential_echo_scanner({credential_header: credential})
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/") + "/",
            transport=transport or httpx.AsyncHTTPTransport(retries=0),
            follow_redirects=False,
            # One client serves every organization, so no upstream state may ride along.
            cookies=no_cookie_jar(),
        )

    async def invoke(
        self,
        *,
        operation: str,
        arguments: Dict[str, Any],
        context: ManagedActionContext,
    ) -> ManagedActionResponse:
        headers = {self._credential_header: self._credential}
        if context.execution_id:
            headers["idempotency-key"] = context.execution_id
        try:
            response = await self._client.post(
                operation.lstrip("/"), json=arguments, headers=headers
            )
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise ManagedActionNotSentError(f"could not connect: {exc}") from exc

        reference = response.headers.get("x-request-id")
        answer = self._answer(response)
        # An upstream that answers with our key would hand it to the model. Checked on the
        # raw bytes and on what they decode to, since JSON escapes hide it from the first.
        decoded = json.dumps(answer.model_dump(mode="json")).encode()
        if (
            self._echo.detects_headers(response.headers)
            or self._echo.contains(response.content)
            or self._echo.contains(decoded)
        ):
            return ManagedActionResponse(
                failure=ManagedActionUpstreamFailure(
                    kind="rejected", message="the answer was withheld"
                )
            )
        return answer.model_copy(update={"provider_reference": reference})

    @staticmethod
    def _answer(response: httpx.Response) -> ManagedActionResponse:
        if not response.is_success:
            return ManagedActionResponse(failure=_failure(response))
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if not isinstance(payload, dict):
            return ManagedActionResponse(
                failure=ManagedActionUpstreamFailure(
                    kind="rejected", message="the answer is not a JSON object"
                )
            )
        return ManagedActionResponse(output=payload)


def _failure(response: httpx.Response) -> ManagedActionUpstreamFailure:
    detail = response.text[:_DETAIL_LIMIT] or response.reason_phrase
    if response.status_code == 429:
        return ManagedActionUpstreamFailure(
            kind="rate_limited",
            message=detail,
            retry_after_ms=_retry_after_ms(response.headers.get("retry-after")),
        )
    if response.status_code in _AUTH_FAILED:
        return ManagedActionUpstreamFailure(kind="auth_failed", message=detail)
    return ManagedActionUpstreamFailure(
        kind="rejected", message=f"{response.status_code}: {detail}"
    )


def _retry_after_ms(value: Optional[str]) -> Optional[int]:
    try:
        return max(0, int(float(value) * 1000)) if value else None
    except ValueError:
        return None
