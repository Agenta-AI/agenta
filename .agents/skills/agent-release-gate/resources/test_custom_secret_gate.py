from __future__ import annotations


from path_triggers import mandatory_cells


def test_custom_secret_paths_require_the_live_cell():
    for path in (
        "api/oss/src/core/secrets/services.py",
        "api/oss/src/apis/fastapi/workflows/router.py",
        "sdks/python/agenta/sdk/agents/sandbox_credentials.py",
        "services/runner/src/engines/sandbox_agent/sandbox-credentials.ts",
        "services/runner/src/redaction.ts",
    ):
        assert "matrix_s1_custom_secrets.py" in mandatory_cells([path])
