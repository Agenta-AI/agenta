# Stdlib Imports
from typing import Any, Callable


class BaseDecorator:
    def __init__(self):
        pass

    def __call__(self, func: Callable[..., Any]) -> Callable[..., Any]:
        raise NotImplementedError
