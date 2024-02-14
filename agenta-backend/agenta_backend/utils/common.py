import os
import logging
from typing import Any, Callable

from fastapi.types import DecoratedCallable
from fastapi import APIRouter as FastAPIRouter

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


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


def isCloudEE():
    return os.environ["FEATURE_FLAG"] in ["cloud", "ee"]


def isCloud():
    return os.environ["FEATURE_FLAG"] == "cloud"


def isEE():
    return os.environ["FEATURE_FLAG"] == "ee"


def isOssEE():
    return os.environ["FEATURE_FLAG"] in ["oss", "ee"]
