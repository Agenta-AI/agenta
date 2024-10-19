from contextlib import AbstractContextManager
from traceback import format_exc
from logging import getLogger, INFO

logger = getLogger(__name__)
logger.setLevel(INFO)


class suppress(AbstractContextManager):
    def __init__(self):
        pass

    def __enter__(self):
        pass

    def __exit__(self, exc_type, exc_value, exc_tb):
        if exc_type is None:
            return
        else:
            logger.error("--- SUPPRESSING EXCEPTION ---")
            logger.error(f"{exc_type.__name__}: {exc_value}\n{format_exc()}")
            logger.error("-----------------------------")
            return
