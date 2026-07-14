# Root conftest for SDK tests.
# Intentionally minimal — e2e fixtures are scoped to tests/pytest/acceptance/.
# Unit tests must not require environment variables or running services.

import pytest

# Egress guards resolve their flag once at import time, so a shell that exported
# AGENTA_INSECURE_EGRESS_ALLOWED (a loaded dev env file) disables them for the whole test
# process. Pin both secure-by-default; the `allow_insecure_env` marker opts out for the
# tests that assert the env-var resolution itself.
_EGRESS_FLAGS = (
    ("agenta.sdk.utils.net", "_ALLOW_INSECURE"),
    ("agenta.sdk.engines.running.handlers", "_HOOK_ALLOW_INSECURE"),
)


@pytest.fixture(autouse=True)
def _secure_egress_by_default(request, monkeypatch):
    if request.node.get_closest_marker("allow_insecure_env"):
        return
    from importlib import import_module

    for module_name, attr in _EGRESS_FLAGS:
        monkeypatch.setattr(import_module(module_name), attr, False, raising=False)
