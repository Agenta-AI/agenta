"""A stored Vertex credential reaches LiteLLM only as an inline service-account document."""

import json

import pytest

from agenta.sdk.engines.running.errors import InvalidConfigurationParameterV0Error
from agenta.sdk.managers.secrets import _check_vertex_credentials

SERVICE_ACCOUNT = {"type": "service_account", "project_id": "p", "private_key": "k"}


@pytest.mark.parametrize("key", ["vertex_credentials", "vertex_ai_credentials"])
@pytest.mark.parametrize("value", [SERVICE_ACCOUNT, json.dumps(SERVICE_ACCOUNT)])
def test_service_account_document_is_accepted(key, value):
    _check_vertex_credentials({key: value, "vertex_project": "p"})


@pytest.mark.parametrize("key", ["vertex_credentials", "vertex_ai_credentials"])
@pytest.mark.parametrize(
    "value",
    [
        "/etc/hostname",
        "not json",
        json.dumps({"type": "external_account", "credential_source": {"file": "/x"}}),
        {"type": "authorized_user", "refresh_token": "r"},
        {"type": "service_account", "credential_source": {"file": "/x"}},
        ["service_account"],
    ],
)
def test_other_credential_formats_are_refused(key, value):
    with pytest.raises(InvalidConfigurationParameterV0Error) as exc:
        _check_vertex_credentials({key: value})
    assert exc.value.code == 400
    assert "/etc/hostname" not in exc.value.message


def test_extras_without_vertex_credentials_pass():
    _check_vertex_credentials(
        {"aws_region_name": "us-east-1", "vertex_credentials": None}
    )
