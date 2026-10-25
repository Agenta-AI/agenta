"""The relay's echo scan covers every value of an organization credential (M5, P1).

An organization secret's primary key and every credential extras value are scanned in
the response headers, a non-streaming body and a streamed body, whatever header carried
them; project secrets keep today's scan (the injected headers only).
"""

import json
from typing import List
from uuid import uuid4

import httpx
import pytest

from oss.src.core.gateways.dtos import CREDENTIAL_ECHO_CODE, secret_credential_values
from oss.src.core.gateways.llms.dtos import (
    LLMCallContext,
    LLMDeploymentKind,
    LLMEndpointSettings,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.providers.passthrough.adapter import (
    LLMUpstreamCredentialEchoError,
    RelayLLMAdapter,
)
from oss.src.core.gateways.policy.dtos import ResolvedSecret, SecretOrigin
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.enums import SecretOwnerKind

KEY = "sk-m5-organization-key-000000000001"
EXTRA = "sk-m5-organization-extra-0000000002"


def _route() -> LLMResolvedRoute:
    return LLMResolvedRoute(
        provider_key="openai",
        deployment_kind=LLMDeploymentKind.CUSTOM,
        model="gpt-4o",
        base_url="https://upstream.example/v1",
        settings=LLMEndpointSettings(),
    )


def _secret(owner_kind: SecretOwnerKind) -> ResolvedSecret:
    secret = SecretResponseDTO.model_validate(
        {
            "id": str(uuid4()),
            "slug": "company",
            "kind": "custom_provider",
            "data": {
                "kind": "custom",
                "provider": {
                    "url": "https://upstream.example/v1",
                    "key": KEY,
                    "extras": {"api_key": EXTRA},
                },
                "models": [{"slug": "gpt-4o"}],
            },
            "header": {"name": "Company"},
            "owner": {"kind": owner_kind.value, "id": str(uuid4())},
        }
    )
    return ResolvedSecret(secret=secret, owner=secret.owner, origin=SecretOrigin.VAULT)


def _adapter(handler) -> RelayLLMAdapter:
    return RelayLLMAdapter(
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )


def _body() -> bytes:
    return json.dumps({"model": "gpt-4o", "messages": []}).encode()


async def _relay(handler, *, owner_kind, stream=False):
    return await _adapter(handler).relay_chat_completion(
        route=_route(),
        secret=_secret(owner_kind),
        context=LLMCallContext(model="gpt-4o", stream=stream),
        body=_body(),
        headers={},
    )


def _assert_refused(error):
    assert error.envelope["code"] == CREDENTIAL_ECHO_CODE
    rendered = json.dumps(error.envelope) + str(error)
    assert KEY not in rendered and EXTRA not in rendered


def test_secret_credential_values_lists_the_key_and_the_credential_extras():
    values = secret_credential_values(_secret(SecretOwnerKind.ORGANIZATION).secret)
    assert set(values) == {KEY.encode(), EXTRA.encode()}


@pytest.mark.parametrize("value", [KEY, EXTRA])
async def test_a_response_header_echoing_an_organization_value_is_refused(value):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "x"}, headers={"x-debug": value})

    with pytest.raises(LLMUpstreamCredentialEchoError) as excinfo:
        result = await _relay(handler, owner_kind=SecretOwnerKind.ORGANIZATION)
        [chunk async for chunk in result.body]
    _assert_refused(excinfo.value)


async def test_a_non_streaming_body_echoing_the_extras_value_is_refused():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": f"bad key {EXTRA}"}})

    result = await _relay(handler, owner_kind=SecretOwnerKind.ORGANIZATION)
    with pytest.raises(LLMUpstreamCredentialEchoError) as excinfo:
        [chunk async for chunk in result.body]
    _assert_refused(excinfo.value)


@pytest.mark.parametrize("value", [KEY, EXTRA])
async def test_a_split_streamed_echo_is_refused(value):
    frame = f'data: {{"error":"key {value} is invalid"}}\n\n'.encode()
    split = frame.index(value.encode()) + len(value) // 2
    first, second = frame[:split], frame[split:]

    async def handler(request: httpx.Request) -> httpx.Response:
        async def stream():
            yield first
            yield second

        return httpx.Response(
            200, headers={"content-type": "text/event-stream"}, content=stream()
        )

    result = await _relay(handler, owner_kind=SecretOwnerKind.ORGANIZATION, stream=True)
    relayed: List[bytes] = []
    with pytest.raises(LLMUpstreamCredentialEchoError) as excinfo:
        async for chunk in result.body:
            relayed.append(chunk)
    _assert_refused(excinfo.value)
    assert value.encode() not in b"".join(relayed)


async def test_project_secrets_keep_todays_scan():
    """A project secret's extras value is not an injected header, so today's scan does
    not look for it; the change is for organization credentials only."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "x", "note": EXTRA})

    result = await _relay(handler, owner_kind=SecretOwnerKind.PROJECT)
    chunks = [chunk async for chunk in result.body]
    assert EXTRA.encode() in b"".join(chunks)


@pytest.mark.parametrize("field", ["key", "extras"])
async def test_a_padded_value_is_stored_stripped_and_its_echo_refused(
    monkeypatch, field
):
    """The late Codex finding: `"  m5key123  "` must not be stored with its padding, or the
    scan (which strips) and the stored value disagree. The value is stored stripped, so
    the upstream echoing the bare token is refused."""
    import oss.src.core.secrets.services as services_module
    from oss.src.core.secrets.dtos import CreateSecretDTO
    from oss.src.core.secrets.services import VaultService
    from oss.tests.pytest.utils.organization_secrets import (
        InMemorySecretsDAO,
        install_cache_engine,
        org_secret_payload,
    )

    install_cache_engine(monkeypatch)

    async def no_publish(**kwargs):
        return None

    monkeypatch.setattr(services_module, "_safe_publish", no_publish)
    organization_id = uuid4()
    vault = VaultService(InMemorySecretsDAO(projects={uuid4(): organization_id}))
    padded = "   m5key123   "
    payload = (
        org_secret_payload(kind="custom_provider", family="custom", key=padded)
        if field == "key"
        else org_secret_payload(
            kind="custom_provider",
            family="custom",
            key="sk-m5-other-key-000000000003",
            extras={"api_key": padded},
        )
    )
    stored = await vault.create_organization_secret(
        organization_id=organization_id,
        create_secret_dto=CreateSecretDTO.model_validate(payload),
        user_id=uuid4(),
    )
    secret = ResolvedSecret(
        secret=stored, owner=stored.owner, origin=SecretOrigin.VAULT
    )
    assert b"m5key123" in secret_credential_values(stored)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "bad key m5key123"})

    result = await _adapter(handler).relay_chat_completion(
        route=_route(),
        secret=secret,
        context=LLMCallContext(model="gpt-4o"),
        body=_body(),
        headers={},
    )
    with pytest.raises(LLMUpstreamCredentialEchoError):
        [chunk async for chunk in result.body]


@pytest.mark.parametrize(
    "value",
    ['org-key-"abcdefgh"', "org-key\\abcdefgh", "org/key/abcdefgh", "org-key-abcdéfgh"],
    ids=["quotes", "backslash", "slashes", "non-ascii"],
)
@pytest.mark.parametrize("where", ["key", "extras"])
@pytest.mark.parametrize("stream", [False, True])
async def test_a_json_escaped_echo_of_an_organization_value_is_refused(
    value, where, stream
):
    """Codex r2: a value with characters JSON escapes (quotes, backslashes, `/`,
    non-ASCII) is echoed escaped inside a JSON or SSE-JSON body; the scan finds it."""
    secret = SecretResponseDTO.model_validate(
        {
            "id": str(uuid4()),
            "slug": "company",
            "kind": "custom_provider",
            "data": {
                "kind": "custom",
                "provider": {
                    "url": "https://upstream.example/v1",
                    "key": value if where == "key" else KEY,
                    "extras": {"api_key": value if where == "extras" else EXTRA},
                },
                "models": [{"slug": "gpt-4o"}],
            },
            "header": {"name": "Company"},
            "owner": {"kind": "organization", "id": str(uuid4())},
        }
    )
    resolved = ResolvedSecret(
        secret=secret, owner=secret.owner, origin=SecretOrigin.VAULT
    )
    escaped = json.dumps({"note": f"you sent {value}"}, ensure_ascii=True).encode()
    escaped_slash = escaped.replace(b"/", b"\\/")

    async def handler(request: httpx.Request) -> httpx.Response:
        if not stream:
            return httpx.Response(200, content=escaped_slash)
        frame = b"data: " + escaped_slash + b"\n\n"
        half = len(frame) // 2

        async def body():
            yield frame[:half]
            yield frame[half:]

        return httpx.Response(
            200, headers={"content-type": "text/event-stream"}, content=body()
        )

    result = await _adapter(handler).relay_chat_completion(
        route=_route(),
        secret=resolved,
        context=LLMCallContext(model="gpt-4o", stream=stream),
        body=_body(),
        headers={},
    )
    with pytest.raises(LLMUpstreamCredentialEchoError):
        [chunk async for chunk in result.body]


@pytest.mark.parametrize(
    "value", ["org-key-<abc>&defgh", "org-key-abc defgé"], ids=["html", "separator"]
)
@pytest.mark.parametrize("stream", [False, True])
async def test_a_go_style_escaped_echo_is_refused(value, stream):
    """Codex r2b: Go's encoder escapes <, >, & and U+2028/U+2029 and keeps other
    non-ASCII characters. (The write rule refuses such characters in header values; a
    structured document such as a Vertex service account can still hold them.)"""
    secret = SecretResponseDTO.model_validate(
        {
            "id": str(uuid4()),
            "slug": "company",
            "kind": "custom_provider",
            "data": {
                "kind": "custom",
                "provider": {"url": "https://upstream.example/v1", "key": value},
                "models": [{"slug": "gpt-4o"}],
            },
            "header": {"name": "Company"},
            "owner": {"kind": "organization", "id": str(uuid4())},
        }
    )
    resolved = ResolvedSecret(
        secret=secret, owner=secret.owner, origin=SecretOrigin.VAULT
    )
    go = (
        json.dumps({"note": value}, ensure_ascii=False)
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace(" ", "\\u2028")
        .encode()
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        if not stream:
            return httpx.Response(200, content=go)
        frame = b"data: " + go + b"\n\n"
        half = len(frame) // 2

        async def body():
            yield frame[:half]
            yield frame[half:]

        return httpx.Response(
            200, headers={"content-type": "text/event-stream"}, content=body()
        )

    result = await _adapter(handler).relay_chat_completion(
        route=_route(),
        secret=resolved,
        context=LLMCallContext(model="gpt-4o", stream=stream),
        body=_body(),
        headers={},
    )
    with pytest.raises(LLMUpstreamCredentialEchoError):
        [chunk async for chunk in result.body]
