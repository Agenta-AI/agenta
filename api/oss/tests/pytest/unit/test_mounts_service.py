"""Unit tests for MountsService immutability rules and path validation."""

import hashlib
import base64
import pytest

from oss.src.core.mounts.service import validate_bucket, validate_prefix
from oss.src.core.mounts.types import MountDataInvalid


# ---------------------------------------------------------------------------
# Path segment validation
# ---------------------------------------------------------------------------


class TestMountPathValidation:
    def test_valid_bucket_simple(self):
        validate_bucket("my-bucket")

    def test_valid_bucket_with_spaces(self):
        validate_bucket("my bucket")

    def test_valid_prefix_single_segment(self):
        validate_prefix("workspace")

    def test_valid_prefix_multi_segment(self):
        validate_prefix("workspaces/session-1/files")

    def test_valid_prefix_with_underscores(self):
        validate_prefix("my_project/agent_workspace")

    def test_rejects_dotdot_traversal(self):
        with pytest.raises(MountDataInvalid):
            validate_prefix("../etc/passwd")

    def test_rejects_absolute_path(self):
        with pytest.raises(MountDataInvalid):
            validate_prefix("/absolute/path")

    def test_rejects_dotdot_segment_in_middle(self):
        with pytest.raises(MountDataInvalid):
            validate_prefix("safe/../../../etc")

    def test_rejects_special_chars_in_bucket(self):
        with pytest.raises(MountDataInvalid):
            validate_bucket("my;bucket")

    def test_rejects_angle_brackets(self):
        with pytest.raises(MountDataInvalid):
            validate_prefix("path/<injection>")

    def test_empty_segment_in_prefix_is_skipped(self):
        # trailing slash produces empty segment — allowed (strip empty)
        validate_prefix("workspace/files/")

    def test_valid_hashed_id_segment(self):
        # Simulates a hashed session_id used as a path segment
        raw = "ext-session-abc123"
        digest = hashlib.sha256(raw.encode()).digest()
        hashed = base64.b32encode(digest[:10]).decode().lower().rstrip("=")
        validate_prefix(f"sessions/{hashed}/cwd")
