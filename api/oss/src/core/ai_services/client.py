from __future__ import annotations

from typing import Any, Dict

import httpx

from oss.src.utils.logging import get_module_logger

from oss.src.core.ai_services.dtos import (
    AIServicesConnectionError,
    AIServicesTimeoutError,
    AIServicesUpstreamError,
    InvokeResponse,
)


log = get_module_logger(__name__)


class AgentaAIServicesClient:
    """Thin HTTP client to call Agenta Cloud workflow invocation APIs."""

    def __init__(
        self,
        *,
        api_url: str,
        api_key: str,
        timeout_s: float = 60.0,
    ):
        self.api_url = api_url.rstrip("/")
        self.api_key = api_key
        self.timeout_s = timeout_s

    async def invoke_deployed_prompt(
        self,
        *,
        application_slug: str,
        environment_slug: str,
        inputs: Dict[str, Any],
    ) -> InvokeResponse:
        """Invoke a deployed prompt by app/environment slug.

        NOTE: This targets the cloud completion runner endpoint.

        Returns an InvokeResponse DTO.

        Raises:
            AIServicesUpstreamError: on non-2xx HTTP response
            AIServicesTimeoutError: on request timeout
            AIServicesConnectionError: on transport / network error
        """

        url = f"{self.api_url}/services/completion/run"

        payload: Dict[str, Any] = {
            "inputs": inputs,
            "environment": environment_slug,
            "app": application_slug,
        }

        headers = {
            "Authorization": f"ApiKey {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout_s) as client:
                res = await client.post(url, json=payload, headers=headers)

            # Try to parse JSON regardless of status
            data: Any = None
            try:
                data = res.json()
            except Exception:
                data = None

            if res.status_code < 200 or res.status_code >= 300:
                log.warning(
                    "[ai-services] Upstream invoke failed",
                    status_code=res.status_code,
                    url=url,
                )
                raise AIServicesUpstreamError(
                    message=f"Upstream returned HTTP {res.status_code}.",
                    status_code=res.status_code,
                    detail=data,
                )

            trace_id = None
            if isinstance(data, dict):
                trace_id = data.get("trace_id") or data.get("traceId")

            return InvokeResponse(data=data, trace_id=trace_id)

        except AIServicesUpstreamError:
            raise

        except httpx.TimeoutException as e:
            log.warning("[ai-services] Upstream invoke timed out", url=url)
            raise AIServicesTimeoutError() from e

        except Exception as e:
            log.warning("[ai-services] Upstream invoke error", url=url, error=str(e))
            raise AIServicesConnectionError() from e
