"""`LlmGatewayService` (entities.md §8): management CRUD, the generated-endpoint merge, and
the relay path's policy/allowlist/ceiling/secret/adapter-selection pipeline.
"""

import asyncio
import json
from dataclasses import dataclass
from typing import AsyncIterator, Dict, List, Optional
from uuid import UUID

from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.catalog import (
    standard_llm_endpoint,
    standard_llm_endpoints,
)
from oss.src.core.gateways.llms.dtos import (
    LlmCallContext,
    LlmDeploymentKind,
    LlmEndpoint,
    LlmEndpointConfig,
    LlmEndpointCreate,
    LlmEndpointEdit,
    LlmEndpointQuery,
    LlmEndpointRoute,
    LlmResolvedRoute,
)
from oss.src.core.gateways.llms.interfaces import (
    LlmEndpointsDAOInterface,
    LlmRelayResult,
)
from oss.src.core.gateways.llms.registry import LlmUpstreamRegistry, select_upstream
from oss.src.core.gateways.llms.types import (
    LlmEndpointNotFoundError,
    LlmModelNotAllowedError,
    LlmUpstreamError,
)
from oss.src.core.gateways.policy.dtos import (
    BoundSecretRef,
    SecretMode,
    SecretRef,
    GatewayOutcome,
    GatewayPlane,
    GatewayTarget,
    PolicyDecision,
    ProviderKeyRef,
    ResolvedSecret,
)
from oss.src.core.gateways.policy.interfaces import SecretsResolverInterface
from oss.src.core.gateways.policy.service import GatewayPolicyService
from oss.src.core.gateways.policy.types import CeilingExceededError, PolicyDeniedError
from oss.src.core.gateways.types import GatewayEndpointInactiveError
from oss.src.core.shared.dtos import Windowing
from oss.src.utils.context import AuthScope


@dataclass
class _ResolvedLlmTarget:
    """The generated endpoint or the row, plus which namespace answered — service-internal,
    never crosses a layer (entities.md §8)."""

    namespace: GatewayEndpointNamespace
    name: str
    provider_key: str
    deployment: LlmDeploymentKind
    model_slugs: List[str]
    route_data: LlmEndpointRoute
    config: LlmEndpointConfig
    endpoint_id: Optional[UUID] = None
    secret_id: Optional[UUID] = None
    is_active: bool = True

    def target_path(self) -> str:
        return f"{self.namespace.value}/{self.name}"

    def as_policy_target(self, *, model: Optional[str] = None) -> GatewayTarget:
        return GatewayTarget(
            plane=GatewayPlane.LLM,
            namespace=self.namespace,
            name=self.name,
            endpoint_id=self.endpoint_id,
            model=model,
        )

    def secret_ref(self) -> Optional[SecretRef]:
        if self.namespace == GatewayEndpointNamespace.STANDARD:
            return ProviderKeyRef(provider_key=self.provider_key)
        if self.secret_id is not None:
            return BoundSecretRef(secret_id=self.secret_id)
        # A custom row with no bound secret is a NONE-scheme target (the mocks, D23) —
        # nothing to resolve.
        return None

    def route(self, context: LlmCallContext) -> LlmResolvedRoute:
        return LlmResolvedRoute(
            provider_key=self.provider_key,
            deployment=self.deployment,
            model=context.model,
            base_url=self.route_data.base_url,
            api_version=self.route_data.api_version,
            region=self.route_data.region,
            headers=self.route_data.headers,
            config=self.config,
        )


def _parse_call_context(body: bytes) -> LlmCallContext:
    """The service's own model/stream extraction — a private duplicate of WP6's
    `apis/fastapi/gateways/llms/utils.py::parse_llm_call_context`, not an import of it: core
    must not import the api layer (`api/AGENTS.md`'s layering rule), and this package owns
    `relay_chat_completion`'s full body, which needs the same two fields internally."""
    try:
        payload = json.loads(body) if body else {}
    except (json.JSONDecodeError, TypeError):
        payload = {}
    model = payload.get("model") if isinstance(payload, dict) else None
    if not model:
        raise ValueError("request body names no model")
    return LlmCallContext(model=model, stream=bool(payload.get("stream", False)))


def _requested_max_output_tokens(body: bytes) -> Optional[int]:
    try:
        payload = json.loads(body) if body else {}
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(payload, dict):
        return None
    # Chat Completions names the request field `max_tokens`, `max_completion_tokens` on
    # reasoning models; `max_output_tokens` is the config key and the Responses API's.
    for key in ("max_tokens", "max_completion_tokens", "max_output_tokens"):
        value = payload.get(key)
        if isinstance(value, int):
            return value
    return None


class LlmGatewayService:
    def __init__(
        self,
        *,
        llm_endpoints_dao: LlmEndpointsDAOInterface,
        policy: GatewayPolicyService,
        resolver: SecretsResolverInterface,
        upstream_registry: LlmUpstreamRegistry,
    ) -> None:
        self.llm_endpoints_dao = llm_endpoints_dao
        self.policy = policy
        self.resolver = resolver
        self.upstream_registry = upstream_registry

    # --- management: thin over the DAO, plus the generated merge ------------ #

    async def create_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: LlmEndpointCreate,
    ) -> Optional[LlmEndpoint]:
        return await self.llm_endpoints_dao.create_endpoint(
            project_id=project_id, user_id=user_id, endpoint=endpoint
        )

    async def fetch_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> Optional[LlmEndpoint]:
        return await self.llm_endpoints_dao.fetch_endpoint(
            project_id=project_id, endpoint_id=endpoint_id
        )

    async def edit_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: LlmEndpointEdit,
    ) -> Optional[LlmEndpoint]:
        return await self.llm_endpoints_dao.edit_endpoint(
            project_id=project_id, user_id=user_id, endpoint=endpoint
        )

    async def delete_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> bool:
        return await self.llm_endpoints_dao.delete_endpoint(
            project_id=project_id, endpoint_id=endpoint_id
        )

    async def query_endpoints(
        self,
        *,
        project_id: UUID,
        #
        endpoint: Optional[LlmEndpointQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[LlmEndpoint]:
        return await self.llm_endpoints_dao.query_endpoints(
            project_id=project_id, endpoint=endpoint, windowing=windowing
        )

    async def list_endpoints(self, *, scope: AuthScope) -> List[LlmEndpoint]:
        """The merge (D20): generated standard endpoints, existing iff a provider_key secret
        exists for the provider, plus every custom row. The only read that spans namespaces.

        Takes the scope rather than a bare project_id (R14): existence is a per-owner fact
        the moment user-owned secrets ship, and fabricating an AuthScope to satisfy the port
        put a nil UUID where a user identity goes."""
        project_id = scope.project_id
        provider_keys = await self.resolver.available_provider_keys(scope=scope)

        generated = [
            endpoint
            for endpoint in standard_llm_endpoints()
            if endpoint.provider_key in provider_keys
        ]
        custom = await self.llm_endpoints_dao.query_endpoints(project_id=project_id)
        return generated + custom

    # --- the data plane (WP6, WP7) ------------------------------------------ #

    async def list_models(
        self,
        *,
        scope: AuthScope,
        namespace: GatewayEndpointNamespace,
        name: str,
    ) -> List[str]:
        """Backs `GET /v1/models` (R3): the allowlist itself, per endpoint. No secret
        resolved, no upstream called."""
        target = await self._resolve_target(
            project_id=scope.project_id, namespace=namespace, name=name
        )
        self._check_active(target=target)

        decision = await self.policy.authorize(
            scope=scope,
            permission=Permission.USE_LLM_ENDPOINTS,
            target=target.as_policy_target(),
        )
        if not decision.allowed:
            await self.policy.record(
                scope=scope,
                target=target.as_policy_target(),
                decision=decision,
                outcome=GatewayOutcome(status_code=403),
            )
            raise PolicyDeniedError(
                permission=Permission.USE_LLM_ENDPOINTS, target=target.target_path()
            )

        return list(target.model_slugs)

    async def relay_chat_completion(
        self,
        *,
        scope: AuthScope,
        namespace: GatewayEndpointNamespace,
        name: str,
        #
        body: bytes,
        headers: Dict[str, str],
    ) -> LlmRelayResult:
        target = await self._resolve_target(
            project_id=scope.project_id, namespace=namespace, name=name
        )
        self._check_active(target=target)
        context = _parse_call_context(body)

        # Allowlist and ceiling before secret (§8): a refused model must not cost a
        # vault read, and the refusal reason must be the allowlist, never a coincidental
        # secret gap.
        self._check_allowlist(target=target, context=context)
        self._check_ceilings(target=target, body=body)

        policy_target = target.as_policy_target(model=context.model)
        decision = await self.policy.authorize(
            scope=scope,
            permission=Permission.USE_LLM_ENDPOINTS,
            target=policy_target,
        )
        if not decision.allowed:
            # Denial recorded before the exception leaves — an audit trail that only
            # records successes answers "did every call get checked" wrongly.
            await self.policy.record(
                scope=scope,
                target=policy_target,
                decision=decision,
                outcome=GatewayOutcome(status_code=403),
            )
            raise PolicyDeniedError(
                permission=Permission.USE_LLM_ENDPOINTS, target=target.target_path()
            )

        ref = target.secret_ref()
        secret = (
            await self.resolver.resolve(
                scope=scope, ref=ref, mode=SecretMode.PROJECT_ONLY
            )
            if ref is not None
            else None
        )

        adapter = self.upstream_registry.get(
            select_upstream(target.provider_key, target.deployment)
        )
        # Enforced here, not per adapter: `timeout_seconds` is a property of the
        # endpoint, and an adapter that forgets it would otherwise have no ceiling at
        # all. Streaming bounds time-to-first-byte — the proxy drains the body after
        # this returns, and a long legitimate stream is not a timeout.
        try:
            result = await asyncio.wait_for(
                adapter.relay_chat_completion(
                    route=target.route(context),
                    secret=secret,
                    #
                    context=context,
                    body=body,
                    headers=headers,
                ),
                timeout=target.config.timeout_seconds,
            )
        except asyncio.TimeoutError as e:
            raise LlmUpstreamError(
                provider_key=target.provider_key,
                status_code=None,
                detail="upstream timed out",
            ) from e

        # Both paths record after the drain, never before: every adapter fills
        # `result.usage` while its body generator runs, and the proxy is what advances
        # it — reading usage here would record None on every call (§8).
        result.body = self._drain_and_record(
            body=result.body,
            scope=scope,
            target=policy_target,
            decision=decision,
            result=result,
            secret=secret,
        )
        return result

    # --- internals ------------------------------------------------------------ #

    async def _resolve_target(
        self, *, project_id: UUID, namespace: GatewayEndpointNamespace, name: str
    ) -> _ResolvedLlmTarget:
        if namespace == GatewayEndpointNamespace.STANDARD:
            endpoint = standard_llm_endpoint(provider_key=name)
            if endpoint is None:
                raise LlmEndpointNotFoundError(namespace=namespace, name=name)
            return _ResolvedLlmTarget(
                namespace=GatewayEndpointNamespace.STANDARD,
                name=name,
                provider_key=endpoint.provider_key,
                deployment=endpoint.deployment,
                model_slugs=endpoint.data.model_slugs,
                route_data=endpoint.data.route,
                config=endpoint.data.config,
            )

        if namespace == GatewayEndpointNamespace.CUSTOM:
            row = await self.llm_endpoints_dao.fetch_endpoint_by_slug(
                project_id=project_id, slug=name
            )
            if row is None:
                raise LlmEndpointNotFoundError(namespace=namespace, name=name)
            return _ResolvedLlmTarget(
                namespace=GatewayEndpointNamespace.CUSTOM,
                name=row.slug or name,
                provider_key=row.provider_key,
                deployment=row.deployment,
                model_slugs=row.data.model_slugs,
                route_data=row.data.route,
                config=row.data.config,
                endpoint_id=row.id,
                secret_id=row.secret_id,
                is_active=row.flags.is_active,
            )

        # BUILTIN: reserved, empty on the LLM plane until we supply the key (D30).
        raise LlmEndpointNotFoundError(namespace=namespace, name=name)

    @staticmethod
    def _check_active(*, target: _ResolvedLlmTarget) -> None:
        if not target.is_active:
            raise GatewayEndpointInactiveError(target=target.target_path())

    def _check_allowlist(
        self, *, target: _ResolvedLlmTarget, context: LlmCallContext
    ) -> None:
        if context.model not in target.model_slugs:
            raise LlmModelNotAllowedError(
                model=context.model, namespace=target.namespace, name=target.name
            )

    def _check_ceilings(self, *, target: _ResolvedLlmTarget, body: bytes) -> None:
        ceiling = target.config.max_output_tokens
        if ceiling is None:
            return
        requested = _requested_max_output_tokens(body)
        if requested is None or requested <= ceiling:
            return
        raise CeilingExceededError(
            ceiling="max_output_tokens",
            requested=requested,
            allowed=ceiling,
            target=target.target_path(),
        )

    def _outcome_from(
        self, *, result: LlmRelayResult, secret: Optional[ResolvedSecret]
    ) -> GatewayOutcome:
        return GatewayOutcome(
            status_code=result.status_code,
            usage=result.usage,
            owner=secret.owner if secret is not None else None,
            origin=secret.origin if secret is not None else None,
        )

    async def _drain_and_record(
        self,
        *,
        body: AsyncIterator[bytes],
        scope: AuthScope,
        target: GatewayTarget,
        decision: PolicyDecision,
        result: LlmRelayResult,
        secret: Optional[ResolvedSecret],
    ) -> AsyncIterator[bytes]:
        try:
            async for chunk in body:
                yield chunk
        finally:
            # Fires on natural exhaustion and on a mid-stream break alike — usage is
            # whatever the adapter had populated by then, None if the crash pre-dated it.
            await self.policy.record(
                scope=scope,
                target=target,
                decision=decision,
                outcome=self._outcome_from(result=result, secret=secret),
            )
