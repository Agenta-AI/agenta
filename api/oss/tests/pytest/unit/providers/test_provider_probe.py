"""Provider credential-test and model-discovery probes.

The rules under test come from docs/design/provider-connections-models/provider-discovery.md:
a probe never sends a paid generation request, a public catalog never proves a key, and a
provider with no free credential test answers `unknown` rather than guessing.

Outbound calls are served by `httpx.MockTransport`, so no test reaches a real provider.
"""

import asyncio
from typing import List
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.providers import router as router_module
from oss.src.apis.fastapi.providers.models import ProbeProviderRequest
from oss.src.apis.fastapi.providers.router import ProvidersRouter
from oss.src.core.providers.dtos import ProviderCredentials
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.providers.exceptions import (
    ProviderEndpointNotAllowed,
    ProviderEndpointRequired,
    UnsupportedProviderKind,
)
from oss.src.core.providers.service import ProviderProbeService


CANARY = "sk-CANARY-DO-NOT-LEAK-abc123"
PUBLIC_IP = "93.184.216.34"


class Recorder:
    """A MockTransport handler that answers canned responses and remembers the requests."""

    def __init__(self, responder):
        self.responder = responder
        self.requests: List[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.responder(request)


def probe_service(responder) -> tuple[ProviderProbeService, Recorder]:
    recorder = Recorder(responder)
    return ProviderProbeService(transport=httpx.MockTransport(recorder)), recorder


def json_response(payload, status_code: int = 200):
    return lambda request: httpx.Response(status_code, json=payload)


def status_response(status_code: int):
    return lambda request: httpx.Response(status_code, json={"error": "nope"})


def transport_error(request):
    raise httpx.ConnectError("connection refused", request=request)


async def run_probe(responder, *, kind: str, credentials: ProviderCredentials):
    service, recorder = probe_service(responder)
    result = await service.probe(kind=kind, credentials=credentials)
    return result, recorder


@pytest.fixture
def public_dns(monkeypatch):
    """Resolve every hostname to a public address so the egress guard admits it."""

    import socket

    def _getaddrinfo(host, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (PUBLIC_IP, 443))]

    monkeypatch.setattr(socket, "getaddrinfo", _getaddrinfo)


# --- per-adapter behavior --------------------------------------------------- #

# kind, expected host, catalog payload, expected model identifiers
CATALOG_PROVIDERS = [
    (
        "openai",
        "api.openai.com",
        {"data": [{"id": "gpt-5.6-luna"}, {"id": "gpt-5.6-terra"}]},
        ["gpt-5.6-luna", "gpt-5.6-terra"],
    ),
    (
        "anthropic",
        "api.anthropic.com",
        {"data": [{"id": "claude-fable-5"}]},
        ["claude-fable-5"],
    ),
    (
        "gemini",
        "generativelanguage.googleapis.com",
        {
            "models": [
                {
                    "name": "models/gemini-3.5-flash",
                    "supportedGenerationMethods": ["generateContent"],
                },
                {
                    "name": "models/text-embedding-004",
                    "supportedGenerationMethods": ["embedContent"],
                },
            ]
        },
        ["gemini-3.5-flash"],
    ),
    (
        "mistral",
        "api.mistral.ai",
        {"data": [{"id": "mistral-medium-latest"}]},
        ["mistral-medium-latest"],
    ),
    (
        "groq",
        "api.groq.com",
        {"data": [{"id": "llama-3.1-8b-instant"}]},
        ["llama-3.1-8b-instant"],
    ),
    (
        "cohere",
        "api.cohere.com",
        {"models": [{"name": "command-r"}]},
        ["command-r"],
    ),
    (
        "together_ai",
        "api.together.xyz",
        [{"id": "zai-org/GLM-5.2"}],
        ["zai-org/GLM-5.2"],
    ),
]


@pytest.mark.parametrize("kind,host,payload,models", CATALOG_PROVIDERS)
async def test_accepted_key_is_valid_and_fetches_models(kind, host, payload, models):
    result, recorder = await run_probe(
        json_response(payload),
        kind=kind,
        credentials=ProviderCredentials(key=CANARY),
    )

    assert result.credential.status.value == "valid"
    assert result.discovery.status.value == "fetched"
    assert result.discovery.models == models

    sent = recorder.requests[0]
    assert sent.url.host == host
    assert sent.method == "GET"
    # The read must actually carry the credential, or a `valid` proves nothing.
    assert CANARY in str(sent.url) or CANARY in " ".join(sent.headers.values())


@pytest.mark.parametrize("kind,host,payload,models", CATALOG_PROVIDERS)
async def test_rejected_key_is_invalid_and_names_the_status(
    kind, host, payload, models
):
    result, _ = await run_probe(
        status_response(401),
        kind=kind,
        credentials=ProviderCredentials(key=CANARY),
    )

    assert result.credential.status.value == "invalid"
    assert "401" in result.credential.message
    assert result.discovery.status.value == "failed"
    assert result.discovery.models == []


@pytest.mark.parametrize("kind,host,payload,models", CATALOG_PROVIDERS)
async def test_network_failure_is_unknown_not_invalid(kind, host, payload, models):
    result, _ = await run_probe(
        transport_error,
        kind=kind,
        credentials=ProviderCredentials(key=CANARY),
    )

    assert result.credential.status.value == "unknown"
    assert result.discovery.status.value == "failed"


@pytest.mark.parametrize("kind,host,payload,models", CATALOG_PROVIDERS)
async def test_server_error_is_unknown_not_invalid(kind, host, payload, models):
    result, _ = await run_probe(
        status_response(503),
        kind=kind,
        credentials=ProviderCredentials(key=CANARY),
    )

    assert result.credential.status.value == "unknown"
    assert "503" in result.credential.message
    assert result.discovery.status.value == "failed"


async def test_missing_key_never_reaches_the_provider():
    result, recorder = await run_probe(
        json_response({"data": []}),
        kind="openai",
        credentials=ProviderCredentials(),
    )

    assert result.credential.status.value == "invalid"
    assert result.discovery.status.value == "failed"
    assert recorder.requests == []


async def test_legacy_provider_slugs_resolve_to_their_canonical_adapter():
    for alias, host in (
        ("mistralai", "api.mistral.ai"),
        ("togetherai", "api.together.xyz"),
    ):
        _, recorder = await run_probe(
            json_response({"data": [{"id": "x"}]}),
            kind=alias,
            credentials=ProviderCredentials(key=CANARY),
        )
        assert recorder.requests[0].url.host == host


async def test_unsupported_kind_is_a_request_error():
    service, _ = probe_service(json_response({}))

    with pytest.raises(UnsupportedProviderKind):
        await service.probe(kind="not-a-provider", credentials=ProviderCredentials())


# --- the public-catalog rule ------------------------------------------------ #


async def test_openrouter_public_catalog_does_not_make_a_bad_key_valid():
    """`/models` is public. A 200 from it must not outrank the 401 from `/key`."""

    def responder(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/key"):
            return httpx.Response(401, json={"error": "invalid api key"})
        return httpx.Response(200, json={"data": [{"id": "z-ai/glm-5.2"}]})

    result, _ = await run_probe(
        responder,
        kind="openrouter",
        credentials=ProviderCredentials(key=CANARY),
    )

    assert result.credential.status.value == "invalid"
    assert "401" in result.credential.message


async def test_openrouter_valid_key_fetches_the_catalog():
    def responder(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/key"):
            return httpx.Response(200, json={"data": {"limit": None}})
        return httpx.Response(200, json={"data": [{"id": "z-ai/glm-5.2"}]})

    result, recorder = await run_probe(
        responder,
        kind="openrouter",
        credentials=ProviderCredentials(key=CANARY),
    )

    assert result.credential.status.value == "valid"
    assert result.discovery.status.value == "fetched"
    assert result.discovery.models == ["z-ai/glm-5.2"]
    assert [request.url.path for request in recorder.requests] == [
        "/api/v1/key",
        "/api/v1/models",
    ]


async def test_the_timeout_budget_covers_the_whole_probe_not_each_request():
    """OpenRouter issues two requests, so a per-request budget would double the wait."""

    async def slow(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(10)
        return httpx.Response(200, json={"data": {"limit": None}})

    service = ProviderProbeService(timeout=0.05, transport=httpx.MockTransport(slow))

    loop = asyncio.get_running_loop()
    started = loop.time()
    result = await service.probe(
        kind="openrouter",
        credentials=ProviderCredentials(key=CANARY),
    )
    elapsed = loop.time() - started

    # One budget for the call, not one per request.
    assert elapsed < 1.0
    # A probe that ran out of time proved nothing; it does not claim the key is bad.
    assert result.credential.status.value == "unknown"
    assert result.discovery.status.value == "failed"
    assert CANARY not in result.credential.message


@pytest.mark.parametrize(
    "kind,payload,models",
    [
        (
            "deepinfra",
            [{"model_name": "meta-llama/Llama-3.1-8B"}],
            ["meta-llama/Llama-3.1-8B"],
        ),
        ("perplexityai", {"data": [{"id": "sonar-pro"}]}, ["sonar-pro"]),
    ],
)
async def test_public_catalog_refreshes_models_without_claiming_the_key_is_valid(
    kind, payload, models
):
    result, _ = await run_probe(
        json_response(payload),
        kind=kind,
        credentials=ProviderCredentials(key=CANARY),
    )

    assert result.credential.status.value == "unknown"
    assert result.discovery.status.value == "fetched"
    assert result.discovery.models == models


@pytest.mark.parametrize("kind", ["minimax", "anyscale", "alephalpha", "vertex_ai"])
async def test_providers_without_a_free_test_answer_unknown_and_send_nothing(kind):
    result, recorder = await run_probe(
        json_response({"data": []}),
        kind=kind,
        credentials=ProviderCredentials(key=CANARY, extras={"vertex_ai_project": "p"}),
    )

    assert result.credential.status.value == "unknown"
    assert result.discovery.status.value == "unsupported"
    assert recorder.requests == []


async def test_bedrock_without_a_bearer_token_is_unknown_not_a_failed_test():
    result, recorder = await run_probe(
        json_response({}),
        kind="bedrock",
        credentials=ProviderCredentials(
            extras={
                "aws_region_name": "us-east-1",
                "aws_access_key_id": "AKIA",
                "aws_secret_access_key": CANARY,
            }
        ),
    )

    assert result.credential.status.value == "unknown"
    assert result.discovery.status.value == "unsupported"
    assert recorder.requests == []


async def test_bedrock_bearer_token_lists_foundation_models():
    result, recorder = await run_probe(
        json_response({"modelSummaries": [{"modelId": "anthropic.claude-sonnet-5"}]}),
        kind="bedrock",
        credentials=ProviderCredentials(
            extras={
                "aws_region_name": "eu-central-1",
                "aws_bearer_token_bedrock": CANARY,
            }
        ),
    )

    assert result.credential.status.value == "valid"
    assert result.discovery.models == ["anthropic.claude-sonnet-5"]
    assert recorder.requests[0].url.host == "bedrock.eu-central-1.amazonaws.com"


async def test_bedrock_rejects_a_region_that_could_forge_a_host():
    result, recorder = await run_probe(
        json_response({}),
        kind="bedrock",
        credentials=ProviderCredentials(
            extras={
                "aws_region_name": "us-east-1.attacker.example.com",
                "aws_bearer_token_bedrock": CANARY,
            }
        ),
    )

    assert result.credential.status.value == "unknown"
    assert recorder.requests == []


# --- caller-supplied endpoints ---------------------------------------------- #


async def test_custom_endpoint_404_is_unsupported_not_invalid(public_dns):
    """OpenAI compatibility promises a generation route, not the management API."""

    result, _ = await run_probe(
        status_response(404),
        kind="custom",
        credentials=ProviderCredentials(key=CANARY, url="https://llm.example.com/v1"),
    )

    assert result.credential.status.value == "unknown"
    assert result.discovery.status.value == "unsupported"


async def test_custom_endpoint_405_is_unsupported_not_invalid(public_dns):
    result, _ = await run_probe(
        status_response(405),
        kind="custom",
        credentials=ProviderCredentials(key=CANARY, url="https://llm.example.com/v1"),
    )

    assert result.discovery.status.value == "unsupported"
    assert result.credential.status.value != "invalid"


async def test_custom_endpoint_401_is_invalid(public_dns):
    result, _ = await run_probe(
        status_response(401),
        kind="custom",
        credentials=ProviderCredentials(key=CANARY, url="https://llm.example.com/v1"),
    )

    assert result.credential.status.value == "invalid"


async def test_custom_endpoint_authenticated_200_proves_the_key_there(public_dns):
    result, recorder = await run_probe(
        json_response({"data": [{"id": "local-model"}]}),
        kind="custom",
        credentials=ProviderCredentials(key=CANARY, url="https://llm.example.com/v1/"),
    )

    assert result.credential.status.value == "valid"
    assert result.discovery.models == ["local-model"]

    sent = recorder.requests[0]
    # Pinned to the validated IP, with the original authority preserved for TLS and routing.
    assert sent.url.host == PUBLIC_IP
    assert sent.url.path == "/v1/models"
    assert sent.headers["Host"] == "llm.example.com"
    assert sent.headers["Authorization"] == f"Bearer {CANARY}"


async def test_custom_endpoint_200_without_a_key_does_not_prove_anything(public_dns):
    result, _ = await run_probe(
        json_response({"data": [{"id": "local-model"}]}),
        kind="custom",
        credentials=ProviderCredentials(url="https://llm.example.com/v1"),
    )

    assert result.credential.status.value == "unknown"
    assert result.discovery.status.value == "fetched"


async def test_azure_reads_the_accounts_own_models(public_dns):
    result, recorder = await run_probe(
        json_response({"data": [{"id": "gpt-5.6-luna"}]}),
        kind="azure",
        credentials=ProviderCredentials(
            key=CANARY,
            url="https://contoso.openai.azure.com",
            version="2024-06-01",
        ),
    )

    assert result.credential.status.value == "valid"
    assert result.discovery.models == ["gpt-5.6-luna"]

    sent = recorder.requests[0]
    assert sent.url.path == "/openai/models"
    assert sent.url.params["api-version"] == "2024-06-01"
    assert sent.headers["api-key"] == CANARY
    assert sent.headers["Host"] == "contoso.openai.azure.com"


async def test_a_custom_endpoint_needs_a_url():
    service, _ = probe_service(json_response({}))

    with pytest.raises(ProviderEndpointRequired):
        await service.probe(
            kind="custom", credentials=ProviderCredentials(key=CANARY, url="")
        )


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1:8443/v1",
        "https://169.254.169.254/latest",
        "https://[::1]/v1",
        "http://llm.example.com/v1",
        "file:///etc/passwd",
    ],
)
async def test_ssrf_targets_are_rejected_before_any_request(url):
    service, recorder = probe_service(json_response({"data": []}))

    with pytest.raises(ProviderEndpointNotAllowed):
        await service.probe(
            kind="custom",
            credentials=ProviderCredentials(key=CANARY, url=url),
        )

    assert recorder.requests == []


async def test_a_hostname_resolving_to_a_private_address_is_rejected(monkeypatch):
    """The literal-IP check is not enough: the guard resolves before it connects."""

    import socket

    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda host, *a, **kw: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.5", 443))
        ],
    )

    service, recorder = probe_service(json_response({"data": []}))

    with pytest.raises(ProviderEndpointNotAllowed):
        await service.probe(
            kind="custom",
            credentials=ProviderCredentials(
                key=CANARY, url="https://rebind.example.com/v1"
            ),
        )

    assert recorder.requests == []


# --- credentials never leak ------------------------------------------------- #


@pytest.mark.parametrize(
    "render",
    [repr, str, lambda c: str(c.model_dump()), lambda c: c.model_dump_json()],
    ids=["repr", "str", "model_dump", "model_dump_json"],
)
def test_rendering_the_credentials_object_never_shows_the_key(render):
    """A stray log line or traceback carrying the object must not print the secret."""

    credentials = ProviderCredentials(key=CANARY, url="https://llm.example.com/v1")

    assert CANARY not in render(credentials)


@pytest.mark.parametrize("render", [repr, str], ids=["repr", "str"])
def test_printing_the_credentials_object_never_shows_the_extras(render):
    """Bedrock's token and AWS secret ride in `extras`, which is kept out of `repr`."""

    credentials = ProviderCredentials(
        extras={"aws_region_name": "us-east-1", "aws_bearer_token_bedrock": CANARY}
    )

    assert CANARY not in render(credentials)
    assert "us-east-1" not in render(credentials)


def test_the_masked_key_renders_as_asterisks_in_json():
    credentials = ProviderCredentials(key=CANARY)

    assert "**********" in credentials.model_dump_json()


def test_the_key_is_still_readable_where_the_request_is_built():
    """Masking is for printing only: the probe must still be able to send the key."""

    credentials = ProviderCredentials(key=f"  {CANARY}  ")

    assert credentials.key.get_secret_value().strip() == CANARY


def test_a_plain_string_key_is_accepted_at_the_model_boundary():
    """The router takes the vault's field vocabulary: `key` arrives as JSON string."""

    body = ProbeProviderRequest.model_validate(
        {"kind": "openai", "provider": {"key": CANARY}}
    )

    assert body.provider.key.get_secret_value() == CANARY
    assert CANARY not in repr(body)


async def test_no_probe_result_ever_carries_the_credential(public_dns):
    cases = [
        ("openai", ProviderCredentials(key=CANARY)),
        ("openrouter", ProviderCredentials(key=CANARY)),
        ("gemini", ProviderCredentials(key=CANARY)),
        ("deepinfra", ProviderCredentials(key=CANARY)),
        ("minimax", ProviderCredentials(key=CANARY)),
        ("custom", ProviderCredentials(key=CANARY, url="https://llm.example.com/v1")),
        (
            "azure",
            ProviderCredentials(
                key=CANARY, url="https://contoso.openai.azure.com", version="2024-06-01"
            ),
        ),
        (
            "bedrock",
            ProviderCredentials(
                extras={
                    "aws_region_name": "us-east-1",
                    "aws_bearer_token_bedrock": CANARY,
                }
            ),
        ),
    ]

    for status_code in (200, 401, 500):
        for kind, credentials in cases:
            result, _ = await run_probe(
                status_response(status_code),
                kind=kind,
                credentials=credentials,
            )
            assert CANARY not in result.model_dump_json(), f"{kind} at {status_code}"


async def test_probing_logs_the_outcome_and_never_the_credential(monkeypatch, caplog):
    from oss.src.core.providers import service as service_module

    recorded = []

    class SpyLog:
        def __getattr__(self, _name):
            def capture(*args, **kwargs):
                recorded.append(repr((args, kwargs)))

            return capture

    monkeypatch.setattr(service_module, "log", SpyLog())

    with caplog.at_level("DEBUG"):
        await run_probe(
            json_response({"data": [{"id": "gpt-5.6-luna"}]}),
            kind="openai",
            credentials=ProviderCredentials(key=CANARY),
        )

    assert recorded, "the probe should record its outcome"
    assert all(CANARY not in line for line in recorded)
    assert CANARY not in caplog.text


# --- route wiring ----------------------------------------------------------- #


PROJECT_ID = uuid4()
STORED_KEY = "sk-STORED-DO-NOT-LEAK-abc123"


class _StubVault:
    """Holds one secret per (project, id), like the scoped vault read does."""

    def __init__(self):
        self.records: dict = {}

    def store(self, secret_id, project_id, secret):
        self.records[(str(project_id), str(secret_id))] = secret

    async def get_secret_by_id(
        self, *, secret_id, project_id=None, organization_id=None
    ):
        return self.records.get((str(project_id), str(secret_id)))


def _stored_provider_key(key: str = STORED_KEY, kind: str = "openai"):
    """A stored provider_key row as the vault hands it to an in-process reader."""
    return SecretResponseDTO(
        id=uuid4(),
        slug=f"{kind}-stored",
        kind="provider_key",
        data={"kind": kind, "provider": {"key": key}},
        header={"name": "Stored"},
        write_only=True,
    )


def _stored_custom_provider(url: str, key: str = STORED_KEY):
    return SecretResponseDTO(
        id=uuid4(),
        slug="gateway-stored",
        kind="custom_provider",
        data={
            "kind": "custom",
            "provider": {"key": key, "url": url},
            "models": [{"slug": "gpt-5.6-luna"}],
        },
        header={"name": "Gateway"},
        write_only=True,
    )


def build_client(
    monkeypatch, responder, *, permitted: bool = True, vault=None
) -> TestClient:
    async def _check_action_access(**_kwargs) -> bool:
        return permitted

    monkeypatch.setattr(router_module, "check_action_access", _check_action_access)

    service, _ = probe_service(responder)
    vault = vault if vault is not None else _StubVault()
    app = FastAPI()

    @app.middleware("http")
    async def _scope(request, call_next):
        request.state.user_id = str(uuid4())
        request.state.project_id = str(PROJECT_ID)
        return await call_next(request)

    app.include_router(
        ProvidersRouter(provider_probe_service=service, vault_service=vault).router
    )
    app.include_router(
        ProvidersRouter(provider_probe_service=service, vault_service=vault).router,
        prefix="/vault/v1",
    )
    return TestClient(app)


def probe_payload(kind: str = "openai", **provider) -> dict:
    return {"kind": kind, "provider": {"key": CANARY, **provider}}


@pytest.mark.parametrize("path", ["/providers/probe", "/vault/v1/providers/probe"])
def test_probe_route_returns_both_statuses_and_a_timestamp(monkeypatch, path):
    client = build_client(
        monkeypatch, json_response({"data": [{"id": "gpt-5.6-luna"}]})
    )

    response = client.post(path, json=probe_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["credential"]["status"] == "valid"
    assert body["discovery"] == {"status": "fetched", "models": ["gpt-5.6-luna"]}
    assert body["fetched_at"].endswith("Z")
    assert CANARY not in response.text


def test_probe_route_answers_200_for_a_rejected_key(monkeypatch):
    client = build_client(monkeypatch, status_response(401))

    response = client.post("/providers/probe", json=probe_payload())

    assert response.status_code == 200
    assert response.json()["credential"]["status"] == "invalid"
    assert CANARY not in response.text


def test_probe_route_rejects_a_blocked_endpoint_without_echoing_the_key(monkeypatch):
    client = build_client(monkeypatch, json_response({"data": []}))

    response = client.post(
        "/providers/probe",
        json=probe_payload("custom", url="https://127.0.0.1:8443/v1"),
    )

    assert response.status_code == 422
    assert CANARY not in response.text


def test_probe_route_rejects_an_unknown_kind(monkeypatch):
    client = build_client(monkeypatch, json_response({"data": []}))

    response = client.post("/providers/probe", json=probe_payload("not-a-provider"))

    assert response.status_code == 422
    assert CANARY not in response.text


def test_probe_route_requires_edit_secret(monkeypatch):
    client = build_client(monkeypatch, json_response({"data": []}), permitted=False)

    response = client.post("/providers/probe", json=probe_payload())

    assert response.status_code == 403
    assert CANARY not in response.text


def test_a_malformed_probe_body_does_not_echo_the_credential(monkeypatch):
    """The route carries the vault router's SecretSafeRoute; the body IS a credential."""

    client = build_client(monkeypatch, json_response({"data": []}))

    response = client.post(
        "/providers/probe",
        json={"kind": "openai", "provider": {"key": CANARY, "extras": "not-an-object"}},
    )

    assert response.status_code == 422
    assert CANARY not in response.text


# --- probing a stored connection --------------------------------------------- #


def test_a_stored_key_probes_without_the_caller_sending_one(monkeypatch):
    # The case this exists for: once a connection is write-only its value never comes
    # back to the browser, so "Test" had nothing to send and stayed disabled.
    vault = _StubVault()
    secret_id = uuid4()
    vault.store(secret_id, PROJECT_ID, _stored_provider_key())
    client = build_client(
        monkeypatch, json_response({"data": [{"id": "gpt-5.6-luna"}]}), vault=vault
    )

    response = client.post(
        "/providers/probe", json={"secret_id": str(secret_id), "provider": {}}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["credential"]["status"] == "valid"
    assert body["discovery"]["models"] == ["gpt-5.6-luna"]
    assert STORED_KEY not in response.text


def test_the_stored_key_is_what_reaches_the_provider(monkeypatch):
    vault = _StubVault()
    secret_id = uuid4()
    vault.store(secret_id, PROJECT_ID, _stored_provider_key())
    recorder = Recorder(json_response({"data": []}))
    client = build_client(monkeypatch, recorder, vault=vault)

    client.post("/providers/probe", json={"secret_id": str(secret_id)})

    (sent,) = recorder.requests
    assert sent.headers["authorization"] == f"Bearer {STORED_KEY}"


def test_a_typed_base_url_overrides_the_stored_one(monkeypatch, public_dns):
    # Testing an edit before saving it: the card changed the URL, the key is still the
    # stored one because it was never readable.
    vault = _StubVault()
    secret_id = uuid4()
    vault.store(
        secret_id, PROJECT_ID, _stored_custom_provider(url="https://old.example.com/v1")
    )
    recorder = Recorder(json_response({"data": [{"id": "gpt-5.6-luna"}]}))
    client = build_client(monkeypatch, recorder, vault=vault)

    response = client.post(
        "/providers/probe",
        json={
            "secret_id": str(secret_id),
            "provider": {"url": "https://new.example.com/v1"},
        },
    )

    assert response.status_code == 200
    (sent,) = recorder.requests
    # The egress guard pins the connection to the resolved address and carries the
    # hostname in the Host header, so that is where the typed URL shows up.
    assert sent.headers["host"] == "new.example.com"
    assert sent.headers["authorization"] == f"Bearer {STORED_KEY}"


def test_a_typed_key_overrides_the_stored_one(monkeypatch):
    vault = _StubVault()
    secret_id = uuid4()
    vault.store(secret_id, PROJECT_ID, _stored_provider_key())
    recorder = Recorder(json_response({"data": []}))
    client = build_client(monkeypatch, recorder, vault=vault)

    client.post(
        "/providers/probe",
        json={"secret_id": str(secret_id), "provider": {"key": CANARY}},
    )

    (sent,) = recorder.requests
    assert sent.headers["authorization"] == f"Bearer {CANARY}"


def test_a_secret_from_another_project_is_not_found(monkeypatch):
    vault = _StubVault()
    secret_id = uuid4()
    vault.store(secret_id, uuid4(), _stored_provider_key())  # someone else's project
    client = build_client(monkeypatch, json_response({"data": []}), vault=vault)

    response = client.post("/providers/probe", json={"secret_id": str(secret_id)})

    assert response.status_code == 404
    assert STORED_KEY not in response.text


def test_an_unknown_secret_is_not_found(monkeypatch):
    client = build_client(monkeypatch, json_response({"data": []}))

    response = client.post("/providers/probe", json={"secret_id": str(uuid4())})

    assert response.status_code == 404


def test_the_stored_key_is_not_lent_to_another_provider(monkeypatch):
    # A stored credential belongs to the provider it was saved for. Changing the kind
    # while using it would send one provider's key to another's endpoint.
    vault = _StubVault()
    secret_id = uuid4()
    vault.store(secret_id, PROJECT_ID, _stored_provider_key(kind="openai"))
    recorder = Recorder(json_response({"data": []}))
    client = build_client(monkeypatch, recorder, vault=vault)

    response = client.post(
        "/providers/probe", json={"secret_id": str(secret_id), "kind": "anthropic"}
    )

    assert response.status_code == 422
    assert recorder.requests == []
    assert STORED_KEY not in response.text


def test_a_kind_change_is_allowed_when_the_caller_brings_the_credential(monkeypatch):
    vault = _StubVault()
    secret_id = uuid4()
    vault.store(secret_id, PROJECT_ID, _stored_provider_key(kind="openai"))
    client = build_client(monkeypatch, json_response({"data": []}), vault=vault)

    response = client.post(
        "/providers/probe",
        json={
            "secret_id": str(secret_id),
            "kind": "anthropic",
            "provider": {"key": CANARY},
        },
    )

    assert response.status_code == 200


def test_a_probe_must_name_a_kind_or_a_secret(monkeypatch):
    client = build_client(monkeypatch, json_response({"data": []}))

    response = client.post("/providers/probe", json={"provider": {"key": CANARY}})

    assert response.status_code == 422
    assert CANARY not in response.text


def test_blank_typed_fields_fall_back_to_the_stored_ones(monkeypatch, public_dns):
    # The card drops blanks, but a form that submits "" must not be read as "probe with
    # no URL and no key" — that fails a connection which is actually fine.
    vault = _StubVault()
    secret_id = uuid4()
    vault.store(
        secret_id, PROJECT_ID, _stored_custom_provider(url="https://old.example.com/v1")
    )
    recorder = Recorder(json_response({"data": [{"id": "gpt-5.6-luna"}]}))
    client = build_client(monkeypatch, recorder, vault=vault)

    response = client.post(
        "/providers/probe",
        json={
            "secret_id": str(secret_id),
            "provider": {"url": "", "key": "", "version": "", "extras": {}},
        },
    )

    assert response.status_code == 200
    (sent,) = recorder.requests
    assert sent.headers["host"] == "old.example.com"
    assert sent.headers["authorization"] == f"Bearer {STORED_KEY}"


def test_an_omitted_provider_object_probes_exactly_what_is_stored(
    monkeypatch, public_dns
):
    vault = _StubVault()
    secret_id = uuid4()
    vault.store(
        secret_id, PROJECT_ID, _stored_custom_provider(url="https://old.example.com/v1")
    )
    recorder = Recorder(json_response({"data": []}))
    client = build_client(monkeypatch, recorder, vault=vault)

    response = client.post("/providers/probe", json={"secret_id": str(secret_id)})

    assert response.status_code == 200
    (sent,) = recorder.requests
    assert sent.headers["host"] == "old.example.com"
    assert sent.headers["authorization"] == f"Bearer {STORED_KEY}"
