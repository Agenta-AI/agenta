"""Gives the telemetry code an install with no license key.

The `ee` code is in every image, so the telemetry code always asks the EE license
service for the key in force. This stub answers "no key", so a test never reaches the
real license service. A test that needs a key installs its own stub after this one.
"""

import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

LICENSE_SERVICE = "ee.src.core.licenses.service"


def without_license_key(monkeypatch) -> None:
    monkeypatch.setitem(
        sys.modules,
        LICENSE_SERVICE,
        SimpleNamespace(active_license=AsyncMock(return_value=None)),
    )
