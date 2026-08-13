import asyncio
from datetime import datetime, timezone
from typing import Optional

import httpx

from oss.src.core.providers.adapters import get_adapter, supported_kinds
from oss.src.core.providers.dtos import (
    CredentialResult,
    CredentialStatus,
    DiscoveryResult,
    DiscoveryStatus,
    ProviderCredentials,
    ProviderProbeResult,
)
from oss.src.core.providers.exceptions import UnsupportedProviderKind
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)

PROBE_TIMEOUT_SECONDS = 10.0


class ProviderProbeService:
    """Tests a provider credential and refreshes its model list, without storing either.

    Credentials arrive in the request, are spent on one outbound read, and are dropped.
    Nothing here writes them to the vault or to a log line.
    """

    def __init__(
        self,
        *,
        timeout: float = PROBE_TIMEOUT_SECONDS,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ):
        self.timeout = timeout
        self.transport = transport

    async def probe(
        self,
        *,
        kind: str,
        credentials: ProviderCredentials,
    ) -> ProviderProbeResult:
        adapter = get_adapter(kind)
        if adapter is None:
            raise UnsupportedProviderKind(
                f"'{kind}' is not a provider Agenta can test. Supported: {', '.join(supported_kinds())}."
            )

        # No retries: a probe is a user-facing button, and a second attempt against a
        # rejecting provider only slows the answer down.
        async with httpx.AsyncClient(
            timeout=self.timeout,
            transport=self.transport,
            follow_redirects=False,
        ) as client:
            try:
                # httpx's timeout is per request, and an adapter may issue several (OpenRouter
                # proves the key, then lists models), so the budget is applied to the whole
                # probe as well — otherwise the button's worst case is a multiple of it.
                outcome = await asyncio.wait_for(
                    adapter.probe(client=client, credentials=credentials),
                    timeout=self.timeout,
                )
            except (asyncio.TimeoutError, TimeoutError):
                log.info("[PROVIDERS] probe timed out", kind=kind)
                # A probe that ran out of time proved nothing either way, which is what
                # `unknown` says; discovery `failed` keeps the shipped catalog.
                return ProviderProbeResult(
                    credential=CredentialResult(
                        status=CredentialStatus.UNKNOWN,
                        message=f"Could not reach {adapter.label} in time.",
                    ),
                    discovery=DiscoveryResult(status=DiscoveryStatus.FAILED),
                    fetched_at=datetime.now(timezone.utc),
                )

        log.info(
            "[PROVIDERS] probe",
            kind=kind,
            credential=outcome.credential.status.value,
            discovery=outcome.discovery.status.value,
            models=len(outcome.discovery.models),
        )

        return ProviderProbeResult(
            credential=outcome.credential,
            discovery=outcome.discovery,
            fetched_at=datetime.now(timezone.utc),
        )
