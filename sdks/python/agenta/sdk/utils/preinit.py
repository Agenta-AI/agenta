from typing import Any, Optional


class PreInitObject:
    """Dummy object that raises an error when accessed a class before agenta.init() is called."""

    def __init__(self, name: str, destination: Optional[Any] = None) -> None:
        self._name = name

        if destination is not None:
            self.__doc__ = destination.__doc__

    def __getitem__(self, key: str) -> None:
        raise RuntimeError(
            f"You must call agenta.init() before accessing {self._name}[{key!r}]"
        )

    def __setitem__(self, key: str, value: Any) -> Any:
        raise RuntimeError(
            f"You must call agenta.init() before setting {self._name}[{key!r}]"
        )

    def __setattr__(self, key: str, value: Any) -> Any:
        if not key.startswith("_"):
            raise RuntimeError(
                f"You must call agenta.init() before {self._name}[{key!r}]"
            )
        else:
            return object.__setattr__(self, key, value)

    def __getattr__(self, key: str) -> Any:
        if not key.startswith("_"):
            raise RuntimeError(f"You must call agenta.init() before {self._name}.{key}")
        else:
            raise AttributeError
