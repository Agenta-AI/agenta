"""Sets the edition the telemetry code sees, without `env.agenta.license`.

The code reads `is_ee()`. Before one image it follows `AGENTA_LICENSE`; after it, it
means the `ee` code is present. Patching it where the telemetry code imported it works
in both, and keeps an OSS test from reaching the real EE license service.
"""

from oss.src.core.auth.supertokens import overrides
from oss.src.core.instances import service as instances_service
from oss.src.core.telemetry import service as telemetry_service


def set_edition(monkeypatch, edition: str) -> None:
    ee = edition == "ee"
    for module in (instances_service, telemetry_service, overrides):
        if hasattr(module, "is_ee"):
            monkeypatch.setattr(module, "is_ee", lambda: ee)
