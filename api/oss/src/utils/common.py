from importlib.util import find_spec
from typing import Any, Callable
from uuid import UUID, RFC_4122

from fastapi.types import DecoratedCallable
from fastapi import APIRouter as FastAPIRouter


class APIRouter(FastAPIRouter):
    """
    Extends the FastAPIRouter class to provide support for alternate paths ending with a forward slash.

    Methods:
    - api_route: Adds a route to the router with both the original path and an alternate path ending with a forward slash.
    """

    def api_route(
        self, path: str, *, include_in_schema: bool = True, **kwargs: Any
    ) -> Callable[[DecoratedCallable], DecoratedCallable]:
        """
        Decorator method that adds a route to the router with both the original path and an alternate path ending with a forward slash.

        Parameters:
        - path (str): The original path for the route.
        - include_in_schema (bool): Whether to include the route in the generated OpenAPI schema. Default is True.
        - **kwargs (Any): Additional keyword arguments to pass to the underlying api_route method.

        Returns:
        - decorator (Callable[[DecoratedCallable], DecoratedCallable]): A decorator function that can be used to decorate a route function.
        """
        if path.endswith("/"):
            path = path[:-1]

        add_path = super().api_route(
            path, include_in_schema=include_in_schema, **kwargs
        )

        alternate_path = path + "/"
        add_alternate_path = super().api_route(
            alternate_path, include_in_schema=False, **kwargs
        )

        def decorator(func: DecoratedCallable) -> DecoratedCallable:
            add_alternate_path(func)
            return add_path(func)

        return decorator


_EE_CODE_PRESENT = find_spec("ee") is not None


def is_ee() -> bool:
    """True when the `ee` code is present in this image, which every shipped API image
    has. It does not mean the install has an enterprise plan: the license key decides
    the plan. `AGENTA_LICENSE` does not change it."""
    return _EE_CODE_PRESENT


def is_oss() -> bool:
    """True when the `ee` code is absent. The opposite of `is_ee()`."""
    return not _EE_CODE_PRESENT


def is_cloud() -> bool:
    """True on Agenta cloud only (a cloud license key). Every other install is
    self-hosted, whatever its plan."""
    if not is_ee():
        return False
    from ee.src.core.licenses.cloud import is_cloud as _is_cloud  # noqa: PLC0415

    return _is_cloud()


def is_uuid7(s: str, *, require_canonical: bool = False) -> bool:
    try:
        u = UUID(s)  # parses hyphenated, braced, or 32-hex forms
    except (ValueError, TypeError, AttributeError):
        return False

    if u.version != 7 or u.variant != RFC_4122:
        return False

    if require_canonical and str(u) != s.lower():
        return False

    return True
