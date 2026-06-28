"""Unit tests for session_id shape validation (SEC-8)."""

import pytest
from fastapi import HTTPException

from oss.src.apis.fastapi.sessions.router import _validate_session_id_http as _validate_session_id


class TestSessionIdValidation:
    def test_valid_uuid(self):
        _validate_session_id("550e8400-e29b-41d4-a716-446655440000")

    def test_valid_slug(self):
        _validate_session_id("my-session_01")

    def test_valid_dotted(self):
        _validate_session_id("project.session.123")

    def test_empty_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_session_id("")
        assert exc_info.value.status_code == 400

    def test_slash_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_session_id("foo/bar")
        assert exc_info.value.status_code == 400

    def test_space_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_session_id("foo bar")
        assert exc_info.value.status_code == 400

    def test_too_long_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_session_id("a" * 257)
        assert exc_info.value.status_code == 400

    def test_max_length_accepted(self):
        _validate_session_id("a" * 256)
