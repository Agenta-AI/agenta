"""The gateway-credentials field, from the producer side (wave 2's seed, W1 and W2).

The specific failure the shape invites is a silent drop: a field that validates in the SDK,
serializes, and never arrives. So the assertion that matters is against the shared golden
`model_connection.gateway.json`, which the runner asserts too
(`services/runner/tests/unit/gateway-credentials.test.ts`) — one anchor, both legs.
"""

import pytest

from agenta.sdk.agents.connections.models import (
    Endpoint,
    EnvironmentCredentialBinding,
    GatewayCredentials,
    ResolvedConnection,
    ResolvedCredential,
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
    """W1: our credentials and a provider's secret are not interchangeable."""
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
    ["http://localhost:8000/gateways", "http://127.0.0.1:8000/gateways"],
)
def test_loopback_is_exempt_from_https(base_url):
    """W2: the check exists so a secret cannot cross a plaintext hop to a remote host."""
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
