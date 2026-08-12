"""One adapter per provider family: a single free, read-only request each.

Two rules shape every adapter, both from
docs/design/provider-connections-models/provider-discovery.md:

- A probe never sends a generation request. Testing a key must not cost the user money.
- A public catalog endpoint answers discovery only. It can never raise the credential
  status above `unknown`, however cleanly it responds.

Providers with no confirmed free credential test answer `unknown`, which is a result the
card is designed to accept, not an error.
"""

from dataclasses import dataclass
from re import fullmatch
from typing import Any, Callable, Dict, FrozenSet, List, Optional, Protocol

import httpx

from oss.src.core.providers.dtos import (
    CredentialResult,
    CredentialStatus,
    DiscoveryResult,
    DiscoveryStatus,
    ProbeOutcome,
    ProviderCredentials,
)
from oss.src.core.providers.endpoints import endpoint_host, guard_endpoint


class ProviderAdapter(Protocol):
    label: str

    async def probe(
        self,
        *,
        client: httpx.AsyncClient,
        credentials: ProviderCredentials,
    ) -> ProbeOutcome: ...


# --- outcome builders ------------------------------------------------------- #


def _unknown(message: str, discovery: DiscoveryStatus) -> ProbeOutcome:
    return ProbeOutcome(
        credential=CredentialResult(status=CredentialStatus.UNKNOWN, message=message),
        discovery=DiscoveryResult(status=discovery),
    )


def _missing_key(label: str) -> ProbeOutcome:
    return ProbeOutcome(
        credential=CredentialResult(
            status=CredentialStatus.INVALID,
            message=f"{label} needs an API key to test.",
        ),
        discovery=DiscoveryResult(status=DiscoveryStatus.FAILED),
    )


async def _probe_catalog(
    *,
    client: httpx.AsyncClient,
    label: str,
    url: str,
    extract: Callable[[Any], List[str]],
    headers: Optional[Dict[str, str]] = None,
    params: Optional[Dict[str, str]] = None,
    extensions: Optional[Dict[str, Any]] = None,
    proves_credential: bool = True,
    unsupported_statuses: FrozenSet[int] = frozenset(),
    public_note: Optional[str] = None,
) -> ProbeOutcome:
    """GET a model list and map the response onto the two statuses.

    `proves_credential=False` is the public-catalog case: a 200 says nothing about the
    key, so the credential stays `unknown` no matter how well the read went.
    """

    try:
        response = await client.get(
            url,
            headers=headers or None,
            params=params or None,
            extensions=extensions or None,
        )
    except httpx.HTTPError:
        return _unknown(f"Could not reach {label}.", DiscoveryStatus.FAILED)

    status = response.status_code

    if status in unsupported_statuses:
        return _unknown(
            f"{label} has no model list endpoint to test the key against ({status}).",
            DiscoveryStatus.UNSUPPORTED,
        )

    if status in (401, 403):
        return ProbeOutcome(
            credential=CredentialResult(
                status=CredentialStatus.INVALID,
                message=f"{label} rejected this key ({status}).",
            ),
            discovery=DiscoveryResult(status=DiscoveryStatus.FAILED),
        )

    if not response.is_success:
        return _unknown(
            f"{label} did not answer the credential check ({status}).",
            DiscoveryStatus.FAILED,
        )

    if proves_credential:
        credential = CredentialResult(
            status=CredentialStatus.VALID,
            message=f"{label} accepted this key.",
        )
    else:
        credential = CredentialResult(
            status=CredentialStatus.UNKNOWN,
            message=public_note
            or f"{label} publishes its model list without authentication, so this key was not tested.",
        )

    try:
        models = extract(response.json())
    except (AttributeError, KeyError, TypeError, ValueError):
        return ProbeOutcome(
            credential=credential,
            discovery=DiscoveryResult(status=DiscoveryStatus.FAILED),
        )

    return ProbeOutcome(
        credential=credential,
        discovery=DiscoveryResult(status=DiscoveryStatus.FETCHED, models=models),
    )


# --- model-list extractors -------------------------------------------------- #


def _ids(items: Any, key: str = "id") -> List[str]:
    return [
        str(item[key]) for item in items if isinstance(item, dict) and item.get(key)
    ]


def _openai_style(payload: Any) -> List[str]:
    return _ids(payload["data"])


def _bare_list(payload: Any) -> List[str]:
    return _ids(payload)


def _cohere_models(payload: Any) -> List[str]:
    return _ids(payload["models"], key="name")


def _deepinfra_models(payload: Any) -> List[str]:
    return _ids(payload, key="model_name")


def _bedrock_models(payload: Any) -> List[str]:
    return _ids(payload["modelSummaries"], key="modelId")


def _gemini_models(payload: Any) -> List[str]:
    """Only models that can actually generate, with the `models/` resource prefix off."""

    names = []
    for item in payload["models"]:
        if not isinstance(item, dict):
            continue
        methods = item.get("supportedGenerationMethods") or []
        name = item.get("name")
        if name and "generateContent" in methods:
            names.append(str(name).removeprefix("models/"))
    return names


# --- adapters --------------------------------------------------------------- #


def _bearer(key: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {key}"}


@dataclass(frozen=True)
class ApiKeyCatalogAdapter:
    """One authenticated GET answers both questions at once."""

    label: str
    url: str
    extract: Callable[[Any], List[str]]
    authorize: Callable[[str], Dict[str, str]] = _bearer
    parameterize: Optional[Callable[[str], Dict[str, str]]] = None

    async def probe(self, *, client, credentials) -> ProbeOutcome:
        key = (credentials.key or "").strip()
        if not key:
            return _missing_key(self.label)

        return await _probe_catalog(
            client=client,
            label=self.label,
            url=self.url,
            extract=self.extract,
            headers=None if self.parameterize else self.authorize(key),
            params=self.parameterize(key) if self.parameterize else None,
        )


@dataclass(frozen=True)
class PublicCatalogAdapter:
    """The catalog is public, so it refreshes models and proves nothing about the key."""

    label: str
    url: str
    extract: Callable[[Any], List[str]]
    authorize: Optional[Callable[[str], Dict[str, str]]] = _bearer

    async def probe(self, *, client, credentials) -> ProbeOutcome:
        key = (credentials.key or "").strip()
        return await _probe_catalog(
            client=client,
            label=self.label,
            url=self.url,
            extract=self.extract,
            headers=self.authorize(key) if key and self.authorize else None,
            proves_credential=False,
        )


@dataclass(frozen=True)
class UntestableAdapter:
    """No confirmed free read endpoint. Say so instead of guessing, and send nothing."""

    label: str
    reason: str
    discovery: DiscoveryStatus = DiscoveryStatus.UNSUPPORTED

    async def probe(self, *, client, credentials) -> ProbeOutcome:
        return _unknown(f"{self.label} {self.reason}", self.discovery)


@dataclass(frozen=True)
class OpenRouterAdapter:
    """Two endpoints: `/key` proves the credential, `/models` is public and only lists.

    Reading the public catalog alone would report a stolen or empty key as valid.
    """

    label: str = "OpenRouter"
    key_url: str = "https://openrouter.ai/api/v1/key"
    models_url: str = "https://openrouter.ai/api/v1/models"

    async def probe(self, *, client, credentials) -> ProbeOutcome:
        key = (credentials.key or "").strip()
        if not key:
            return _missing_key(self.label)

        credential_outcome = await _probe_catalog(
            client=client,
            label=self.label,
            url=self.key_url,
            extract=lambda _: [],
            headers=_bearer(key),
        )
        credential = credential_outcome.credential

        if credential.status is CredentialStatus.INVALID:
            return ProbeOutcome(
                credential=credential,
                discovery=DiscoveryResult(status=DiscoveryStatus.FAILED),
            )

        catalog = await _probe_catalog(
            client=client,
            label=self.label,
            url=self.models_url,
            extract=_openai_style,
            headers=_bearer(key),
            proves_credential=False,
        )

        return ProbeOutcome(credential=credential, discovery=catalog.discovery)


@dataclass(frozen=True)
class AzureAdapter:
    """Lists the models enabled on the user's own resource, not a public catalog."""

    label: str = "Azure OpenAI"

    async def probe(self, *, client, credentials) -> ProbeOutcome:
        key = (credentials.key or "").strip()
        if not key:
            return _missing_key(self.label)

        version = (credentials.version or "").strip()
        if not version:
            return _unknown(
                f"{self.label} needs an API version to test.",
                DiscoveryStatus.FAILED,
            )

        endpoint = guard_endpoint(credentials.url or "", path="openai/models")

        return await _probe_catalog(
            client=client,
            label=self.label,
            url=endpoint.url,
            extract=_openai_style,
            headers={**endpoint.headers, "api-key": key},
            params={"api-version": version},
            extensions=endpoint.extensions,
        )


@dataclass(frozen=True)
class OpenAICompatibleAdapter:
    """The compatibility label promises a generation route, not the management API.

    A 404 or 405 on `/models` therefore means discovery is unsupported here — it is not
    evidence that the key is wrong.
    """

    label: str = "This endpoint"

    async def probe(self, *, client, credentials) -> ProbeOutcome:
        endpoint = guard_endpoint(credentials.url or "", path="models")
        host = endpoint_host(credentials.url or "")
        key = (credentials.key or "").strip()

        headers = dict(endpoint.headers)
        if key:
            headers.update(_bearer(key))

        return await _probe_catalog(
            client=client,
            label=host,
            url=endpoint.url,
            extract=_openai_style,
            headers=headers,
            extensions=endpoint.extensions,
            # An authenticated 200 on the user's own endpoint does prove the key there.
            proves_credential=bool(key),
            unsupported_statuses=frozenset({404, 405}),
            public_note=f"{host} answered without a key, so this key was not tested.",
        )


_AWS_REGION = r"[a-z0-9-]{1,32}"


@dataclass(frozen=True)
class BedrockAdapter:
    """`ListFoundationModels` is free and read-only, but only the bearer token is reachable.

    Access-key credentials need SigV4, which needs boto3 or botocore; neither is an API
    dependency and this slice does not add one.
    TODO(provider-connections): sign ListFoundationModels with SigV4 once the API gains
    botocore, so access-key-and-secret Bedrock connections can be tested too.
    """

    label: str = "AWS Bedrock"

    async def probe(self, *, client, credentials) -> ProbeOutcome:
        extras = credentials.extras or {}
        region = str(extras.get("aws_region_name") or "").strip()
        token = str(extras.get("aws_bearer_token_bedrock") or "").strip()

        if not region or not fullmatch(_AWS_REGION, region):
            return _unknown(
                f"{self.label} needs an AWS region to test.",
                DiscoveryStatus.UNSUPPORTED,
            )

        if not token:
            return _unknown(
                f"{self.label} can only be tested with a bearer token; access-key credentials are saved untested.",
                DiscoveryStatus.UNSUPPORTED,
            )

        return await _probe_catalog(
            client=client,
            label=self.label,
            url=f"https://bedrock.{region}.amazonaws.com/foundation-models",
            extract=_bedrock_models,
            headers=_bearer(token),
        )


@dataclass(frozen=True)
class VertexAdapter:
    """Needs an OAuth token minted from the service-account JSON.

    That exchange needs google-auth, which is not an API dependency and this slice does
    not add one.
    TODO(provider-connections): mint the token and call the publisher-model list once the
    API gains google-auth.
    """

    label: str = "Google Vertex AI"

    async def probe(self, *, client, credentials) -> ProbeOutcome:
        return _unknown(
            f"{self.label} credentials are saved untested: Agenta cannot yet exchange the "
            "service-account JSON for a token.",
            DiscoveryStatus.UNSUPPORTED,
        )


# --- registry --------------------------------------------------------------- #


_ADAPTERS: Dict[str, ProviderAdapter] = {
    "openai": ApiKeyCatalogAdapter(
        label="OpenAI",
        url="https://api.openai.com/v1/models",
        extract=_openai_style,
    ),
    "anthropic": ApiKeyCatalogAdapter(
        label="Anthropic",
        url="https://api.anthropic.com/v1/models",
        extract=_openai_style,
        authorize=lambda key: {"x-api-key": key, "anthropic-version": "2023-06-01"},
    ),
    "openrouter": OpenRouterAdapter(),
    "gemini": ApiKeyCatalogAdapter(
        label="Google Gemini",
        url="https://generativelanguage.googleapis.com/v1beta/models",
        extract=_gemini_models,
        parameterize=lambda key: {"key": key},
    ),
    "mistral": ApiKeyCatalogAdapter(
        label="Mistral AI",
        url="https://api.mistral.ai/v1/models",
        extract=_openai_style,
    ),
    "groq": ApiKeyCatalogAdapter(
        label="Groq",
        url="https://api.groq.com/openai/v1/models",
        extract=_openai_style,
    ),
    "cohere": ApiKeyCatalogAdapter(
        label="Cohere",
        url="https://api.cohere.com/v1/models",
        extract=_cohere_models,
    ),
    "together_ai": ApiKeyCatalogAdapter(
        label="Together AI",
        url="https://api.together.xyz/v1/models",
        extract=_bare_list,
    ),
    "deepinfra": PublicCatalogAdapter(
        label="DeepInfra",
        url="https://api.deepinfra.com/models/list",
        extract=_deepinfra_models,
        authorize=None,
    ),
    "perplexityai": PublicCatalogAdapter(
        label="Perplexity AI",
        url="https://api.perplexity.ai/v1/models",
        extract=_openai_style,
    ),
    "minimax": UntestableAdapter(
        label="MiniMax",
        reason="publishes no model list or free credential check, so this key was saved untested.",
    ),
    "anyscale": UntestableAdapter(
        label="Anyscale",
        reason="has no hosted-model endpoint to test against; connect its endpoint as an OpenAI-compatible provider instead.",
    ),
    "alephalpha": UntestableAdapter(
        label="Aleph Alpha",
        reason="is no longer offered; existing connections keep working but cannot be tested.",
    ),
    "sagemaker": UntestableAdapter(
        label="Amazon SageMaker",
        reason="exposes per-endpoint deployments rather than a model list, so this connection is saved untested.",
    ),
    "azure": AzureAdapter(),
    "bedrock": BedrockAdapter(),
    "vertex_ai": VertexAdapter(),
    "custom": OpenAICompatibleAdapter(),
}

# Legacy provider slugs the vault also accepts on input.
_ALIASES = {"mistralai": "mistral", "togetherai": "together_ai"}


def supported_kinds() -> List[str]:
    return sorted(_ADAPTERS)


def get_adapter(kind: str) -> Optional[ProviderAdapter]:
    return _ADAPTERS.get(_ALIASES.get(kind, kind))
