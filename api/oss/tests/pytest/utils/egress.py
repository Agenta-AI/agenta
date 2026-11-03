"""Secure-by-default egress pin for tests.

Two flags, one shape of problem. `_WEBHOOK_ALLOW_INSECURE` resolves
`env.agenta.webhooks.allow_insecure` once at import time, and `env.gateway_egress` resolves
AGENTA_GATEWAYS_INSECURE_EGRESS_ALLOWED the same way, so a shell that exported either one
disables that guard for the whole test process. A loaded dev env file exports both: the
self-host templates ship the gateway flag permissive on purpose, because a self-hoster's MCP
servers live on their own network.

Pin both secure-by-default, so the suite tests the guard rather than the developer's
terminal. A test that wants a guard open still says so per case, and a test that asserts the
env-var resolution itself opts out with the `allow_insecure_env` marker.
"""

import pytest


@pytest.fixture(autouse=True)
def secure_egress_by_default(request, monkeypatch):
    if request.node.get_closest_marker("allow_insecure_env"):
        return
    from oss.src.core.webhooks import utils as webhook_utils
    from oss.src.utils.env import env

    monkeypatch.setattr(webhook_utils, "_WEBHOOK_ALLOW_INSECURE", False, raising=False)
    # `env` is one shared settings object, and every gateway call site reads
    # `env.gateway_egress.insecure_allowed` at call time, so pinning the attribute here
    # reaches all of them without naming a module.
    monkeypatch.setattr(env.gateway_egress, "insecure_allowed", False, raising=False)
