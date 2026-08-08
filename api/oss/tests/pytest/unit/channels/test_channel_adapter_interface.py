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

        async def fetch_capabilities(self):
            raise NotImplementedError

        async def verify_signature(self, *, headers, body):
            raise NotImplementedError

        async def parse_event(self, *, body):
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
        "installation_hint",
        "verify_signature",
        "parse_event",
        "post_message",
        "edit_message",
        "discover_spaces",
        "fetch_history",
    }


def test_every_method_parameter_after_self_is_keyword_only():
    """Grep-based check via the AST: no positional parameter besides `self`
    in any method signature on the interface."""

    source = inspect.getsource(interface_module)
    tree = ast.parse(source)

    class_node = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef) and node.name == "ChannelAdapterInterface"
    )

    checked = 0
    for node in class_node.body:
        if not isinstance(node, ast.AsyncFunctionDef):
            continue

        checked += 1
        positional = [a.arg for a in node.args.args if a.arg != "self"]
        assert positional == [], (
            f"{node.name} has positional parameters besides self: {positional} "
            "— every method must be keyword-only after *."
        )

    assert checked == 7
