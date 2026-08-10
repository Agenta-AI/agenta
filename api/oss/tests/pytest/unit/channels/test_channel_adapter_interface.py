import ast
import inspect

import pytest

from oss.src.core.channels.adapters import interface as interface_module
from oss.src.core.channels.adapters.interface import ChannelAdapterInterface


def test_instantiating_the_interface_directly_raises_type_error():
    with pytest.raises(TypeError):
        ChannelAdapterInterface()


def test_subclass_missing_one_method_also_raises_type_error():
    class AlmostAdapter(ChannelAdapterInterface):
        channel = "almost"

        async def fetch_capabilities(self, *, connection=None):
            raise NotImplementedError

        def connection_locator(self, *, request):
            raise NotImplementedError

        async def verify_signature(self, *, request, connection):
            raise NotImplementedError

        async def parse_event(self, *, body, connection=None):
            raise NotImplementedError

        async def post_message(self, *, connection, locator, content, idempotency_key):
            raise NotImplementedError

        async def edit_message(
            self, *, connection, external_locator, content, idempotency_key
        ):
            raise NotImplementedError

        async def discover_spaces(self, *, connection):
            raise NotImplementedError

        # fetch_history intentionally omitted

    with pytest.raises(TypeError):
        AlmostAdapter()


def test_every_method_is_abstract():
    assert set(ChannelAdapterInterface.__abstractmethods__) == {
        "fetch_capabilities",
        "connection_locator",
        "verify_signature",
        "parse_event",
        "post_message",
        "edit_message",
        "discover_spaces",
        "fetch_history",
    }


def _methods(class_node: ast.ClassDef):
    """Every method, sync or async — the guard this file exists to keep
    honest: a check that only sees one kind is blind to the other."""

    return [
        node
        for node in class_node.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]


def _positional_params(node):
    return [a.arg for a in node.args.args if a.arg != "self"]


def test_every_method_parameter_after_self_is_keyword_only():
    """Grep-based check via the AST: no positional parameter besides `self`
    in any method signature on the interface, sync methods included. The
    expected count is derived from the class's own abstractmethods rather
    than a literal, so adding a method updates this check instead of
    silently evading it."""

    source = inspect.getsource(interface_module)
    tree = ast.parse(source)

    class_node = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef) and node.name == "ChannelAdapterInterface"
    )

    methods = _methods(class_node)

    for node in methods:
        positional = _positional_params(node)
        assert positional == [], (
            f"{node.name} has positional parameters besides self: {positional} "
            "— every method must be keyword-only after *."
        )

    assert len(methods) == len(ChannelAdapterInterface.__abstractmethods__)


def test_keyword_only_check_fails_on_a_sync_method_with_a_positional_parameter():
    """The guard this replaces walked only ast.AsyncFunctionDef, so a sync
    method with a positional parameter was invisible to it. Proves the fixed
    check actually catches that shape."""

    source = """
class Fake:
    def bad(self, positional):
        ...

    async def good(self, *, kw):
        ...
"""
    class_node = next(
        node for node in ast.walk(ast.parse(source)) if isinstance(node, ast.ClassDef)
    )

    violations = [
        node.name for node in _methods(class_node) if _positional_params(node)
    ]

    assert violations == ["bad"]


def test_checked_count_is_derived_from_the_method_list_not_a_literal():
    """A class with a different number of methods must produce a different
    checked count — the count this guard asserts against is never a
    hardcoded literal."""

    source = """
class Fake:
    def one(self, *, kw): ...
    async def two(self, *, kw): ...
    async def three(self, *, kw): ...
"""
    class_node = next(
        node for node in ast.walk(ast.parse(source)) if isinstance(node, ast.ClassDef)
    )

    assert len(_methods(class_node)) == 3
