import os

import pytest


def skip_if_mount_storage_unavailable(response):
    if response.status_code != 503:
        return

    if os.getenv("AGENTA_TEST_REQUIRE_MOUNT_STORAGE", "").lower() == "true":
        pytest.fail(f"Mount storage is required but unavailable: {response.text}")

    pytest.skip("Mount storage backend not configured in this environment")
