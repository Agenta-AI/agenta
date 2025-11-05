from typing import Any, Callable
from uuid import UUID, RFC_4122

from fastapi.types import DecoratedCallable
from fastapi import APIRouter as FastAPIRouter

from oss.src.utils.env import env


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


def is_ee():
    return env.AGENTA_LICENSE == "ee"


def is_oss():
    return env.AGENTA_LICENSE == "oss"


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
