"""Who may reach the app files, and whether a cross-origin bridge can send its headers."""

from __future__ import annotations

import importlib
from unittest.mock import patch

import pytest
from oss.src.core.access.permissions.types import Permission
from oss.src.core.apps.handlers import CREATE_APP_CALL_REF, LIST_STARTERS_CALL_REF
from oss.src.core.tools.platform_handlers import required_elevated_permission


class TestAppToolsDemandTheMountPermissions:
    """The tool path must ask for what the mount routes ask for the same act.

    RUN_TOOLS is what reaches `/tools/call`. An EE annotator holds it without EDIT_MOUNTS,
    so without the elevation it could write app files the direct write route refuses.
    """

    @pytest.mark.parametrize("arguments", [{}, {"starter": "board", "dir": "a"}])
    def test_create_app_demands_edit_mounts(self, arguments):
        assert (
            required_elevated_permission(
                call_ref=CREATE_APP_CALL_REF, arguments=arguments
            )
            == Permission.EDIT_MOUNTS
        )

    @pytest.mark.parametrize("arguments", [{}, None])
    def test_list_starters_demands_view_mounts(self, arguments):
        assert (
            required_elevated_permission(
                call_ref=LIST_STARTERS_CALL_REF, arguments=arguments
            )
            == Permission.VIEW_MOUNTS
        )


BRIDGE_HEADERS = ("X-Agenta-App-Scope", "If-Match", "If-None-Match")


def _production_cors_kwargs():
    with patch("alembic.script.ScriptDirectory.from_config", return_value=object()):
        routers = importlib.import_module("entrypoints.routers")
    from starlette.middleware.cors import CORSMiddleware

    for middleware in routers._ROUTED_APP.user_middleware:
        if middleware.cls is CORSMiddleware:
            return middleware.kwargs
    raise AssertionError("CORSMiddleware is not installed")


def test_cors_allows_the_bridge_headers():
    allowed = {h.lower() for h in _production_cors_kwargs()["allow_headers"]}
    for header in BRIDGE_HEADERS:
        assert header.lower() in allowed, header


def test_a_cross_origin_bridge_preflight_passes():
    from starlette.applications import Starlette
    from starlette.middleware.cors import CORSMiddleware
    from starlette.testclient import TestClient

    kwargs = _production_cors_kwargs()
    app = Starlette()
    app.add_middleware(CORSMiddleware, **kwargs)
    response = TestClient(app).options(
        "/api/mounts/m/files",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": ", ".join(BRIDGE_HEADERS),
        },
    )
    assert response.status_code == 200, response.text
