from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

import httpx

from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


class AgentaAIServicesClient:
    """Thin HTTP client to call Agenta Cloud workflow invocation APIs."""

    def __init__(
        self,
        *,
        api_url: str,
        api_key: str,
        timeout_s: float = 20.0,
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
    ) -> Tuple[Optional[Any], Optional[str]]:
        """Invoke a deployed prompt by app/environment slug.

        NOTE: This targets the cloud completion runner endpoint.

        Returns: (raw_response, trace_id)
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

            # Non-2xx responses still carry useful error payloads
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
                # Surface as tool execution error (caller maps to isError)
                return {
                    "_error": True,
                    "status_code": res.status_code,
                    "detail": data,
                }, None

            trace_id = None
            if isinstance(data, dict):
                trace_id = data.get("trace_id") or data.get("traceId")

                return data, trace_id

            return None, None

        except httpx.TimeoutException:
            log.warning("[ai-services] Upstream invoke timed out", url=url)
            return {
                "_error": True,
                "status_code": 504,
                "detail": "Upstream timeout",
            }, None

        except Exception as e:  # pylint: disable=broad-exception-caught
            log.warning("[ai-services] Upstream invoke error", url=url, error=str(e))
            return {
                "_error": True,
                "status_code": 502,
                "detail": "Upstream error",
            }, None
