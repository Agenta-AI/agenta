"""Build provider authentication headers without modifying request bodies."""

import asyncio
import json
from typing import Any, Callable, Coroutine, Dict, List, Optional, Tuple

from oss.src.core.gateways.egress import EgressRefusedError, open_egress
from oss.src.core.gateways.llms.dtos import LLMDeploymentKind, LLMResolvedRoute
from oss.src.core.gateways.llms.types import LLMUpstreamError
from oss.src.core.gateways.policy.dtos import ResolvedSecret
from oss.src.core.secrets.enums import SecretKind
from oss.src.utils.env import env

# Direct providers with non-standard authentication headers.
_DIRECT_AUTH_HEADERS: Dict[str, Tuple[str, str]] = {
    "anthropic": ("x-api-key", ""),
}
_DEFAULT_AUTH_HEADER: Tuple[str, str] = ("Authorization", "Bearer ")


def _secret_key(secret: ResolvedSecret) -> Optional[str]:
    data = secret.secret.data
    if secret.secret.kind in (SecretKind.PROVIDER_KEY, SecretKind.CUSTOM_PROVIDER):
        return data.provider.key
    return None


def _secret_extras(secret: ResolvedSecret) -> dict:
    data = secret.secret.data
    if secret.secret.kind == SecretKind.CUSTOM_PROVIDER:
        return data.provider.extras or {}
    return {}


async def _direct_auth(
    route: LLMResolvedRoute, secret: Optional[ResolvedSecret]
) -> Dict[str, str]:
    if secret is None:
        return {}
    key = _secret_key(secret)
    if not key:
        return {}
    header, prefix = _DIRECT_AUTH_HEADERS.get(route.provider_key, _DEFAULT_AUTH_HEADER)
    return {header: f"{prefix}{key}"}


async def _custom_auth(
    route: LLMResolvedRoute, secret: Optional[ResolvedSecret]
) -> Dict[str, str]:
    """A custom endpoint authenticates with its stored key and nothing else.

    `extras` used to be copied out as headers, one per entry, whatever the entry was named.
    That put two definitions of "credential" in the codebase and let them disagree: the
    gateway sent `extras["X-Api-Key"]` as authentication while the vault's public projection,
    which strips a declared vocabulary of SDK configuration keys, returned that same value in
    plaintext from a write-only record. The sibling module states the settled meaning —
    "a custom endpoint's `extras` are configuration, not secrets"
    (`core/gateways/dtos.py::_INJECTED_CREDENTIAL_HEADERS`) — and the echo scanner already
    relies on it, never scanning a relayed response for an extras value.

    So extras stop being headers rather than the projection stopping at extras. An allowlist
    of permitted extras-as-headers would reopen the moment someone added a key to it without
    classifying it on the redaction side, which is exactly how this arrived; with no mapping
    at all there is nothing to add to. Every remaining extras key the platform reads as
    credential material (`aws_bearer_token_bedrock`, `vertex_ai_credentials`) is named by a
    strategy below and classified in the shared vocabulary
    (`agenta.sdk.agents.connections.credentials`), whose parity test fails the build on an
    unclassified key.

    The cost: an endpoint that authenticated by smuggling a header through `extras` now gets
    a 401. That header belongs in the endpoint's own registered `headers`, which travel by
    design — and which are endpoint configuration, readable by anyone who can read the
    endpoint, so a secret put there is not write-only and is not pretending to be.
    """
    if secret is None:
        return {}
    key = _secret_key(secret)
    return {"Authorization": f"Bearer {key}"} if key else {}


async def _azure_auth(
    route: LLMResolvedRoute, secret: Optional[ResolvedSecret]
) -> Dict[str, str]:
    key = secret and _secret_key(secret)
    if not key:
        raise LLMUpstreamError(
            provider_key=route.provider_key,
            status_code=None,
            detail="azure endpoint has no secret",
        )
    return {"api-key": key}


async def _bedrock_auth(
    route: LLMResolvedRoute, secret: Optional[ResolvedSecret]
) -> Dict[str, str]:
    # Bedrock API keys are sent as bearer tokens.
    token = (secret and _secret_extras(secret).get("aws_bearer_token_bedrock")) or (
        secret and _secret_key(secret)
    )
    if not token:
        raise LLMUpstreamError(
            provider_key=route.provider_key,
            status_code=None,
            detail="bedrock endpoint has no bearer key",
        )
    return {"Authorization": f"Bearer {token}"}


def _document_urls(value: Any, found: List[str]) -> List[str]:
    """Every URL-shaped string anywhere in a credential document, in document order."""
    if isinstance(value, str):
        if "://" in value and value not in found:
            found.append(value)
    elif isinstance(value, dict):
        for nested in value.values():
            _document_urls(nested, found)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _document_urls(item, found)
    return found


async def _guarded_credential_document(
    route: LLMResolvedRoute, credentials: Any
) -> Dict[str, Any]:
    """The service-account document, checked against the egress boundary before it is used.

    Minting the Vertex token is an outbound call the gateway never makes itself: google-auth
    POSTs to the `token_uri` written inside this document, over its own transport, and it
    does so while `build_auth_headers` is still running — before `open_egress` has seen
    anything. A tenant could therefore name `http://127.0.0.1:8080/token` in a document they
    control and have the platform dial an internal address with no check at all.

    The document is tenant data, so it is checked here rather than by wrapping the library's
    transport: intercepting google-auth's HTTP stack means tracking a dependency's internals
    across versions, and it would still leave the same question about every other library
    that reads one of these. Checking the bytes before they are handed over is the boundary
    this module already owns.

    Every URL-shaped value in the document is checked, not `token_uri` alone. A service
    account also carries `auth_uri`, `auth_provider_x509_cert_url` and `client_x509_cert_url`;
    a workload-identity document carries `token_url`, `token_info_url`,
    `service_account_impersonation_url` and a `credential_source.url`. Which of those a given
    google-auth version dials is the library's business and changes between releases, so the
    check does not enumerate field names: it walks the document and refuses any URL the
    boundary refuses, including a non-http scheme, which `open_egress` rejects for us. The
    checks run concurrently so a document with four URLs costs one resolution's latency.
    """
    if isinstance(credentials, dict):
        document = credentials
    elif isinstance(credentials, str):
        try:
            document = json.loads(credentials)
        except (TypeError, ValueError) as exc:
            # LiteLLM reads a string that names an existing file (`VertexBase.load_auth`).
            # A stored credential is the service-account JSON; a path is the server's
            # filesystem addressed by tenant data, so it never gets that far.
            raise LLMUpstreamError(
                provider_key=route.provider_key,
                status_code=None,
                detail="vertex credential must be the service-account JSON document",
            ) from exc
    else:
        raise LLMUpstreamError(
            provider_key=route.provider_key,
            status_code=None,
            detail="vertex credential must be the service-account JSON document",
        )

    if not isinstance(document, dict):
        raise LLMUpstreamError(
            provider_key=route.provider_key,
            status_code=None,
            detail="vertex credential must be the service-account JSON document",
        )

    source = document.get("credential_source")
    if isinstance(source, dict) and source.get("executable"):
        # google-auth's pluggable source runs a subprocess. Nothing a tenant stores may name
        # a program for the platform to execute, whatever the library's own opt-in says.
        raise LLMUpstreamError(
            provider_key=route.provider_key,
            status_code=None,
            detail="blocked target: vertex credential names an executable credential source",
        )

    urls = _document_urls(document, [])
    if urls:
        results = await asyncio.gather(
            *(open_egress(url) for url in urls), return_exceptions=True
        )
        for result in results:
            if isinstance(result, EgressRefusedError):
                raise LLMUpstreamError(
                    provider_key=route.provider_key,
                    status_code=None,
                    detail=f"vertex credential URL refused: {result.relay_detail}",
                )
            if isinstance(result, BaseException):
                raise result

    return document


async def _vertex_auth(
    route: LLMResolvedRoute, secret: Optional[ResolvedSecret]
) -> Dict[str, str]:
    # LiteLLM mints the Vertex access token without transforming request or response bytes.
    from litellm.llms.vertex_ai.vertex_llm_base import VertexBase

    extras = _secret_extras(secret) if secret else {}
    credentials = extras.get("vertex_ai_credentials")
    project = (route.extras or {}).get("vertex_project")
    if not credentials or not project:
        raise LLMUpstreamError(
            provider_key=route.provider_key,
            status_code=None,
            detail="vertex endpoint needs a service-account credential and extras.vertex_project",
        )
    # The opt-in mock credential exercises the Vertex route without Google token minting.
    if env.mock_gateways.enabled and credentials == "agenta-gateway-mock":
        return {"Authorization": f"Bearer {env.mock_gateways.upstream_token}"}
    document = await _guarded_credential_document(route, credentials)
    token, _project = await VertexBase().get_access_token_async(
        credentials=document, project_id=project
    )
    return {"Authorization": f"Bearer {token}"}


async def _sagemaker_auth(
    route: LLMResolvedRoute, secret: Optional[ResolvedSecret]
) -> Dict[str, str]:  # noqa: ARG001
    raise LLMUpstreamError(
        provider_key=route.provider_key,
        status_code=None,
        detail="sagemaker has no fixed request protocol and is not reachable through the gateway",
    )


_AUTH: Dict[
    LLMDeploymentKind,
    Callable[
        [LLMResolvedRoute, Optional[ResolvedSecret]],
        Coroutine[None, None, Dict[str, str]],
    ],
] = {
    LLMDeploymentKind.DIRECT: _direct_auth,
    LLMDeploymentKind.CUSTOM: _custom_auth,
    LLMDeploymentKind.AZURE: _azure_auth,
    LLMDeploymentKind.BEDROCK: _bedrock_auth,
    LLMDeploymentKind.VERTEX: _vertex_auth,
    LLMDeploymentKind.SAGEMAKER: _sagemaker_auth,
}


async def build_auth_headers(
    route: LLMResolvedRoute, secret: Optional[ResolvedSecret]
) -> Dict[str, str]:
    strategy = _AUTH.get(route.deployment_kind)
    if strategy is None:
        raise LLMUpstreamError(
            provider_key=route.provider_key,
            status_code=None,
            detail=f"no auth strategy for deployment_kind {route.deployment_kind!r}",
        )
    return await strategy(route, secret)
