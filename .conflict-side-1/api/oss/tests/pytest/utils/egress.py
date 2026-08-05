"""Secure-by-default egress pin for tests.

`_WEBHOOK_ALLOW_INSECURE` resolves `env.agenta.webhooks.allow_insecure` once at import time,
so a shell that exported AGENTA_INSECURE_EGRESS_ALLOWED (a loaded dev env file) disables the
SSRF guard for the whole test process. Pin it secure-by-default; tests that assert the
env-var resolution itself opt out with the `allow_insecure_env` marker.
"""

import pytest


@pytest.fixture(autouse=True)
def secure_egress_by_default(request, monkeypatch):
    if request.node.get_closest_marker("allow_insecure_env"):
        return
    from oss.src.core.webhooks import utils as webhook_utils

    monkeypatch.setattr(webhook_utils, "_WEBHOOK_ALLOW_INSECURE", False, raising=False)
