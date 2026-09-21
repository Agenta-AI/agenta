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

# The gateway transport opt-in is read from the environment at call time, so pinning it means
# removing the variable rather than patching a module constant. `test.sh` sources the
# deployment's env file with `set -a`, so a stack that enabled the flag would otherwise switch
# off the HTTPS default for every test in the process.
_INSECURE_ENV_VARS = ("AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED",)


@pytest.fixture(autouse=True)
def _secure_egress_by_default(request, monkeypatch):
    if request.node.get_closest_marker("allow_insecure_env"):
        return
    from importlib import import_module

    for module_name, attr in _EGRESS_FLAGS:
        monkeypatch.setattr(import_module(module_name), attr, False, raising=False)
    for name in _INSECURE_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
