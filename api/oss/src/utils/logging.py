import os
import re
import sys
import logging
from typing import Any, Optional

import structlog
from structlog.typing import EventDict, WrappedLogger, Processor

from oss.src.utils.env import env


TRACE_LEVEL = 1
logging.TRACE = TRACE_LEVEL
logging.addLevelName(TRACE_LEVEL, "TRACE")


def trace(self, message, *args, **kwargs):
    if self.isEnabledFor(TRACE_LEVEL):
        self._log(TRACE_LEVEL, message, args, **kwargs)


logging.Logger.trace = trace


def bound_logger_trace(self, *args, **kwargs):
    return self._proxy_to_logger("trace", *args, **kwargs)


structlog.stdlib.BoundLogger.trace = bound_logger_trace

# ENV VARS
AGENTA_LOG_CONSOLE_ENABLED = env.logging.console_enabled
AGENTA_LOG_CONSOLE_LEVEL = env.logging.console_level

# COLORS
LEVEL_COLORS = {
    "TRACE": "\033[97m",
    "DEBUG": "\033[38;5;39m",
    "INFO": "\033[38;5;70m",
    "INFO.": "\033[38;5;70m",
    "WARNING": "\033[38;5;214m",
    "WARN.": "\033[38;5;214m",
    "ERROR": "\033[38;5;203m",
    "CRITICAL": "\033[38;5;199m",
    "FATAL": "\033[1;37;41m",
}
RESET = "\033[0m"

SEVERITY_NUMBERS = {
    "TRACE": 1,
    "DEBUG": 5,
    "INFO": 9,
    "INFO.": 9,
    "WARNING": 13,
    "WARN.": 13,
    "ERROR": 17,
    "CRITICAL": 21,
    "FATAL": 21,
}

# PROCESSORS


def process_positional_args(_, __, event_dict: EventDict) -> EventDict:
    args = event_dict.pop("positional_args", ())
    if args and isinstance(event_dict.get("event"), str):
        try:
            event_dict["event"] = event_dict["event"] % args
        except Exception:
            event_dict["event"] = f"{event_dict['event']} {args}"
    return event_dict


def add_logger_info(
    logger: WrappedLogger, method_name: str, event_dict: EventDict
) -> EventDict:
    level = method_name.upper()
    if level == "CRITICAL":
        level = "FATAL"
    elif level == "WARNING":
        level = "WARN."
    elif level == "INFO":
        level = "INFO."

    event_dict["level"] = level
    event_dict["SeverityText"] = level
    event_dict["SeverityNumber"] = SEVERITY_NUMBERS.get(level, 9)
    event_dict["LoggerName"] = logger.name
    event_dict["MethodName"] = method_name
    event_dict["pid"] = os.getpid()
    return event_dict


def colored_console_renderer() -> Processor:
    hidden = {
        "SeverityText",
        "SeverityNumber",
        "MethodName",
        "logger_factory",
        "LoggerName",
        "level",
    }

    def render(_, __, event_dict: EventDict) -> str:
        event_dict.pop("pid", None)
        ts = event_dict.pop("Timestamp", "")[:23] + "Z"
        level = event_dict.pop("level", "INFO")
        msg = event_dict.pop("event", "")
        color = LEVEL_COLORS.get(level, "")
        padded = f"[{level:<5}]"
        logger = f"\033[38;5;245m[{event_dict.pop('logger', '')}]\033[0m"
        extras = " ".join(
            f"\033[38;5;245m{k}={v}\033[0m"
            for k, v in event_dict.items()
            if k not in hidden
        )
        return f"{ts} {color}{padded}{RESET} {msg} {logger} {extras}"

    return render


SHARED_PROCESSORS: list[Processor] = [
    structlog.processors.TimeStamper(fmt="iso", utc=True, key="Timestamp"),
    process_positional_args,
    add_logger_info,
    structlog.processors.format_exc_info,
    structlog.processors.dict_tracebacks,
]


# Guard against double initialization
_LOGGING_CONFIGURED = False

# ensure no duplicate sinks via root
_root = logging.getLogger()
_root.handlers.clear()
_root.propagate = False

# CONFIGURE HANDLERS AND STRUCTLOG LOGGERS
loggers = []

if AGENTA_LOG_CONSOLE_ENABLED and not _LOGGING_CONFIGURED:
    _LOGGING_CONFIGURED = True

    # Create a single handler for console output
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(getattr(logging, AGENTA_LOG_CONSOLE_LEVEL, TRACE_LEVEL))
    console_handler.setFormatter(logging.Formatter("%(message)s"))

    # Configure the structlog console logger
    console_logger = logging.getLogger("agenta_console")
    console_logger.handlers.clear()
    console_logger.addHandler(console_handler)
    console_logger.setLevel(TRACE_LEVEL)
    console_logger.propagate = False

    loggers.append(
        structlog.wrap_logger(
            console_logger,
            processors=SHARED_PROCESSORS + [colored_console_renderer()],
            wrapper_class=structlog.stdlib.BoundLogger,
            logger_factory=structlog.stdlib.LoggerFactory(),
            cache_logger_on_first_use=False,  # Don't cache to avoid stale state
        )
    )

    # Configure uvicorn/gunicorn loggers with separate handlers
    for name in ("uvicorn.access", "uvicorn.error", "gunicorn.error"):
        uh = logging.StreamHandler(sys.stdout)
        uh.setLevel(getattr(logging, AGENTA_LOG_CONSOLE_LEVEL, TRACE_LEVEL))
        uh.setFormatter(logging.Formatter("%(message)s"))
        server_logger = logging.getLogger(name)
        server_logger.handlers.clear()
        server_logger.setLevel(logging.INFO)
        server_logger.addHandler(uh)
        server_logger.propagate = False

    # Intercept agenta SDK loggers to prevent duplicate output
    for sdk_name in ("agenta", "agenta.sdk"):
        sdk_logger = logging.getLogger(sdk_name)
        sdk_logger.handlers.clear()
        sdk_logger.addHandler(console_handler)  # Use our handler
        sdk_logger.setLevel(logging.INFO)
        sdk_logger.propagate = False


class MultiLogger:
    def __init__(self, *loggers: structlog.stdlib.BoundLogger):
        self._loggers = loggers

    def _log(self, level: str, *args: Any, **kwargs: Any):
        for lgr in self._loggers:
            getattr(lgr, level)(*args, **kwargs)

    def debug(self, *a, **k):
        self._log("debug", *a, **k)

    def info(self, *a, **k):
        self._log("info", *a, **k)

    def warning(self, *a, **k):
        self._log("warning", *a, **k)

    def warn(self, *a, **k):
        self._log("warn", *a, **k)

    def error(self, *a, **k):
        self._log("error", *a, **k)

    def critical(self, *a, **k):
        self._log("critical", *a, **k)

    def fatal(self, *a, **k):
        self._log("fatal", *a, **k)

    def trace(self, *a, **k):
        self._log("trace", *a, **k)

    def bind(self, **kwargs):
        return MultiLogger(*(lgr.bind(**kwargs) for lgr in self._loggers))


def get_logger(name: Optional[str] = None) -> MultiLogger:
    return MultiLogger(*loggers).bind(logger=name)


def get_module_logger(path: str) -> MultiLogger:
    match = re.search(r"(?:/sdk|/api)(/.*)", path)
    if match:
        trimmed = match.group(0).lstrip("/")
        dotted = trimmed.removesuffix(".py").replace("/", ".")
        return get_logger(dotted)
    return get_logger(os.path.basename(path).removesuffix(".py"))
