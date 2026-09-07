import pytest
from pydantic import ValidationError

from oss.src.utils.env import SessionsRecordsConfig


def test_session_record_retry_bounds_accept_the_minimum_values():
    config = SessionsRecordsConfig(reclaim_idle_ms=0, max_deliveries=1)

    assert config.reclaim_idle_ms == 0
    assert config.max_deliveries == 1


@pytest.mark.parametrize(
    ("field", "value"),
    [("reclaim_idle_ms", -1), ("max_deliveries", 0), ("max_deliveries", -1)],
)
def test_session_record_retry_bounds_reject_invalid_values(field, value):
    with pytest.raises(ValidationError):
        SessionsRecordsConfig(**{field: value})


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("AGENTA_RECORDS_RECLAIM_IDLE_MS", "-1"),
        ("AGENTA_RECORDS_MAX_DELIVERIES", "0"),
    ],
)
def test_session_record_retry_bounds_validate_environment_defaults(
    monkeypatch, name, value
):
    monkeypatch.setenv(name, value)

    with pytest.raises(ValidationError):
        SessionsRecordsConfig()
