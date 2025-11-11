from typing import Any, Optional

import os
import re
import sys
import logging

import structlog
from structlog.typing import EventDict, WrappedLogger, Processor

# from datetime import datetime
# from logging.handlers import RotatingFileHandler

# from opentelemetry.trace import get_current_span
# from opentelemetry._logs import set_logger_provider
# from opentelemetry.sdk._logs import LoggingHandler, LoggerProvider
# from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
# from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter

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
AGENTA_LOG_CONSOLE_ENABLED = os.getenv("AGENTA_LOG_CONSOLE_ENABLED", "true") == "true"
AGENTA_LOG_CONSOLE_LEVEL = os.getenv("AGENTA_LOG_CONSOLE_LEVEL", "TRACE").upper()

# AGENTA_LOG_OTLP_ENABLED = os.getenv("AGENTA_LOG_OTLP_ENABLED", "false") == "true"
# AGENTA_LOG_OTLP_LEVEL = os.getenv("AGENTA_LOG_OTLP_LEVEL", "INFO").upper()

# AGENTA_LOG_FILE_ENABLED = os.getenv("AGENTA_LOG_FILE_ENABLED", "true") == "true"
# AGENTA_LOG_FILE_LEVEL = os.getenv("AGENTA_LOG_FILE_LEVEL", "WARNING").upper()
# AGENTA_LOG_FILE_BASE = os.getenv("AGENTA_LOG_FILE_PATH", "error")
# LOG_FILE_DATE = datetime.utcnow().strftime("%Y-%m-%d")
# AGENTA_LOG_FILE_PATH = f"{AGENTA_LOG_FILE_BASE}-{LOG_FILE_DATE}.log"

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


# def add_trace_context(_, __, event_dict: EventDict) -> EventDict:
#     span = get_current_span()
#     if span and span.get_span_context().is_valid:
#         ctx = span.get_span_context()
#         event_dict["TraceId"] = format(ctx.trace_id, "032x")
#         event_dict["SpanId"] = format(ctx.span_id, "016x")
#     return event_dict


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


# def plain_renderer() -> Processor:
#     hidden = {
#         "SeverityText",
#         "SeverityNumber",
#         "MethodName",
#         "logger_factory",
#         "LoggerName",
#         "level",
#     }

#     def render(_, __, event_dict: EventDict) -> str:
#         ts = event_dict.pop("Timestamp", "")[:23] + "Z"
#         level = event_dict.get("level", "")
#         msg = event_dict.pop("event", "")
#         padded = f"[{level:<5}]"
#         logger = f"[{event_dict.pop('logger', '')}]"
#         extras = " ".join(f"{k}={v}" for k, v in event_dict.items() if k not in hidden)
#         return f"{ts} {padded} {msg} {logger} {extras}"

#     return render


# def json_renderer() -> Processor:
#     return structlog.processors.JSONRenderer()


SHARED_PROCESSORS: list[Processor] = [
    structlog.processors.TimeStamper(fmt="iso", utc=True, key="Timestamp"),
    process_positional_args,
    # add_trace_context,
    add_logger_info,
    structlog.processors.format_exc_info,
    structlog.processors.dict_tracebacks,
]


def create_struct_logger(
    processors: list[Processor], name: str
) -> structlog.stdlib.BoundLogger:
    logger = logging.getLogger(name)
    logger.setLevel(TRACE_LEVEL)
    return structlog.wrap_logger(
        logger,
        processors=SHARED_PROCESSORS + processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


# CONFIGURE HANDLERS AND STRUCTLOG LOGGERS
handlers = []
loggers = []

if AGENTA_LOG_CONSOLE_ENABLED:
    h = logging.StreamHandler(sys.stdout)
    h.setLevel(getattr(logging, AGENTA_LOG_CONSOLE_LEVEL, TRACE_LEVEL))
    h.setFormatter(logging.Formatter("%(message)s"))
    logging.getLogger("console").addHandler(h)
    loggers.append(create_struct_logger([colored_console_renderer()], "console"))

# if AGENTA_LOG_FILE_ENABLED:
#     h = RotatingFileHandler(AGENTA_LOG_FILE_PATH, maxBytes=10 * 1024 * 1024, backupCount=5)
#     h.setLevel(getattr(logging, AGENTA_LOG_FILE_LEVEL, logging.WARNING))
#     h.setFormatter(logging.Formatter("%(message)s"))
#     logging.getLogger("file").addHandler(h)
#     loggers.append(create_struct_logger([plain_renderer()], "file"))

# if AGENTA_LOG_OTLP_ENABLED:
#     provider = LoggerProvider()
#     exporter = OTLPLogExporter()
#     provider.add_log_record_processor(BatchLogRecordProcessor(exporter))
#     set_logger_provider(provider)
#     h = LoggingHandler(
#         level=getattr(logging, AGENTA_LOG_OTLP_LEVEL, logging.INFO), logger_provider=provider
#     )
#     h.setFormatter(logging.Formatter("%(message)s"))
#     logging.getLogger("otel").addHandler(h)
#     loggers.append(create_struct_logger([json_renderer()], "otel"))


class MultiLogger:
    def __init__(self, *loggers: structlog.stdlib.BoundLogger):
        self._loggers = loggers

    def _log(self, level: str, *args: Any, **kwargs: Any):
        for l in self._loggers:
            getattr(l, level)(*args, **kwargs)

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
        return MultiLogger(*(l.bind(**kwargs) for l in self._loggers))


multi_logger = MultiLogger(*loggers)


def get_logger(name: Optional[str] = None) -> MultiLogger:
    return multi_logger.bind(logger=name)


def get_module_logger(path: str) -> MultiLogger:
    match = re.search(r"(?:/sdk|/api)(/.*)", path)
    if match:
        trimmed = match.group(0).lstrip("/")
        dotted = trimmed.removesuffix(".py").replace("/", ".")
        return get_logger(dotted)
    return get_logger(os.path.basename(path).removesuffix(".py"))
