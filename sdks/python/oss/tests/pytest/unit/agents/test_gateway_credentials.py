"""The gateway-credentials field, from the producer side (wave 2's seed, D36 and D37).

The specific failure the shape invites is a silent drop: a field that validates in the SDK,
serializes, and never arrives. So the assertion that matters is against the shared golden
`model_connection.gateway.json`, which the runner asserts too
(`services/runner/tests/unit/gateway-credentials.test.ts`) — one anchor, both legs.
"""

import pytest

from agenta.sdk.agents.connections.endpoints import (
    build_gateway_resolved_connection,
)
from agenta.sdk.agents.connections.errors import GatewayInsecureEndpointError
from agenta.sdk.agents.connections.models import (
    INSECURE_HTTP_ENV_VAR,
    Endpoint,
    EnvironmentCredentialBinding,
    GatewayCredentials,
    ResolvedConnection,
    ResolvedCredential,
    is_effective_https_endpoint,
)

_GATEWAY_URL = "https://gateway.example.com/gateways/llms/standard/openai"


def _connection(**overrides) -> ResolvedConnection:
    fields = {
        "provider": "openai",
        "model": "gpt-5.5",
        "deployment": "custom",
        "credential_mode": "none",
        "endpoint": Endpoint(base_url=_GATEWAY_URL),
        "gateway_credentials": GatewayCredentials(
            value="ApiKey mock-gateway-credentials"
        ),
    }
    fields.update(overrides)
    return ResolvedConnection(**fields)


def test_wire_matches_the_shared_golden(golden):
    assert _connection().to_wire() == golden("model_connection.gateway.json")


def test_the_header_is_materialized_and_the_environment_is_not():
    connection = _connection()

    assert connection.plaintext_headers() == {
        "X-AG-Credentials": "ApiKey mock-gateway-credentials"
    }
    assert connection.plaintext_environment() == {}


def test_a_dump_never_carries_the_value():
    dumped = _connection().model_dump()

    assert dumped["gateway_credentials"]["value"] == "**********"
    assert "mock-gateway-credentials" not in repr(_connection())


def test_the_provider_secret_stays_its_own_field():
    """D36: our credentials and a provider's secret are not interchangeable."""
    connection = _connection(
        credential_mode="env",
        credentials=[
            ResolvedCredential(
                binding=EnvironmentCredentialBinding(name="OPENAI_API_KEY"),
                value="sk-provider",
                usage="opaque_http",
            )
        ],
    )

    assert connection.plaintext_environment() == {"OPENAI_API_KEY": "sk-provider"}
    assert connection.plaintext_headers() == {
        "X-AG-Credentials": "ApiKey mock-gateway-credentials"
    }


@pytest.mark.parametrize("value", ["", "   "])
def test_an_empty_header_name_is_refused(value):
    with pytest.raises(ValueError):
        GatewayCredentials(header=value, value="ApiKey something")


def test_an_empty_value_is_refused():
    with pytest.raises(ValueError):
        GatewayCredentials(value="")


def test_plain_http_to_a_remote_host_is_refused():
    with pytest.raises(ValueError):
        _connection(endpoint=Endpoint(base_url="http://gateway.example.com/gateways"))


@pytest.mark.parametrize(
    "base_url",
    [
        "http://localhost:8000/gateways",
        "http://127.0.0.1:8000/gateways",
        "http://host.docker.internal:8000/gateways",
    ],
)
def test_local_development_host_is_exempt_from_https(base_url):
    """D37: a bearer never crosses plaintext to a remote host."""
    assert _connection(endpoint=Endpoint(base_url=base_url)).plaintext_headers()


def test_the_loopback_exemption_covers_the_provider_secret_too():
    """The runner re-validates; an SDK that accepted more than the runner would strand a run."""
    connection = _connection(
        endpoint=Endpoint(base_url="http://localhost:8000/gateways"),
        credential_mode="env",
        credentials=[
            ResolvedCredential(
                binding=EnvironmentCredentialBinding(name="OPENAI_API_KEY"),
                value="sk-provider",
                usage="opaque_http",
            )
        ],
    )

    assert connection.plaintext_environment() == {"OPENAI_API_KEY": "sk-provider"}


# --------------------------------------------------------------------------------------- #
# The plain-http opt-in (OR24). Every case sets the variable explicitly, in both directions:
# the ambient value is whatever env file the shell loaded, and a default this rule depends on
# must never be inherited from one. `allow_insecure_env` opts these out of the root conftest's
# secure-by-default pin, because asserting the env resolution IS the point here.
# --------------------------------------------------------------------------------------- #

_ROUTABLE_HTTP = "http://144.76.237.122:8680/api/gateways/llms/builtin/mock/v1"


@pytest.mark.allow_insecure_env
def test_plain_http_to_a_routable_host_is_refused_with_the_flag_off(monkeypatch):
    monkeypatch.setenv(INSECURE_HTTP_ENV_VAR, "false")

    with pytest.raises(ValueError):
        _connection(endpoint=Endpoint(base_url=_ROUTABLE_HTTP))


@pytest.mark.allow_insecure_env
def test_plain_http_to_a_routable_host_is_refused_when_the_flag_is_unset(monkeypatch):
    """Absent is off. The rule may not depend on an operator remembering to set `false`."""
    monkeypatch.delenv(INSECURE_HTTP_ENV_VAR, raising=False)

    with pytest.raises(ValueError):
        _connection(endpoint=Endpoint(base_url=_ROUTABLE_HTTP))


@pytest.mark.allow_insecure_env
def test_plain_http_to_a_routable_host_is_allowed_with_the_flag_on(monkeypatch):
    monkeypatch.setenv(INSECURE_HTTP_ENV_VAR, "true")

    connection = _connection(endpoint=Endpoint(base_url=_ROUTABLE_HTTP))

    assert connection.plaintext_headers() == {
        "X-AG-Credentials": "ApiKey mock-gateway-credentials"
    }


@pytest.mark.allow_insecure_env
def test_the_opt_in_never_covers_a_provider_secret(monkeypatch):
    """The flag is scoped to OUR credentials into OUR gateway (D37's reason is unchanged for
    a provider's own secret: it must not cross a plaintext hop to a host we do not control)."""
    monkeypatch.setenv(INSECURE_HTTP_ENV_VAR, "true")

    with pytest.raises(ValueError):
        _connection(
            endpoint=Endpoint(base_url=_ROUTABLE_HTTP),
            credential_mode="env",
            gateway_credentials=None,
            credentials=[
                ResolvedCredential(
                    binding=EnvironmentCredentialBinding(name="OPENAI_API_KEY"),
                    value="sk-provider",
                    usage="opaque_http",
                )
            ],
        )


@pytest.mark.allow_insecure_env
def test_the_opt_in_does_not_widen_https_or_loopback(monkeypatch):
    """Turning the flag on must change exactly one answer, not relax the scheme check."""
    monkeypatch.setenv(INSECURE_HTTP_ENV_VAR, "true")

    assert is_effective_https_endpoint("https://gateway.example.com/gateways")
    assert is_effective_https_endpoint("http://localhost:8000/gateways")
    # No host, and a non-http scheme, stay refusals in both flag states.
    assert not is_effective_https_endpoint("http://", allow_insecure_http=True)
    assert not is_effective_https_endpoint("", allow_insecure_http=True)
    assert not is_effective_https_endpoint(
        "ftp://gateway.example.com", allow_insecure_http=True
    )


# --------------------------------------------------------------------------------------- #
# The typed refusal (OR25). The construction seam must answer with the actionable envelope,
# not with the pydantic ValidationError the model invariant raises underneath it.
# --------------------------------------------------------------------------------------- #


def _build_gateway(**overrides):
    fields = {
        "provider": "openai",
        "model": "mock/echo",
        "deployment": "direct",
        "namespace": "builtin",
        "name": "mock",
        "gateway_base_url": "http://144.76.237.122:8680/api",
        "gateway_credentials_value": "ApiKey mock-gateway-credentials",
    }
    fields.update(overrides)
    return build_gateway_resolved_connection(**fields)


@pytest.mark.allow_insecure_env
def test_the_refusal_is_typed_and_names_the_flag(monkeypatch):
    monkeypatch.setenv(INSECURE_HTTP_ENV_VAR, "false")

    with pytest.raises(GatewayInsecureEndpointError) as raised:
        _build_gateway()

    error = raised.value
    # A configuration situation, not a server fault: the caller must see a client error rather
    # than the 500 a bare ValidationError produced.
    assert error.status_code == 422
    assert error.failure_code == "gateway_insecure_endpoint"

    detail = error.error_detail
    assert detail["code"] == "gateway_insecure_endpoint"
    assert detail["retryable"] is False
    assert detail["message"] and "HTTPS" in detail["message"]
    assert INSECURE_HTTP_ENV_VAR in detail["next_step"]
    assert detail["details"]["flag"] == INSECURE_HTTP_ENV_VAR
    # The address the refusal is about, so an operator can tell which URL to fix. Non-secret.
    assert detail["details"]["base_url"].startswith("http://144.76.237.122:8680/api")
    # The credential value must never travel in an error body.
    assert "mock-gateway-credentials" not in str(detail)


@pytest.mark.allow_insecure_env
def test_the_flag_lets_the_same_construction_succeed(monkeypatch):
    monkeypatch.setenv(INSECURE_HTTP_ENV_VAR, "true")

    connection = _build_gateway()

    assert connection.endpoint.base_url == (
        "http://144.76.237.122:8680/api/gateways/llms/builtin/mock/v1"
    )
    assert connection.plaintext_headers() == {
        "X-AG-Credentials": "ApiKey mock-gateway-credentials"
    }


@pytest.mark.allow_insecure_env
def test_an_https_gateway_never_consults_the_flag(monkeypatch):
    monkeypatch.setenv(INSECURE_HTTP_ENV_VAR, "false")

    connection = _build_gateway(gateway_base_url="https://cloud.example.com/api")

    assert connection.endpoint.base_url.startswith("https://cloud.example.com/api")
