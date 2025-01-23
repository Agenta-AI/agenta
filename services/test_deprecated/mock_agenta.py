"""Mock agenta module for testing"""

from typing import Any, Dict, Type, TypeVar, Optional
from dataclasses import dataclass

T = TypeVar("T")


@dataclass
class ConfigManager:
    """Mock ConfigManager"""

    @staticmethod
    def get_from_route(schema: Type[T]) -> T:
        return schema()


def route(path: str = "", config_schema: Optional[Type[Any]] = None):
    """Mock route decorator"""

    def decorator(func):
        return func

    return decorator


def instrument():
    """Mock instrument decorator"""

    def decorator(func):
        return func

    return decorator
