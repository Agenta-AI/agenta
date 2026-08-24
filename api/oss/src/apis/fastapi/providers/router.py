from typing import Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import SecretStr

from oss.src.apis.fastapi.providers.models import (
    ProbeProviderRequest,
    ProbeProviderResponse,
)
from oss.src.apis.fastapi.vault.router import SecretSafeRoute
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.providers.dtos import ProviderCredentials
from oss.src.core.providers.exceptions import ProviderProbeError
from oss.src.core.providers.service import ProviderProbeService
from oss.src.core.secrets.redaction import PRIMARY_CREDENTIAL_FIELDS
from oss.src.core.secrets.services import VaultService
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


def _typed_or_stored(typed, stored):
    if typed is None:
        return stored

    value = typed.get_secret_value() if isinstance(typed, SecretStr) else typed
    if value in ("", {}, []):
        return stored

    return typed


def _stored_credential(secret, settings, extras):
    container_name, field = PRIMARY_CREDENTIAL_FIELDS.get(
        str(getattr(secret.kind, "value", secret.kind)), (None, None)
    )

    if container_name is not None:
        container = getattr(secret.data, container_name, None)
        primary = getattr(container, field, None) if container is not None else None
        if primary:
            return primary

    return (extras or {}).get("api_key") or None


def _merged_extras(typed, stored):
    if not typed:
        return stored

    merged = dict(stored or {})
    for name, value in typed.items():
        if value in (None, ""):
            continue
        merged[name] = value

    return merged or None


def _stored_kind(secret) -> str:
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
        secret = await self.vault_service.get_secret_by_id(
            secret_id=secret_id,
            project_id=project_id,
        )

        if secret is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Secret not found",
            )

        if secret.management is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Managed secrets cannot be probed.",
            )

        stored_kind = _stored_kind(secret)
        settings = getattr(secret.data, "provider", None)
        stored_extras = getattr(settings, "extras", None) if settings else None
        stored_key = _stored_credential(secret, settings, stored_extras)

        typed_key = _typed_or_stored(typed.key, None)
        if kind is not None and kind != stored_kind and typed_key is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    "Testing this connection as a different provider requires its "
                    "credential; the stored one belongs to the saved provider."
                ),
            )

        merged = ProviderCredentials(
            key=_typed_or_stored(typed_key, stored_key),
            url=_typed_or_stored(typed.url, getattr(settings, "url", None)),
            version=_typed_or_stored(typed.version, getattr(settings, "version", None)),
            extras=_merged_extras(typed.extras, stored_extras),
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
