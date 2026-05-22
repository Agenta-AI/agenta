"""Unit tests for ``_resolve_aws_credentials`` in handlers.py.

Covers:
- no role ARN → settings returned unchanged;
- lowercase ``aws_role_arn`` triggers STS assume_role;
- uppercase ``AWS_ROLE_ARN`` triggers STS assume_role;
- role ARN keys removed from result;
- uppercase AWS_* credential keys removed from result;
- session token injected from STS response;
- region defaults to us-east-1 when not supplied;
- region resolved from aws_region_name / aws_region / AWS_REGION;
- base credentials forwarded to STS client constructor.
"""

from unittest.mock import MagicMock, patch

import pytest

from agenta.sdk.engines.running.handlers import _resolve_aws_credentials

_ROLE_ARN = "arn:aws:iam::123456789012:role/my-role"
_TEMP_ACCESS = "ASIATEMP"
_TEMP_SECRET = "SECRETTEMP"
_TEMP_TOKEN = "TOKENTEMP"


def _mock_sts(
    access_key=_TEMP_ACCESS,
    secret=_TEMP_SECRET,
    token=_TEMP_TOKEN,
) -> MagicMock:
    sts = MagicMock()
    sts.assume_role.return_value = {
        "Credentials": {
            "AccessKeyId": access_key,
            "SecretAccessKey": secret,
            "SessionToken": token,
        }
    }
    return sts


# ---------------------------------------------------------------------------
# No-op path
# ---------------------------------------------------------------------------


def test_no_role_arn_returns_unchanged():
    settings = {"aws_access_key_id": "AKID", "aws_secret_access_key": "SECRET"}
    result = _resolve_aws_credentials(settings)
    assert result is settings


def test_empty_dict_returns_unchanged():
    settings = {}
    result = _resolve_aws_credentials(settings)
    assert result is settings


# ---------------------------------------------------------------------------
# STS is called
# ---------------------------------------------------------------------------


def test_lowercase_role_arn_triggers_sts():
    sts = _mock_sts()
    settings = {"aws_role_arn": _ROLE_ARN}

    with patch("boto3.client", return_value=sts) as mock_client:
        result = _resolve_aws_credentials(settings)

    mock_client.assert_called_once_with(
        "sts",
        aws_access_key_id=None,
        aws_secret_access_key=None,
        region_name="us-east-1",
    )
    sts.assume_role.assert_called_once_with(
        RoleArn=_ROLE_ARN, RoleSessionName="agenta-bedrock"
    )
    assert result["aws_access_key_id"] == _TEMP_ACCESS


def test_uppercase_role_arn_triggers_sts():
    sts = _mock_sts()
    settings = {"AWS_ROLE_ARN": _ROLE_ARN}

    with patch("boto3.client", return_value=sts):
        result = _resolve_aws_credentials(settings)

    sts.assume_role.assert_called_once_with(
        RoleArn=_ROLE_ARN, RoleSessionName="agenta-bedrock"
    )
    assert result["aws_access_key_id"] == _TEMP_ACCESS


# ---------------------------------------------------------------------------
# Result shape
# ---------------------------------------------------------------------------


def test_role_arn_keys_removed_from_result():
    sts = _mock_sts()
    settings = {
        "aws_role_arn": _ROLE_ARN,
        "AWS_ROLE_ARN": _ROLE_ARN,
        "aws_access_key_id": "AKID",
    }

    with patch("boto3.client", return_value=sts):
        result = _resolve_aws_credentials(settings)

    assert "aws_role_arn" not in result
    assert "AWS_ROLE_ARN" not in result


def test_uppercase_credential_keys_removed_from_result():
    sts = _mock_sts()
    settings = {
        "aws_role_arn": _ROLE_ARN,
        "AWS_ACCESS_KEY_ID": "AKID",
        "AWS_SECRET_ACCESS_KEY": "SECRET",
        "AWS_SESSION_TOKEN": "OLD_TOKEN",
    }

    with patch("boto3.client", return_value=sts):
        result = _resolve_aws_credentials(settings)

    assert "AWS_ACCESS_KEY_ID" not in result
    assert "AWS_SECRET_ACCESS_KEY" not in result
    assert "AWS_SESSION_TOKEN" not in result


def test_session_token_injected():
    sts = _mock_sts(token="FRESH_TOKEN")
    settings = {"aws_role_arn": _ROLE_ARN}

    with patch("boto3.client", return_value=sts):
        result = _resolve_aws_credentials(settings)

    assert result["aws_session_token"] == "FRESH_TOKEN"


def test_lowercase_creds_replaced_with_temp():
    sts = _mock_sts()
    settings = {
        "aws_role_arn": _ROLE_ARN,
        "aws_access_key_id": "ORIGINAL_KEY",
        "aws_secret_access_key": "ORIGINAL_SECRET",
    }

    with patch("boto3.client", return_value=sts):
        result = _resolve_aws_credentials(settings)

    assert result["aws_access_key_id"] == _TEMP_ACCESS
    assert result["aws_secret_access_key"] == _TEMP_SECRET


# ---------------------------------------------------------------------------
# Region resolution
# ---------------------------------------------------------------------------


def test_region_defaults_to_us_east_1():
    sts = _mock_sts()
    settings = {"aws_role_arn": _ROLE_ARN}

    with patch("boto3.client", return_value=sts) as mock_client:
        _resolve_aws_credentials(settings)

    _, kwargs = mock_client.call_args
    assert kwargs["region_name"] == "us-east-1"


@pytest.mark.parametrize(
    "key",
    ["aws_region_name", "aws_region", "AWS_REGION"],
)
def test_region_resolved_from_setting(key):
    sts = _mock_sts()
    settings = {"aws_role_arn": _ROLE_ARN, key: "eu-west-1"}

    with patch("boto3.client", return_value=sts) as mock_client:
        _resolve_aws_credentials(settings)

    _, kwargs = mock_client.call_args
    assert kwargs["region_name"] == "eu-west-1"


# ---------------------------------------------------------------------------
# Base credentials forwarded to STS
# ---------------------------------------------------------------------------


def test_base_credentials_forwarded_to_sts():
    sts = _mock_sts()
    settings = {
        "aws_role_arn": _ROLE_ARN,
        "aws_access_key_id": "BASE_KEY",
        "aws_secret_access_key": "BASE_SECRET",
        "aws_region_name": "ap-southeast-1",
    }

    with patch("boto3.client", return_value=sts) as mock_client:
        _resolve_aws_credentials(settings)

    mock_client.assert_called_once_with(
        "sts",
        aws_access_key_id="BASE_KEY",
        aws_secret_access_key="BASE_SECRET",
        region_name="ap-southeast-1",
    )


def test_uppercase_base_credentials_forwarded_to_sts():
    sts = _mock_sts()
    settings = {
        "aws_role_arn": _ROLE_ARN,
        "AWS_ACCESS_KEY_ID": "UC_KEY",
        "AWS_SECRET_ACCESS_KEY": "UC_SECRET",
    }

    with patch("boto3.client", return_value=sts) as mock_client:
        _resolve_aws_credentials(settings)

    mock_client.assert_called_once_with(
        "sts",
        aws_access_key_id="UC_KEY",
        aws_secret_access_key="UC_SECRET",
        region_name="us-east-1",
    )


# ---------------------------------------------------------------------------
# Original dict is not mutated
# ---------------------------------------------------------------------------


def test_original_dict_not_mutated():
    sts = _mock_sts()
    settings = {"aws_role_arn": _ROLE_ARN, "aws_access_key_id": "ORIG"}
    original = dict(settings)

    with patch("boto3.client", return_value=sts):
        _resolve_aws_credentials(settings)

    assert settings == original
