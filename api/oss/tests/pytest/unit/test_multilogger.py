"""MultiLogger must expose `exception`, like the stdlib logger.

The application logger returned by `get_module_logger` is a `MultiLogger`. It used to define
every level method except `exception`, so `log.exception(...)` -- the natural call inside an
`except` block -- raised AttributeError from inside the handler and took the caller down. The
execution watchdog died exactly this way. These tests hold the contract that closed that gap:
the method exists, it does not raise when called from an `except` block, and it forwards to
the wrapped logger's `error` with the active traceback.
"""

from oss.src.utils.logging import MultiLogger, get_module_logger


class _Spy:
    """A stand-in wrapped logger that records the `error` calls MultiLogger forwards to it."""

    def __init__(self):
        self.calls = []

    def error(self, *args, **kwargs):
        self.calls.append((args, kwargs))


def test_multilogger_has_an_exception_method():
    assert hasattr(MultiLogger(), "exception")


def test_real_module_logger_exposes_exception():
    log = get_module_logger(__name__)
    assert hasattr(log, "exception")


def test_exception_from_an_except_block_does_not_raise_and_logs_with_traceback():
    spy = _Spy()
    log = MultiLogger(spy)

    try:
        raise RuntimeError("boom")
    except RuntimeError:
        # Before the fix this raised AttributeError instead of logging.
        log.exception("something failed")

    assert spy.calls, "exception() must forward to the wrapped logger's error()"
    args, kwargs = spy.calls[0]
    assert args[0] == "something failed"
    assert kwargs.get("exc_info") is True
