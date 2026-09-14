"""The gateways-side implementation of the vault's LLM endpoint registrar port.

The vault calls this after every write to a `custom_provider` secret so the gateway holds a
routable endpoint under the same slug the SDK sends as `connection_slug`. It works over
`LLMEndpointsDAOInterface` alone, which depends on nothing in secrets.
"""

from typing import Any, Dict, List, Optional
from uuid import UUID

from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMEndpoint,
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


# The vault's own names for the cloud deployments' routing configuration, which live in the
# secret's `provider.extras` beside its credentials. Both are classified as configuration,
# not credential material (`agenta.sdk.agents.connections.credentials.CONFIG_EXTRAS_KEYS`),
# which is what makes them safe to copy onto a route anyone who can read the endpoint reads.
# Nothing else from `extras` is copied: the rest of that dict is the credential.
SECRET_REGION_EXTRAS_KEYS = ("aws_region_name", "vertex_ai_location")
SECRET_VERTEX_PROJECT_EXTRAS_KEY = "vertex_ai_project"

# The route's own name for the Vertex project. The two sides spell it differently, so the
# translation happens here rather than at the two read sites:
# `providers/passthrough/routing.py::_vertex_base_prefix` and
# `providers/passthrough/auth.py::_vertex_auth` both read `route.extras["vertex_project"]`.
ROUTE_VERTEX_PROJECT_KEY = "vertex_project"


def _provider_extras(data: SecretDataDTO) -> Dict[str, Any]:
    provider = getattr(data, "provider", None)
    return getattr(provider, "extras", None) or {}


def custom_provider_route_region(data: SecretDataDTO) -> Optional[str]:
    """The cloud region the endpoint is reached in, under whichever name the secret uses.

    Bedrock and SageMaker store an AWS region; Vertex stores a GCP location, which is the
    same field on the route. Bedrock accepts either a base URL or a region
    (`routing.py::_bedrock_url`), so a region-only configuration is a complete one and
    dropping the region here is what made it unroutable.
    """
    extras = _provider_extras(data)

    for key in SECRET_REGION_EXTRAS_KEYS:
        region = str(extras.get(key) or "").strip()
        if region:
            return region

    return None


def custom_provider_route_extras(data: SecretDataDTO) -> Optional[Dict[str, Any]]:
    """The non-secret route fields that have no column of their own.

    Only the Vertex project, and only under the name the route reads it by. An empty result
    is None rather than `{}` so an endpoint with nothing to carry stores nothing.
    """
    project = str(
        _provider_extras(data).get(SECRET_VERTEX_PROJECT_EXTRAS_KEY) or ""
    ).strip()

    return {ROUTE_VERTEX_PROJECT_KEY: project} if project else None


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
                region=custom_provider_route_region(data),
                extras=custom_provider_route_extras(data),
            ),
            models=LLMModelFilter(
                allowlist=custom_provider_model_allowlist(data),
            ),
        ),
    )


def _route_extras(
    stored: Optional[Dict[str, Any]],
    mapped: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """The stored extras with the registrar's own key re-derived from the secret.

    The registrar owns `vertex_project` and nothing else in this dict, so a key it does not
    write survives, and a project the operator removed from the connection is removed here
    rather than left behind as a stale route.
    """
    merged = dict(stored or {})
    merged.pop(ROUTE_VERTEX_PROJECT_KEY, None)
    merged.update(mapped or {})

    return merged or None


def endpoint_edit_from_create(
    *,
    endpoint_id: UUID,
    endpoint: LLMEndpointCreate,
    stored: LLMEndpoint,
) -> LLMEndpointEdit:
    """The editable surface of `stored`, with the fields a secret owns taken from `endpoint`.

    Two owners share this row, and the edit is a full PUT
    (`dbs/postgres/gateways/llms/mappings.py::map_llm_endpoint_edit_to_dbe`), so every field
    the registrar does not restate is erased. Both halves are therefore named here.

    The secret owns identity and address: who the endpoint is (`name`, `description`, the
    vault record it is backed by, the provider family its protocol declares) and how the
    upstream is reached (`base_url`, `api_version`, `region`, and the route `extras` derived
    from the connection). It also owns the model allowlist, which is the list of models the
    operator put on the connection.

    Everything else is gateway policy, configured against the endpoint and not against the
    secret, so it survives a key rotation: `flags` (whether the endpoint is active), the
    model `denylist`, the endpoint `settings` (the output-token ceiling and the timeout),
    the route `headers` the endpoint sends upstream, and the row's `tags` and `meta`.

    `stored` is required rather than optional because a caller without the current row
    cannot tell those two halves apart, and defaulting it would silently restore the
    reset this function exists to prevent.
    """
    mapped_route = endpoint.data.route
    route = stored.data.route.model_copy(
        update={
            "base_url": mapped_route.base_url,
            "api_version": mapped_route.api_version,
            "region": mapped_route.region,
            "extras": _route_extras(stored.data.route.extras, mapped_route.extras),
        }
    )
    models = stored.data.models.model_copy(
        update={"allowlist": endpoint.data.models.allowlist}
    )

    return LLMEndpointEdit(
        id=endpoint_id,
        name=endpoint.name,
        description=endpoint.description,
        #
        provider_key=endpoint.provider_key,
        secret_id=endpoint.secret_id,
        #
        data=LLMEndpointData(
            route=route,
            models=models,
            settings=stored.data.settings,
        ),
        flags=stored.flags,
        tags=stored.tags,
        meta=stored.meta,
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
                        stored=stored,
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
