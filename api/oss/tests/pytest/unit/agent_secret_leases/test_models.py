import pytest
from pydantic import ValidationError

from oss.src.apis.fastapi.agent_secret_leases.models import LeaseReserveRequest
from oss.src.core.agent_secret_leases.dtos import LeaseReserve
from oss.src.core.agent_secret_leases.types import LeaseInvalid, normalize_exact_host


DIGEST = "hmac-sha256:" + "a" * 64


def payload(**resource_overrides):
    resource = {
        "consumer": {"kind": "model"},
        "binding": {"kind": "environment", "name": "OPENAI_API_KEY"},
        "usage": "opaque_http",
        "allowedHost": "api.openai.com",
        **resource_overrides,
    }
    return {
        "owner": {"kind": "session", "id": "session-1"},
        "idempotencyKey": "opaque-key-123456",
        "credentialEpochDigest": DIGEST,
        "resources": [resource],
    }


def test_request_accepts_only_non_secret_reconciliation_metadata():
    request = LeaseReserveRequest.model_validate(payload())
    core = LeaseReserve.model_validate(request.model_dump())
    serialized = core.model_dump(mode="json")
    assert serialized["resources"][0]["allowed_host"] == "api.openai.com"
    forbidden = {
        "value",
        "plaintext",
        "vault",
        "vault_slug",
        "placeholder",
        "endpoint",
        "authorization",
    }
    assert forbidden.isdisjoint(str(serialized).lower().replace("'", " ").split())


@pytest.mark.parametrize(
    "field", ["value", "vaultSlug", "placeholder", "endpoint", "authorization"]
)
def test_plaintext_or_source_reference_fields_are_rejected(field):
    body = payload()
    body["resources"][0][field] = "must-not-persist"
    with pytest.raises(ValidationError):
        LeaseReserveRequest.model_validate(body)


@pytest.mark.parametrize(
    "resource",
    [
        {"usage": "local_use"},
        {"allowedHost": "*.example.com"},
        {"allowedHost": "EXAMPLE.com"},
        {"allowedHost": "127.0.0.1"},
        {"allowedHost": "example.com:8443"},
        {"consumer": {"kind": "model", "key": "vault-slug"}},
        {"consumer": {"kind": "http_mcp"}},
    ],
)
def test_unsupported_usage_host_and_consumer_shapes_fail_closed(resource):
    with pytest.raises((ValidationError, LeaseInvalid)):
        request = LeaseReserveRequest.model_validate(payload(**resource))
        LeaseReserve.model_validate(request.model_dump())


def test_duplicate_binding_is_rejected_case_insensitively():
    body = payload()
    duplicate = dict(body["resources"][0])
    duplicate["binding"] = {"kind": "environment", "name": "openai_api_key"}
    body["resources"].append(duplicate)
    request = LeaseReserveRequest.model_validate(body)
    with pytest.raises(ValidationError, match="unique"):
        LeaseReserve.model_validate(request.model_dump())


def test_idna_host_requires_canonical_input():
    assert normalize_exact_host("xn--bcher-kva.example") == "xn--bcher-kva.example"
    with pytest.raises(LeaseInvalid):
        normalize_exact_host("https://api.example.com/path")
