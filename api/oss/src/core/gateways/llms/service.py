"""Manage LLM endpoints and relay requests through policy and provider adapters."""

import asyncio
import json
from dataclasses import dataclass
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple
from uuid import UUID

from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.cleanup import run_shielded
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.catalog import (
    BUILTIN_LLM_PROVIDERS,
    builtin_llm_endpoint,
    standard_llm_endpoint,
    standard_llm_endpoints,
)
from oss.src.core.gateways.llms.dtos import (
    LLMCallContext,
    LLMDeploymentKind,
    LLMEndpoint,
    LLMEndpointSettings,
    LLMModelFilter,
    LLMEndpointCreate,
    LLMEndpointEdit,
    LLMEndpointQuery,
    LLMEndpointRoute,
    LLMGatewayConnectionResolution,
    LLMProtocol,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.interfaces import (
    LLMEndpointsDAOInterface,
    LLMRelayResult,
)
from oss.src.core.gateways.llms.registry import LLMUpstreamRegistry, select_upstream
from oss.src.core.gateways.llms.types import (
    LLMConnectionProviderRequiredError,
    LLMEndpointNotFoundError,
    LLMEndpointProviderMissingError,
    LLMModelNotAllowedError,
    LLMRoutingFieldNotAllowedError,
    LLMUpstreamError,
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
    SecretOrigin,
)
from oss.src.core.gateways.policy.interfaces import SecretsResolverInterface
from oss.src.core.gateways.policy.service import GatewayPolicyService
from oss.src.core.gateways.policy.types import (
    CeilingExceededError,
    EntitlementDeniedError,
    PolicyDeniedError,
)
from oss.src.core.gateways.types import GatewayEndpointInactiveError
from oss.src.core.shared.dtos import Windowing
from oss.src.utils.context import AuthScope


@dataclass
class _ResolvedLlmTarget:
    """A resolved endpoint and its namespace."""

    namespace: GatewayEndpointNamespace
    name: str
    provider_key: Optional[str]
    deployment_kind: LLMDeploymentKind
    models: LLMModelFilter
    route_data: LLMEndpointRoute
    settings: LLMEndpointSettings
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
            provider=self.provider_key,
            endpoint_id=self.endpoint_id,
            model=model,
        )

    def secret_ref(self) -> Optional[SecretRef]:
        # A named secret wins over the provider scan, on every namespace. A standard
        # target carries one only when the caller named the connection by slug (OR53),
        # and the whole point of naming it is that the scan — first match for the
        # provider family — is not what the caller asked for.
        if self.secret_id is not None:
            return BoundSecretRef(secret_id=self.secret_id)
        if self.namespace == GatewayEndpointNamespace.STANDARD:
            return ProviderKeyRef(provider_key=self.provider_key)
        # Custom endpoints without a secret require no secret resolution.
        return None

    def route(self, context: LLMCallContext) -> LLMResolvedRoute:
        return LLMResolvedRoute(
            provider_key=self.provider_key,
            deployment_kind=self.deployment_kind,
            model=context.model,
            base_url=self.route_data.base_url,
            api_version=self.route_data.api_version,
            region=self.route_data.region,
            headers=self.route_data.headers,
            extras=self.route_data.extras,
            settings=self.settings,
        )


async def _replay_body(payload: bytes) -> AsyncIterator[bytes]:
    """An already-consumed body, handed back as the iterator the caller expects."""
    yield payload


def _json_object(body: bytes) -> Dict[str, Any]:
    """The request body as a JSON object, or an empty one when it is not readable as such."""
    try:
        payload = json.loads(body) if body else {}
    except (json.JSONDecodeError, TypeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _parse_call_context(body: bytes, protocol: LLMProtocol) -> LLMCallContext:
    """Extract model and streaming fields without coupling the core to the API layer."""
    payload = _json_object(body)
    model = payload.get("model")
    if not model:
        raise ValueError("request body names no model")
    return LLMCallContext(
        model=model, stream=bool(payload.get("stream", False)), protocol=protocol
    )


# OpenRouter's fallback array: model ids tried in order when the primary fails. The gateway
# understands it, so every entry is measured against the allowlist exactly as `model` is.
_FALLBACK_MODELS_FIELD = "models"

# Routing extensions whose effect on model selection the allowlist cannot evaluate. Each
# one decides which model or which upstream actually serves the call, and forwarding one
# means forwarding a routing decision nobody checked (OR44). Aliases and fallbacks are
# deliberately outside this increment (`models.md`), so refusing costs no supported feature
# — and refusing, rather than ignoring, is what stops the next such field a provider ships
# from silently reopening the allowlist.
_UNSUPPORTED_ROUTING_FIELDS: Tuple[str, ...] = (
    "route",  # OpenRouter's legacy `"route": "fallback"` auto-router
    "provider",  # OpenRouter provider preferences: order / only / ignore / allow_fallbacks
    "preset",  # OpenRouter preset: a stored model-and-provider routing configuration
    "fallbacks",  # proxy-style fallback lists (LiteLLM and the gateways modelled on it)
)


# The request field each protocol spells its output-token maximum with (specs-wp23.md §2).
# EVERY alias is checked, and the FIRST is the one the gateway writes when a request names
# none of them: `max_tokens` is the spelling every OpenAI-compatible upstream in the
# catalogue understands, so writing `max_completion_tokens` instead would leave the ceiling
# quietly unenforced on most of them.
_CEILING_FIELDS: Dict[LLMProtocol, Tuple[str, ...]] = {
    LLMProtocol.CHAT_COMPLETIONS: ("max_tokens", "max_completion_tokens"),
    LLMProtocol.RESPONSES: ("max_output_tokens",),
    LLMProtocol.MESSAGES: ("max_tokens",),
}


def _requested_max_output_tokens(value: Any) -> Optional[float]:
    """One alias's value as a token count, or None when it names no usable maximum.

    `bool` is excluded on purpose: `isinstance(True, int)` is True in Python, and `true` is
    not a token count. A numeric string is read as the number it spells, so a client sending
    `"999999"` is measured rather than waved through for being the wrong type.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number: float = value
    elif isinstance(value, str):
        try:
            number = float(value)
        except ValueError:
            return None
    else:
        return None
    return number if number > 0 else None


class LLMGatewayService:
    def __init__(
        self,
        *,
        llm_endpoints_dao: LLMEndpointsDAOInterface,
        policy: GatewayPolicyService,
        resolver: SecretsResolverInterface,
        upstream_registry: LLMUpstreamRegistry,
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
        endpoint: LLMEndpointCreate,
    ) -> Optional[LLMEndpoint]:
        return await self.llm_endpoints_dao.create_endpoint(
            project_id=project_id, user_id=user_id, endpoint=endpoint
        )

    async def fetch_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> Optional[LLMEndpoint]:
        return await self.llm_endpoints_dao.fetch_endpoint(
            project_id=project_id, endpoint_id=endpoint_id
        )

    async def edit_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: LLMEndpointEdit,
    ) -> Optional[LLMEndpoint]:
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
        endpoint: Optional[LLMEndpointQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[LLMEndpoint]:
        return await self.llm_endpoints_dao.query_endpoints(
            project_id=project_id, endpoint=endpoint, windowing=windowing
        )

    async def list_endpoints(self, *, scope: AuthScope) -> List[LLMEndpoint]:
        """List generated standard and builtin endpoints and persisted custom endpoints.

        Builtin endpoints exist only under the development mock switch, so this lists them
        only there; that is what lets an agent picker offer a platform-funded model.

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
        builtin = [
            endpoint
            for provider_key in BUILTIN_LLM_PROVIDERS
            if (endpoint := builtin_llm_endpoint(provider_key=provider_key)) is not None
        ]
        custom = await self.llm_endpoints_dao.query_endpoints(project_id=project_id)
        return generated + builtin + custom

    async def resolve_agent_connection(
        self,
        *,
        scope: AuthScope,
        model: str,
        provider_key: Optional[str],
        connection_slug: Optional[str],
    ) -> LLMGatewayConnectionResolution:
        """Resolve an agent connection to public gateway route metadata.

        Both refusals here are typed rather than bare `ValueError`s: this is the seam every
        resolve request passes through, and a bare raise reached the caller as a generic 500
        with nothing to act on. `LLMGatewayConnectionResolution.provider_key` stays a required
        field, so the invariant no construction path can dodge is still enforced underneath.
        """
        if connection_slug:
            namespace = await self._namespace_of_slug(scope=scope, slug=connection_slug)
            name = connection_slug
        elif provider_key:
            namespace = GatewayEndpointNamespace.STANDARD
            name = provider_key
        else:
            raise LLMConnectionProviderRequiredError()

        target = await self._resolve_target(scope=scope, namespace=namespace, name=name)
        self._check_active(target=target)
        resolved_provider = target.provider_key or provider_key
        if not resolved_provider:
            raise LLMEndpointProviderMissingError(
                namespace=target.namespace, name=target.name
            )
        if target.deployment_kind == LLMDeploymentKind.MOCK:
            resolved_provider = "anthropic" if model.startswith("claude-") else "openai"

        return LLMGatewayConnectionResolution(
            namespace=target.namespace,
            name=target.name,
            provider_key=resolved_provider,
            deployment_kind=target.deployment_kind,
            model=model,
        )

    # Data plane

    async def list_models(
        self,
        *,
        scope: AuthScope,
        namespace: GatewayEndpointNamespace,
        name: str,
    ) -> List[str]:
        """Backs `GET /v1/models` (R3): the allowlist itself, per endpoint. No secret
        resolved, no upstream called."""
        target = await self._resolve_target(scope=scope, namespace=namespace, name=name)
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

        return target.models.enumerate()

    async def relay_chat_completion(
        self,
        *,
        scope: AuthScope,
        namespace: GatewayEndpointNamespace,
        name: str,
        #
        body: bytes,
        headers: Dict[str, str],
        protocol: LLMProtocol = LLMProtocol.CHAT_COMPLETIONS,
        run_id: Optional[str] = None,
        run_labels: Optional[Dict[str, str]] = None,
    ) -> LLMRelayResult:
        """Relay one request for the specified protocol."""
        target = await self._resolve_target(scope=scope, namespace=namespace, name=name)
        self._check_active(target=target)
        context = _parse_call_context(body, protocol)
        payload = _json_object(body)

        # Allowlist and ceiling before secret (§8): a refused model must not cost a
        # vault read, and the refusal reason must be the allowlist, never a coincidental
        # secret gap.
        self._check_allowlist(target=target, context=context, payload=payload)
        body = self._enforce_ceilings(
            target=target, context=context, body=body, payload=payload
        )

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
                run_id=run_id,
            )
            raise PolicyDeniedError(
                permission=Permission.USE_LLM_ENDPOINTS, target=target.target_path()
            )

        # Spend admission, only where we pay: a `builtin` call runs on the platform's
        # account, while `standard` and `custom` spend the customer's own credential and
        # are never refused for our balance. After permission, so a caller who may not call
        # at all never has a balance consulted; before the secret and the dispatch, so a
        # refused call costs nothing.
        if target.namespace == GatewayEndpointNamespace.BUILTIN:
            admission = await self.policy.admit(scope=scope, target=policy_target)
            if not admission.allowed:
                await self.policy.record(
                    scope=scope,
                    target=policy_target,
                    decision=PolicyDecision(
                        allowed=False,
                        permission=decision.permission,
                        reason="entitlement_denied",
                    ),
                    outcome=GatewayOutcome(status_code=403),
                    run_id=run_id,
                )
                raise EntitlementDeniedError(
                    key="wallet_balance", target=target.target_path()
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
            select_upstream(target.provider_key, target.deployment_kind)
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
                timeout=target.settings.timeout_seconds,
            )
        except asyncio.TimeoutError as e:
            raise LLMUpstreamError(
                provider_key=target.provider_key,
                status_code=None,
                detail="upstream timed out",
            ) from e

        # Both paths record after the drain, never before: every adapter fills
        # `result.usage` while its body generator runs, so reading usage here would record
        # None on every call (§8). WHO does the draining is what differs, and it has to,
        # because only one of the two callers drains at all.
        if context.stream:
            # Starlette iterates a `StreamingResponse` to exhaustion, so the drain belongs
            # to the caller and the record rides its end.
            result.body = self._drain_and_record(
                body=result.body,
                scope=scope,
                target=policy_target,
                decision=decision,
                result=result,
                secret=secret,
                run_id=run_id,
                run_labels=run_labels,
            )
            return result

        # A non-streaming caller builds a plain `Response` from one chunk and stops, so
        # nothing ever advances the generator past its first yield. Deferring the record to
        # a `finally` that only runs when an abandoned generator is finalised put the whole
        # default path outside the audit trail: `policy.record` ran at garbage collection,
        # after the request, with `result.usage` still unset because the adapter assigns it
        # on the statement AFTER its yield (OR33). Drain here instead, while the call is
        # still the call.
        result.body = await self._drain_now_and_record(
            body=result.body,
            scope=scope,
            target=policy_target,
            decision=decision,
            result=result,
            secret=secret,
            run_id=run_id,
            run_labels=run_labels,
        )
        return result

    # --- internals ------------------------------------------------------------ #

    async def _namespace_of_slug(
        self, *, scope: AuthScope, slug: str
    ) -> GatewayEndpointNamespace:
        """Which of the three namespaces a `connection_slug` names (OR53).

        The two stored namespaces are asked first, in the order that keeps today's answers:
        a custom endpoint row owns its slug, then a builtin provider. A standard connection
        is reached last, and it is reached: `standard` is not only the provider families —
        a project may hold several keys for one family, and the slug of the one the caller
        chose names it. Anything else stays a custom miss, so an unknown slug still fails as
        `custom/<slug>`, which is the message the operator already knows.
        """
        custom = await self.llm_endpoints_dao.fetch_endpoint_by_slug(
            project_id=scope.project_id, slug=slug
        )
        if custom is not None:
            return GatewayEndpointNamespace.CUSTOM

        if builtin_llm_endpoint(provider_key=slug) is not None:
            return GatewayEndpointNamespace.BUILTIN

        if await self._standard_connection(scope=scope, name=slug) is not None:
            return GatewayEndpointNamespace.STANDARD

        return GatewayEndpointNamespace.CUSTOM

    async def _standard_connection(
        self, *, scope: AuthScope, name: str
    ) -> Optional[Tuple[LLMEndpoint, Optional[UUID]]]:
        """The standard endpoint `name` addresses, with the secret it pins, or None.

        Two spellings reach the same generated endpoint, and the difference between them is
        the whole of OR53. A provider family (`openai`) leaves the credential to the
        provider scan, which is how every standard route has always resolved. The slug of a
        `provider_key` connection pins that connection's own secret instead, so a project
        holding two OpenAI keys can route through the one it named rather than whichever the
        scan returns first. A connection created before connections were slugged has no slug
        and is still addressed by its family, unchanged.
        """
        endpoint = standard_llm_endpoint(provider_key=name)
        if endpoint is not None:
            return endpoint, None

        connection = await self.resolver.provider_connection_by_slug(
            scope=scope, slug=name
        )
        if connection is None:
            return None

        endpoint = standard_llm_endpoint(provider_key=connection.provider_key)
        if endpoint is None:
            return None

        return endpoint, connection.secret_id

    async def _resolve_target(
        self, *, scope: AuthScope, namespace: GatewayEndpointNamespace, name: str
    ) -> _ResolvedLlmTarget:
        project_id = scope.project_id

        if namespace == GatewayEndpointNamespace.STANDARD:
            standard = await self._standard_connection(scope=scope, name=name)
            if standard is None:
                raise LLMEndpointNotFoundError(namespace=namespace, name=name)
            endpoint, pinned = standard
            return _ResolvedLlmTarget(
                namespace=GatewayEndpointNamespace.STANDARD,
                name=name,
                provider_key=endpoint.provider_key,
                deployment_kind=endpoint.deployment_kind,
                models=endpoint.data.models,
                route_data=endpoint.data.route,
                settings=endpoint.data.settings,
                secret_id=pinned,
            )

        if namespace == GatewayEndpointNamespace.CUSTOM:
            row = await self.llm_endpoints_dao.fetch_endpoint_by_slug(
                project_id=project_id, slug=name
            )
            if row is None:
                raise LLMEndpointNotFoundError(namespace=namespace, name=name)
            return _ResolvedLlmTarget(
                namespace=GatewayEndpointNamespace.CUSTOM,
                name=row.slug or name,
                provider_key=row.provider_key,
                deployment_kind=row.deployment_kind,
                models=row.data.models,
                route_data=row.data.route,
                settings=row.data.settings,
                endpoint_id=row.id,
                secret_id=row.secret_id,
                is_active=row.flags.is_active,
            )

        if namespace == GatewayEndpointNamespace.BUILTIN:
            endpoint = builtin_llm_endpoint(provider_key=name)
            if endpoint is None:
                raise LLMEndpointNotFoundError(namespace=namespace, name=name)
            return _ResolvedLlmTarget(
                namespace=GatewayEndpointNamespace.BUILTIN,
                name=name,
                provider_key=endpoint.provider_key,
                deployment_kind=endpoint.deployment_kind,
                models=endpoint.data.models,
                route_data=endpoint.data.route,
                settings=endpoint.data.settings,
            )

        raise LLMEndpointNotFoundError(namespace=namespace, name=name)

    @staticmethod
    def _check_active(*, target: _ResolvedLlmTarget) -> None:
        if not target.is_active:
            raise GatewayEndpointInactiveError(target=target.target_path())

    def _check_allowlist(
        self,
        *,
        target: _ResolvedLlmTarget,
        context: LLMCallContext,
        payload: Dict[str, Any],
    ) -> None:
        """Measure every field that can select a model, not only the one named first.

        OR44: `model` was the whole check while the body travelled to the upstream
        unchanged, so `{"model": "gpt-4o", "models": ["forbidden-model"]}` passed an
        endpoint allowing only `gpt-4o` and the forbidden fallback ran on the primary's
        failure. Exact-string matching was never the weakness and is untouched here; the
        second field was.
        """
        if not target.models.allows(context.model):
            raise LLMModelNotAllowedError(
                model=context.model, namespace=target.namespace, name=target.name
            )

        fallbacks = payload.get(_FALLBACK_MODELS_FIELD)
        if fallbacks is not None:
            if not isinstance(fallbacks, list) or not all(
                isinstance(entry, str) for entry in fallbacks
            ):
                raise LLMRoutingFieldNotAllowedError(
                    field=_FALLBACK_MODELS_FIELD,
                    namespace=target.namespace,
                    name=target.name,
                    reason="it must be a list of model ids for the allowlist to check it",
                )
            for fallback in fallbacks:
                if not target.models.allows(fallback):
                    raise LLMModelNotAllowedError(
                        model=fallback, namespace=target.namespace, name=target.name
                    )

        for field in _UNSUPPORTED_ROUTING_FIELDS:
            # A JSON null names no routing, so only a field carrying a value is refused.
            if payload.get(field) is not None:
                raise LLMRoutingFieldNotAllowedError(
                    field=field, namespace=target.namespace, name=target.name
                )

    def _enforce_ceilings(
        self,
        *,
        target: _ResolvedLlmTarget,
        context: LLMCallContext,
        body: bytes,
        payload: Dict[str, Any],
    ) -> bytes:
        """Refuse a request above the ceiling, and write the ceiling into one that names none.

        OR50: the parser returned the FIRST recognised alias, so `{"max_tokens": 1,
        "max_completion_tokens": 999999}` passed a ceiling of 10, and a request naming no
        maximum at all returned `None` and was waved through to inherit the upstream's own
        default. A ceiling a request can decline by omission is not a ceiling.

        The body is re-serialised only in that last case, and only on an endpoint that
        configured a ceiling; every other request still relays byte-for-byte (D34).
        """
        ceiling = target.settings.max_output_tokens
        if ceiling is None:
            return body

        aliases = _CEILING_FIELDS[context.protocol]
        bounded = False
        for field in aliases:
            requested = _requested_max_output_tokens(payload.get(field))
            if requested is None:
                # Absent, null, or not a usable count. It names no maximum, so it cannot
                # satisfy the ceiling either: the write below covers it.
                continue
            if requested > ceiling:
                raise CeilingExceededError(
                    ceiling="max_output_tokens",
                    requested=requested,
                    allowed=ceiling,
                    target=target.target_path(),
                )
            bounded = True

        if bounded:
            return body

        # D25 forbids clamping a request that asked for more than the ceiling; this one
        # asked for nothing. Unusable spellings of the same alias are dropped rather than
        # left beside the value written, so the upstream cannot pick the other one.
        rewritten: Dict[str, Any] = {
            key: value for key, value in payload.items() if key not in aliases
        }
        rewritten[aliases[0]] = ceiling
        return json.dumps(rewritten).encode()

    def _outcome_from(
        self,
        *,
        result: LLMRelayResult,
        secret: Optional[ResolvedSecret],
        target: GatewayTarget,
    ) -> GatewayOutcome:
        # The payer follows the namespace (D30): a `builtin` call runs on the platform's
        # account whatever credential, if any, answered it. A `builtin` target resolves no
        # customer secret, so without this stamp its payer would read as unknown.
        if target.namespace == GatewayEndpointNamespace.BUILTIN:
            origin: Optional[SecretOrigin] = SecretOrigin.LOCAL
        else:
            origin = secret.origin if secret is not None else None
        return GatewayOutcome(
            status_code=result.status_code,
            usage=result.usage,
            owner=secret.owner if secret is not None else None,
            origin=origin,
        )

    async def _drain_now_and_record(
        self,
        *,
        body: AsyncIterator[bytes],
        scope: AuthScope,
        target: GatewayTarget,
        decision: PolicyDecision,
        result: LLMRelayResult,
        secret: Optional[ResolvedSecret],
        run_id: Optional[str],
        run_labels: Optional[Dict[str, str]],
    ) -> AsyncIterator[bytes]:
        """Consume a non-streaming body now, record the call, and hand back the bytes.

        Byte-preserving: the chunks are concatenated and replayed as one, which is what the
        caller reads anyway — and what it used to read was only the FIRST chunk, so an
        adapter that answered in more than one truncated its own response.
        """
        chunks: List[bytes] = []
        try:
            async for chunk in body:
                chunks.append(chunk)
        finally:
            # In a `finally` for the same reason the streaming drain is: a body that failed
            # part-way is still a call that happened, and it records whatever usage the
            # adapter had reached. Shielded for the reason given on the streaming drain
            # below (OR48).
            await run_shielded(
                self.policy.record(
                    scope=scope,
                    target=target,
                    decision=decision,
                    outcome=self._outcome_from(
                        result=result, secret=secret, target=target
                    ),
                    run_id=run_id,
                    run_labels=run_labels,
                )
            )
        return _replay_body(b"".join(chunks))

    async def _drain_and_record(
        self,
        *,
        body: AsyncIterator[bytes],
        scope: AuthScope,
        target: GatewayTarget,
        decision: PolicyDecision,
        result: LLMRelayResult,
        secret: Optional[ResolvedSecret],
        run_id: Optional[str],
        run_labels: Optional[Dict[str, str]],
    ) -> AsyncIterator[bytes]:
        try:
            async for chunk in body:
                yield chunk
        finally:
            # Fires on natural exhaustion and on a mid-stream break alike — usage is
            # whatever the adapter had populated by then, None if the crash pre-dated it.
            # A mid-stream break is usually a client disconnect, which reaches this
            # `finally` as a cancellation of the whole task: a bare `await` here would
            # raise before the record was made and the call would leave no trace at all
            # (OR48). Shielded, the record completes and the cancellation still propagates.
            await run_shielded(
                self.policy.record(
                    scope=scope,
                    target=target,
                    decision=decision,
                    outcome=self._outcome_from(
                        result=result, secret=secret, target=target
                    ),
                    run_id=run_id,
                    run_labels=run_labels,
                )
            )
