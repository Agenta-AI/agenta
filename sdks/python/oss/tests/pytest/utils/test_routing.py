"""
Unit tests for sdk/agenta/sdk/decorators/routing.py

Covers:
1. _validate_path  — reserved segment detection
2. route isolation — each @route() mounts an independent sub-app
3. router= param   — issues DeprecationWarning, falls back to prefixed registration
"""

import warnings

import pytest
from fastapi import FastAPI, APIRouter
from starlette.routing import Mount

from agenta.sdk.decorators.routing import (
    _RESERVED_PATHS,
    _validate_path,
    create_app,
    route,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mounts(app: FastAPI) -> dict:
    """Return {path: Mount} for all Starlette Mount objects on *app*."""
    return {r.path: r for r in app.router.routes if isinstance(r, Mount)}


def _mount_paths(app: FastAPI) -> list:
    """Return ordered list of Mount paths on *app*."""
    return [r.path for r in app.router.routes if isinstance(r, Mount)]


# ---------------------------------------------------------------------------
# 1. _validate_path
# ---------------------------------------------------------------------------


class TestValidatePath:
    def test_root_is_valid(self):
        _validate_path("/")

    def test_simple_slug_is_valid(self):
        _validate_path("/summarize")

    def test_nested_slug_is_valid(self):
        _validate_path("/api/v1/summarize")

    @pytest.mark.parametrize("reserved", sorted(_RESERVED_PATHS))
    def test_reserved_segment_raises(self, reserved):
        with pytest.raises(ValueError, match=reserved):
            _validate_path(f"/{reserved}")

    def test_reserved_segment_nested_raises(self):
        with pytest.raises(ValueError, match="invoke"):
            _validate_path("/api/invoke")

    def test_route_constructor_validates_path(self):
        """route() itself must raise at construction time, not at call time."""
        with pytest.raises(ValueError):
            route("/invoke")


# ---------------------------------------------------------------------------
# 2. Route isolation — sub-apps are separate objects
# ---------------------------------------------------------------------------


class TestRouteIsolation:
    def test_two_routes_produce_two_distinct_sub_apps(self):
        app = create_app()

        @route("/summarize", app=app)
        async def summarize():
            return "hello"

        @route("/embed", app=app)
        async def embed():
            return [1.0]

        mounts = _mounts(app)
        assert "/summarize" in mounts
        assert "/embed" in mounts
        assert mounts["/summarize"].app is not mounts["/embed"].app

    def test_sub_app_has_invoke_and_inspect_routes(self):
        app = create_app()

        @route("/qa", app=app)
        async def qa():
            return "answer"

        sub = _mounts(app)["/qa"].app
        schema = sub.openapi()
        assert "/invoke" in schema["paths"]
        assert "/inspect" in schema["paths"]

    def test_sub_app_does_not_contain_sibling_routes(self):
        app = create_app()

        @route("/a", app=app)
        async def handler_a():
            return "a"

        @route("/b", app=app)
        async def handler_b():
            return "b"

        schema_a = _mounts(app)["/a"].app.openapi()
        assert "/b/invoke" not in schema_a["paths"]
        assert "/b/inspect" not in schema_a["paths"]

    def test_parent_app_has_no_invoke_routes_of_its_own(self):
        """The mount_root must not have /invoke or /inspect registered on itself."""
        app = create_app()

        @route("/foo", app=app)
        async def foo():
            return "foo"

        parent_schema = app.openapi()
        assert "/foo/invoke" not in parent_schema.get("paths", {})


# ---------------------------------------------------------------------------
# 3. router= deprecation warning
# ---------------------------------------------------------------------------


class TestRouterDeprecation:
    def test_router_param_issues_deprecation_warning(self):
        router = APIRouter()

        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")

            @route("/dep", router=router)
            async def dep():
                return "dep"

        assert any(issubclass(w.category, DeprecationWarning) for w in caught)
        messages = [str(w.message) for w in caught]
        assert any("router=" in m for m in messages)

    def test_router_fallback_registers_prefixed_routes(self):
        """With router=, routes go directly on the APIRouter (no sub-app)."""
        router = APIRouter()

        with warnings.catch_warnings(record=True):
            warnings.simplefilter("always")

            @route("/legacy", router=router)
            async def legacy():
                return "legacy"

        route_paths = [r.path for r in router.routes]
        assert "/legacy/invoke" in route_paths
        assert "/legacy/inspect" in route_paths

    def test_router_fallback_does_not_mount_sub_app_on_default_app(self):
        """router= must NOT create a mount on default_app."""
        from agenta.sdk.decorators.routing import default_app

        mounts_before = set(_mount_paths(default_app))

        router = APIRouter()
        with warnings.catch_warnings(record=True):
            warnings.simplefilter("always")

            @route("/noisy", router=router)
            async def noisy():
                return "noisy"

        mounts_after = set(_mount_paths(default_app))
        # No new mounts should have appeared on default_app
        assert mounts_after == mounts_before
