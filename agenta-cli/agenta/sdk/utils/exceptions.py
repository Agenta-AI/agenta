from contextlib import AbstractContextManager
from traceback import format_exc
from agenta.sdk.utils.logging import log


class suppress(AbstractContextManager):
    def __init__(self):
        pass

    def __enter__(self):
        pass

    def __exit__(self, exc_type, exc_value, exc_tb):
        if exc_type is None:
            return
        else:
            log.error(f"{exc_type.__name__}: {exc_value}\n{format_exc()}")
            return
