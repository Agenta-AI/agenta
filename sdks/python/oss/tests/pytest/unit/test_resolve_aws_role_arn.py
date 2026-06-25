"""Unit tests for ``_resolve_aws_role_arn`` in handlers.py.

The resolver exchanges an ``aws_role_arn`` for short-lived STS session credentials and
hands them to LiteLLM as request-scoped ``aws_*`` kwargs (no ``os.environ`` mutation,
see #4244). These tests pin:

- the no-op path (no role ARN -> settings returned unchanged, same object);
- both ``aws_role_arn`` and ``AWS_ROLE_ARN`` casings trigger ``sts:AssumeRole``;
- the base credentials (either casing) sign the STS client, region included;
- the region defaults to ``us-east-1`` and resolves from each supported alias;
- the temporary credentials replace any static keys and the role ARN is dropped;
- the input dict is not mutated;
- composition with ``_normalize_aws_provider_settings`` yields only canonical kwargs.
"""

from unittest.mock import MagicMock, patch

import pytest

from agenta.sdk.engines.running.handlers import (
    _normalize_aws_provider_settings,
    _resolve_aws_role_arn,
)

_ROLE_ARN = "arn:aws:iam::123456789012:role/agenta-bedrock"
_TEMP = {
    "AccessKeyId": "ASIATEMP",
    "SecretAccessKey": "tempsecret",
    "SessionToken": "temptoken",
}


def _mock_sts(credentials=None) -> MagicMock:
    sts = MagicMock()
    sts.assume_role.return_value = {"Credentials": credentials or dict(_TEMP)}
    return sts


# --------------------------------------------------------------------------- no-op


def test_no_role_arn_returns_same_object():
    settings = {"aws_access_key_id": "AKID", "aws_secret_access_key": "secret"}
    assert _resolve_aws_role_arn(settings) is settings


def test_empty_settings_returns_same_object():
    settings: dict = {}
    assert _resolve_aws_role_arn(settings) is settings


@pytest.mark.parametrize("role_key", ["aws_role_arn", "AWS_ROLE_ARN"])
@pytest.mark.parametrize("blank", ["", None])
def test_blank_role_arn_strips_alias_without_calling_sts(role_key, blank):
    """A present-but-blank role ARN (e.g. an empty UI field) must not trigger STS, and
    the empty alias must be stripped so it never leaks to LiteLLM as an unknown kwarg."""
    settings = {role_key: blank, "aws_access_key_id": "AKID"}
    with patch("boto3.client") as mock_client:
        result = _resolve_aws_role_arn(settings)

    mock_client.assert_not_called()
    assert role_key not in result
    assert result["aws_access_key_id"] == "AKID"
    # The input dict is left untouched.
    assert settings[role_key] is blank


# --------------------------------------------------------------------- STS is called


@pytest.mark.parametrize("role_key", ["aws_role_arn", "AWS_ROLE_ARN"])
def test_role_arn_either_casing_triggers_assume_role(role_key):
    sts = _mock_sts()
    with patch("boto3.client", return_value=sts):
        result = _resolve_aws_role_arn({role_key: _ROLE_ARN})

    sts.assume_role.assert_called_once_with(
        RoleArn=_ROLE_ARN, RoleSessionName="agenta-bedrock"
    )
    assert result["aws_access_key_id"] == _TEMP["AccessKeyId"]


def test_base_credentials_sign_the_sts_client():
    sts = _mock_sts()
    settings = {
        "aws_role_arn": _ROLE_ARN,
        "aws_access_key_id": "BASE_KEY",
        "aws_secret_access_key": "BASE_SECRET",
        "aws_session_token": "BASE_TOKEN",
        "aws_region_name": "ap-southeast-1",
    }
    with patch("boto3.client", return_value=sts) as mock_client:
        _resolve_aws_role_arn(settings)

    mock_client.assert_called_once_with(
        "sts",
        aws_access_key_id="BASE_KEY",
        aws_secret_access_key="BASE_SECRET",
        aws_session_token="BASE_TOKEN",
        region_name="ap-southeast-1",
    )


def test_uppercase_base_credentials_sign_the_sts_client():
    sts = _mock_sts()
    settings = {
        "aws_role_arn": _ROLE_ARN,
        "AWS_ACCESS_KEY_ID": "UC_KEY",
        "AWS_SECRET_ACCESS_KEY": "UC_SECRET",
    }
    with patch("boto3.client", return_value=sts) as mock_client:
        _resolve_aws_role_arn(settings)

    mock_client.assert_called_once_with(
        "sts",
        aws_access_key_id="UC_KEY",
        aws_secret_access_key="UC_SECRET",
        aws_session_token=None,
        region_name="us-east-1",
    )


# ------------------------------------------------------------------ region resolution


def test_region_defaults_to_us_east_1():
    sts = _mock_sts()
    with patch("boto3.client", return_value=sts) as mock_client:
        _resolve_aws_role_arn({"aws_role_arn": _ROLE_ARN})

    assert mock_client.call_args.kwargs["region_name"] == "us-east-1"


@pytest.mark.parametrize(
    "region_key",
    ["aws_region_name", "aws_region", "AWS_REGION", "aws_default_region"],
)
def test_region_resolved_from_alias(region_key):
    sts = _mock_sts()
    with patch("boto3.client", return_value=sts) as mock_client:
        _resolve_aws_role_arn({"aws_role_arn": _ROLE_ARN, region_key: "eu-west-1"})

    assert mock_client.call_args.kwargs["region_name"] == "eu-west-1"


# ---------------------------------------------------------------------- result shape


def test_temp_credentials_replace_static_keys_and_role_arn_dropped():
    sts = _mock_sts()
    settings = {
        "aws_role_arn": _ROLE_ARN,
        "AWS_ROLE_ARN": _ROLE_ARN,
        "aws_access_key_id": "OLD_KEY",
        "AWS_SECRET_ACCESS_KEY": "OLD_SECRET",
        "aws_session_token": "OLD_TOKEN",
    }
    with patch("boto3.client", return_value=sts):
        result = _resolve_aws_role_arn(settings)

    assert result["aws_access_key_id"] == _TEMP["AccessKeyId"]
    assert result["aws_secret_access_key"] == _TEMP["SecretAccessKey"]
    assert result["aws_session_token"] == _TEMP["SessionToken"]
    for dropped in ("aws_role_arn", "AWS_ROLE_ARN", "AWS_SECRET_ACCESS_KEY"):
        assert dropped not in result


def test_input_dict_not_mutated():
    sts = _mock_sts()
    settings = {"aws_role_arn": _ROLE_ARN, "aws_access_key_id": "OLD_KEY"}
    snapshot = dict(settings)
    with patch("boto3.client", return_value=sts):
        _resolve_aws_role_arn(settings)

    assert settings == snapshot


def test_missing_boto3_raises_clear_error():
    settings = {"aws_role_arn": _ROLE_ARN}
    with patch.dict("sys.modules", {"boto3": None}):
        with pytest.raises(ImportError, match="boto3 is required"):
            _resolve_aws_role_arn(settings)


# --------------------------------------------------- composition with normalization


def test_resolved_then_normalized_yields_only_canonical_kwargs():
    sts = _mock_sts()
    settings = {
        "aws_role_arn": _ROLE_ARN,
        "AWS_ACCESS_KEY_ID": "BASE_KEY",
        "AWS_SECRET_ACCESS_KEY": "BASE_SECRET",
        "aws_region": "eu-central-1",
        "model": "bedrock/anthropic.claude-3",
    }
    with patch("boto3.client", return_value=sts):
        normalized = _normalize_aws_provider_settings(_resolve_aws_role_arn(settings))

    assert normalized == {
        "aws_access_key_id": _TEMP["AccessKeyId"],
        "aws_secret_access_key": _TEMP["SecretAccessKey"],
        "aws_session_token": _TEMP["SessionToken"],
        "aws_region_name": "eu-central-1",
        "model": "bedrock/anthropic.claude-3",
    }
    assert "aws_role_arn" not in normalized
