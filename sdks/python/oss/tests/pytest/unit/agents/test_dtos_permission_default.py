"""PY-B4: an unrecognized ``runner.permissions.default`` must fail loud, not coerce to a
more-permissive mode."""

from __future__ import annotations

import pytest

from agenta.sdk.agents import AgentTemplate
from agenta.sdk.agents.dtos import InvalidPermissionDefaultError


def test_unknown_permission_default_raises() -> None:
    params = {"agent": {"runner": {"permissions": {"default": "deney"}}}}
    with pytest.raises(InvalidPermissionDefaultError) as excinfo:
        AgentTemplate.from_params(params)
    assert "deney" in str(excinfo.value)
    assert "allow_reads" in str(excinfo.value)


def test_known_permission_default_still_works() -> None:
    params = {"agent": {"runner": {"permissions": {"default": "DENY"}}}}
    template = AgentTemplate.from_params(params)
    assert template.permission_default == "deny"
