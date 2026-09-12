"""The gateways-side implementation of the vault's LLM endpoint registrar port.

The vault calls this after every write to a `custom_provider` secret so the gateway holds a
routable endpoint under the same slug the SDK sends as `connection_slug`. It works over
`LLMEndpointsDAOInterface` alone, which depends on nothing in secrets.
"""

from typing import List, Optional
from uuid import UUID

from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMEndpointCreate,
    LLMEndpointData,
    LLMEndpointEdit,
    LLMEndpointRoute,
    LLMModelFilter,
)
from oss.src.core.gateways.llms.interfaces import LLMEndpointsDAOInterface
from oss.src.core.secrets.dtos import SecretDataDTO, SecretResponseDTO
from oss.src.core.secrets.enums import (
    LLMCustomProviderKind,
    LLMEndpointProtocol,
    SecretKind,
)
from oss.src.core.secrets.interfaces import LLMEndpointRegistrarInterface
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


# The four cloud deployments carry their own routing, auth and static-field rules, so they
# keep their own deployment kind. Every other custom-provider kind is an endpoint at a base
# URL the user supplies, which is what LLMDeploymentKind.CUSTOM means; the provider family
# it speaks rides on `provider_key`, not here. DIRECT and MOCK are never a custom
# provider's deployment: DIRECT addresses a provider's own published URL, MOCK is in-process.
CUSTOM_PROVIDER_DEPLOYMENT_KINDS = {
    LLMCustomProviderKind.AZURE: LLMDeploymentKind.AZURE,
    LLMCustomProviderKind.BEDROCK: LLMDeploymentKind.BEDROCK,
    LLMCustomProviderKind.SAGEMAKER: LLMDeploymentKind.SAGEMAKER,
    LLMCustomProviderKind.VERTEX: LLMDeploymentKind.VERTEX,
}


def custom_provider_deployment_kind(
    kind: LLMCustomProviderKind,
) -> LLMDeploymentKind:
    """The deployment an endpoint of this custom-provider kind is reached through."""
    return CUSTOM_PROVIDER_DEPLOYMENT_KINDS.get(kind, LLMDeploymentKind.CUSTOM)


def custom_provider_model_allowlist(data: SecretDataDTO) -> List[str]:
    """Every spelling of the models the operator listed, and nothing else.

    One model is addressed by two names, and both must pass: the qualified
    `<provider_slug>/<kind>/<model slug>` key the secret carries, which is how Agenta
    addresses the model internally, and the bare model slug, which is the name the
    upstream itself knows and what a direct caller of
    `/gateways/llms/custom/<slug>/v1/chat/completions` sends. `GatewayEndpointFilter.allows`
    is exact membership, so a spelling missing here is a refusal.

    An empty list stays empty on purpose: `allowlist=[]` allows no model, while
    `allowlist=None` would allow every model, so an operator who listed none must not end
    up with an unrestricted endpoint.
    """
    qualified_keys = list(getattr(data, "model_keys", None) or [])
    bare_slugs = [model.slug for model in (getattr(data, "models", None) or [])]

    allowlist: List[str] = []
    for name in qualified_keys + bare_slugs:
        if name not in allowlist:
            allowlist.append(name)

    return allowlist


def map_custom_provider_secret_to_endpoint(
    secret: SecretResponseDTO,
) -> Optional[LLMEndpointCreate]:
    """The endpoint row a custom-provider secret stands for.

    Pure: no I/O, no DAO. None when the secret is not a slugged custom provider, which is
    the caller's signal to register nothing.
    """
    if secret.kind != SecretKind.CUSTOM_PROVIDER or not secret.slug:
        return None

    data = secret.data
    provider = getattr(data, "provider", None)
    protocol = getattr(data, "protocol", None) or LLMEndpointProtocol.OPENAI
    header = secret.header

    return LLMEndpointCreate(
        slug=secret.slug,
        name=header.name if header else None,
        description=header.description if header else None,
        #
        provider_key=LLMEndpointProtocol(protocol).value,
        deployment_kind=custom_provider_deployment_kind(
            LLMCustomProviderKind(data.kind)
        ),
        secret_id=secret.id,
        #
        data=LLMEndpointData(
            route=LLMEndpointRoute(
                base_url=getattr(provider, "url", None),
                api_version=getattr(provider, "version", None),
            ),
            models=LLMModelFilter(
                allowlist=custom_provider_model_allowlist(data),
            ),
        ),
    )


def endpoint_edit_from_create(
    *,
    endpoint_id: UUID,
    endpoint: LLMEndpointCreate,
) -> LLMEndpointEdit:
    """Project a mapped endpoint onto the editable surface of an existing row."""
    return LLMEndpointEdit(
        id=endpoint_id,
        name=endpoint.name,
        description=endpoint.description,
        #
        provider_key=endpoint.provider_key,
        secret_id=endpoint.secret_id,
        #
        data=endpoint.data,
        flags=endpoint.flags,
    )


class LLMEndpointRegistrar(LLMEndpointRegistrarInterface):
    def __init__(
        self,
        *,
        llm_endpoints_dao: LLMEndpointsDAOInterface,
    ) -> None:
        self.llm_endpoints_dao = llm_endpoints_dao

    async def register(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID] = None,
        #
        secret: SecretResponseDTO,
    ) -> None:
        endpoint = map_custom_provider_secret_to_endpoint(secret)

        if endpoint is None:
            return

        try:
            stored = await self.llm_endpoints_dao.fetch_endpoint_by_slug(
                project_id=project_id,
                slug=endpoint.slug,
            )

            if stored is None or stored.id is None:
                await self.llm_endpoints_dao.create_endpoint(
                    project_id=project_id,
                    user_id=user_id,
                    endpoint=endpoint,
                )
            else:
                await self.llm_endpoints_dao.edit_endpoint(
                    project_id=project_id,
                    user_id=user_id,
                    endpoint=endpoint_edit_from_create(
                        endpoint_id=stored.id,
                        endpoint=endpoint,
                    ),
                )
        except Exception as exception:  # noqa: BLE001 - the vault write must still stand.
            log.warning(
                "Could not register the LLM endpoint for a custom provider secret.",
                slug=endpoint.slug,
                exception=repr(exception),
            )

    async def deregister(
        self,
        *,
        project_id: UUID,
        #
        secret: SecretResponseDTO,
    ) -> None:
        if secret.kind != SecretKind.CUSTOM_PROVIDER or not secret.slug:
            return

        try:
            stored = await self.llm_endpoints_dao.fetch_endpoint_by_slug(
                project_id=project_id,
                slug=secret.slug,
            )

            if stored is None or stored.id is None:
                return

            await self.llm_endpoints_dao.delete_endpoint(
                project_id=project_id,
                endpoint_id=stored.id,
            )
        except Exception as exception:  # noqa: BLE001 - the vault write must still stand.
            log.warning(
                "Could not deregister the LLM endpoint for a custom provider secret.",
                slug=secret.slug,
                exception=repr(exception),
            )
