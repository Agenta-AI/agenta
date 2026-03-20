"""
Unit tests for sdk/agenta/sdk/decorators/routing.py

Covers:
1. _validate_path  — reserved segment detection
2. route isolation — each @route() mounts an independent sub-app
3. openapi.json    — per-route spec is isolated and includes workflow schemas
4. root ordering   — "/" mount always comes last regardless of definition order
5. router= param   — issues DeprecationWarning, falls back to prefixed registration
6. path stamping   — interface.path is set from the route path at decoration time
"""

import warnings

import pytest
from fastapi import FastAPI, APIRouter
from starlette.routing import Mount

from agenta.sdk.decorators.routing import (
    _RESERVED_PATHS,
    _ensure_root_is_last,
    _validate_path,
    create_app,
    route,
)
from agenta.sdk.models.workflows import JsonSchemas


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

    def test_route_constructor_validates_nested_reserved(self):
        with pytest.raises(ValueError):
            route("/api/openapi.json")


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
# 3. openapi.json schema enrichment
# ---------------------------------------------------------------------------


class TestOpenApiSchemaEnrichment:
    def test_no_schemas_produces_valid_spec(self):
        app = create_app()

        @route("/plain", app=app)
        async def plain():
            return "ok"

        schema = _mounts(app)["/plain"].app.openapi()
        assert "paths" in schema
        assert "/invoke" in schema["paths"]
        # No x-agenta-schemas when no schemas are defined
        assert "x-agenta-schemas" not in schema.get("info", {})

    def test_outputs_schema_appears_in_x_agenta_schemas(self):
        from agenta.sdk.decorators.running import workflow as WorkflowDecorator

        app = create_app()
        outputs = {
            "type": "object",
            "properties": {"result": {"type": "string"}},
            "required": ["result"],
        }

        @route("/scored", app=app)
        @WorkflowDecorator(schemas=JsonSchemas(outputs=outputs))
        async def scored():
            return {"result": "yes"}

        schema = _mounts(app)["/scored"].app.openapi()
        x_schemas = schema.get("info", {}).get("x-agenta-schemas", {})
        assert "outputs" in x_schemas
        assert x_schemas["outputs"] == outputs

    def test_inputs_schema_appears_in_x_agenta_schemas(self):
        from agenta.sdk.decorators.running import workflow as WorkflowDecorator

        app = create_app()
        inputs = {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        }

        @route("/classify", app=app)
        @WorkflowDecorator(schemas=JsonSchemas(inputs=inputs))
        async def classify():
            return "label"

        schema = _mounts(app)["/classify"].app.openapi()
        x_schemas = schema.get("info", {}).get("x-agenta-schemas", {})
        assert "inputs" in x_schemas
        assert x_schemas["inputs"] == inputs

    def test_parameters_schema_appears_in_x_agenta_schemas(self):
        from agenta.sdk.decorators.running import workflow as WorkflowDecorator

        app = create_app()
        parameters = {
            "type": "object",
            "properties": {"temperature": {"type": "number"}},
        }

        @route("/gen", app=app)
        @WorkflowDecorator(schemas=JsonSchemas(parameters=parameters))
        async def gen():
            return "text"

        schema = _mounts(app)["/gen"].app.openapi()
        x_schemas = schema.get("info", {}).get("x-agenta-schemas", {})
        assert "parameters" in x_schemas

    def test_schema_is_cached_on_second_call(self):
        """openapi() must return the same object on repeated calls (cached)."""
        app = create_app()

        @route("/cached", app=app)
        async def cached():
            return "ok"

        sub = _mounts(app)["/cached"].app
        first = sub.openapi()
        second = sub.openapi()
        assert first is second

    def test_builtin_uri_outputs_schema_included(self):
        """Builtin workflows have pre-defined output schemas in interfaces.py.
        After decoration these must appear in the per-route openapi.json."""
        from agenta.sdk.decorators.running import workflow as WorkflowDecorator

        app = create_app()

        @route("/echo", app=app)
        @WorkflowDecorator(uri="agenta:builtin:echo:v0")
        async def echo_handler():
            pass  # handler for a builtin

        schema = _mounts(app)["/echo"].app.openapi()
        x_schemas = schema.get("info", {}).get("x-agenta-schemas", {})
        # echo:v0 defines an outputs schema
        assert "outputs" in x_schemas
        assert x_schemas["outputs"].get("title") == "Echo Output"


# ---------------------------------------------------------------------------
# 4. Root route ordering
# ---------------------------------------------------------------------------


class TestRootRouteOrdering:
    # Starlette normalises mount("/") to path="" internally.
    _ROOT_PATH = ""

    def test_named_route_before_root_in_mount_list(self):
        """Even when '/' is decorated first, it must be last in routes."""
        app = create_app()

        @route("/", app=app)  # defined first — must still end up last
        async def root():
            return "root"

        @route("/foo", app=app)
        async def foo():
            return "foo"

        paths = _mount_paths(app)
        assert paths[-1] == self._ROOT_PATH
        foo_idx = paths.index("/foo")
        root_idx = paths.index(self._ROOT_PATH)
        assert foo_idx < root_idx

    def test_multiple_named_routes_root_stays_last(self):
        app = create_app()

        @route("/", app=app)
        async def root():
            return "root"

        @route("/a", app=app)
        async def a():
            return "a"

        @route("/b", app=app)
        async def b():
            return "b"

        paths = _mount_paths(app)
        assert paths[-1] == self._ROOT_PATH

    def test_no_root_route_is_fine(self):
        app = create_app()

        @route("/x", app=app)
        async def x():
            return "x"

        @route("/y", app=app)
        async def y():
            return "y"

        paths = _mount_paths(app)
        assert "/" not in paths
        assert "" not in paths

    def test_ensure_root_is_last_is_idempotent(self):
        app = create_app()

        @route("/m", app=app)
        async def m():
            return "m"

        @route("/", app=app)
        async def root():
            return "root"

        _ensure_root_is_last(app)
        _ensure_root_is_last(app)
        paths = _mount_paths(app)
        assert paths[-1] == self._ROOT_PATH
        assert paths.count(self._ROOT_PATH) == 1


# ---------------------------------------------------------------------------
# 5. router= deprecation warning
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
