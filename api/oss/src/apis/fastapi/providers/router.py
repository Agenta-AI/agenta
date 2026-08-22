from typing import Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse

from oss.src.apis.fastapi.providers.models import (
    ProbeProviderRequest,
    ProbeProviderResponse,
)
from oss.src.apis.fastapi.vault.router import SecretSafeRoute
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.providers.exceptions import ProviderProbeError
from pydantic import SecretStr

from oss.src.core.providers.dtos import ProviderCredentials
from oss.src.core.providers.service import ProviderProbeService
from oss.src.core.secrets.services import VaultService
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


def _typed_or_stored(typed, stored):
    """What this field probes with: what the caller typed, else what is stored.

    Absent and blank mean the same thing here, which is the contract the rest of the
    vault path already uses: a form that cannot prefill a value submits an empty string,
    and reading that as "probe with no URL" would fail a connection that is fine. Only a
    real value overrides.
    """
    if typed is None:
        return stored

    value = typed.get_secret_value() if isinstance(typed, SecretStr) else typed
    if value in ("", {}, []):
        return stored

    return typed


def _stored_kind(secret) -> str:
    """The provider family a stored secret was saved for, as the probe registry spells it."""
    kind = getattr(secret.data, "kind", None)

    return str(getattr(kind, "value", kind))


class ProvidersRouter:
    """Credential test and model discovery for a provider connection.

    Shares the vault router's `SecretSafeRoute`: the probe body IS a credential, so a
    validation error on this route must not echo what the caller sent.
    """

    def __init__(
        self,
        provider_probe_service: ProviderProbeService,
        vault_service: VaultService,
    ):
        self.service = provider_probe_service
        # Read INTERNALLY, in plaintext: a stored credential is spent on the probe's own
        # outbound request and never returned. The redacted outward shape would test a
        # write-only connection with an empty key and report it broken.
        self.vault_service = vault_service

        self.router = APIRouter(route_class=SecretSafeRoute)

        self.router.add_api_route(
            "/providers/probe",
            self.probe_provider,
            methods=["POST"],
            operation_id="probe_provider",
            response_model=ProbeProviderResponse,
        )

    async def _merge_stored_secret(
        self,
        *,
        project_id: UUID,
        secret_id: UUID,
        kind: Optional[str],
        typed: ProviderCredentials,
    ) -> Tuple[str, ProviderCredentials]:
        """The stored connection, with anything typed in this request laid over it.

        Scoped to the caller's project, so an id from another project is simply not
        found. What is typed wins field by field: that is what lets a card test an edit
        it has not saved yet, a new base URL being the case this exists for.
        """
        secret = await self.vault_service.get_secret_by_id(
            secret_id=secret_id,
            project_id=project_id,
        )

        if secret is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Secret not found",
            )

        stored_kind = _stored_kind(secret)
        settings = getattr(secret.data, "provider", None)
        stored_key = getattr(settings, "key", None) if settings else None

        # A stored credential belongs to the provider it was saved for. Sending it to a
        # different provider family is never part of testing a connection, and it is how
        # one provider's key ends up in another provider's logs — so a kind change is
        # honored only when the caller also typed the credential to go with it.
        if kind is not None and kind != stored_kind and typed.key is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    "Testing this connection as a different provider requires its "
                    "credential; the stored one belongs to the saved provider."
                ),
            )

        merged = ProviderCredentials(
            key=_typed_or_stored(typed.key, stored_key),
            url=_typed_or_stored(typed.url, getattr(settings, "url", None)),
            version=_typed_or_stored(typed.version, getattr(settings, "version", None)),
            extras=_typed_or_stored(typed.extras, getattr(settings, "extras", None)),
        )

        return kind or stored_kind, merged

    @intercept_exceptions()
    async def probe_provider(self, request: Request, body: ProbeProviderRequest):
        # EDIT_SECRET, not VIEW_SECRET: a probe spends a caller-supplied credential on an
        # outbound request, so it belongs to whoever may change the connection.
        has_permission = await check_action_access(
            user_uid=str(request.state.user_id),
            project_id=str(request.state.project_id),
            permission=Permission.EDIT_SECRET,
        )

        if not has_permission:
            error_msg = "You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

        kind, credentials = body.kind, body.provider
        if body.secret_id is not None:
            kind, credentials = await self._merge_stored_secret(
                project_id=UUID(request.state.project_id),
                secret_id=body.secret_id,
                kind=kind,
                typed=credentials,
            )

        try:
            return await self.service.probe(
                kind=kind,
                credentials=credentials,
            )
        except ProviderProbeError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=e.message,
            ) from None
