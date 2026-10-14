from typing import Any, Optional

import os
import re
import sys
import json
import logging
from datetime import datetime, timezone

import structlog
from opentelemetry.trace import get_current_span
from structlog.typing import EventDict, WrappedLogger, Processor

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
# "text" (colored, the default) or "json" (one object per line, for log collectors)
AGENTA_LOG_FORMAT = os.getenv("AGENTA_LOG_FORMAT", "text").strip().lower()
GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT") or None

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
            f"\033[38;5;245m{k}={_safe_str(v)}\033[0m"
            for k, v in event_dict.items()
            if k not in hidden
        )
        return f"{ts} {color}{padded}{RESET} {msg} {logger} {extras}"

    return render


# Google Cloud Logging severities: https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity
JSON_SEVERITIES = {
    "TRACE": "DEBUG",
    "DEBUG": "DEBUG",
    "INFO": "INFO",
    "INFO.": "INFO",
    "WARNING": "WARNING",
    "WARN.": "WARNING",
    "ERROR": "ERROR",
    "CRITICAL": "CRITICAL",
    "FATAL": "CRITICAL",
}

JSON_HIDDEN = {
    "SeverityText",
    "SeverityNumber",
    "MethodName",
    "LoggerName",
    "logger_factory",
    "level",
}


def _is_product_span(span: Any) -> bool:
    # spans of the Agenta product tracer belong to the customer's trace, not ours
    # read, never import: agenta imports this module while it loads
    ag = sys.modules.get("agenta")
    provider = getattr(getattr(ag, "tracing", None), "tracer_provider", None)

    return provider is not None and getattr(span, "resource", None) is getattr(
        provider, "resource", None
    )


def trace_fields(project: Optional[str] = None) -> dict:
    """Trace fields for the active sampled span, or {} when there is none."""
    try:
        span = get_current_span()
        context = span.get_span_context()
    except Exception:  # pylint: disable=broad-except
        return {}

    if not context.is_valid or not context.trace_flags.sampled:
        return {}

    if _is_product_span(span):
        return {}

    trace_id = format(context.trace_id, "032x")
    span_id = format(context.span_id, "016x")

    if not project:
        # the names the OpenTelemetry logging instrumentation uses; a bare
        # trace_id would clash with the product trace ids some log lines carry
        return {"otelTraceID": trace_id, "otelSpanID": span_id}

    return {
        "logging.googleapis.com/trace": f"projects/{project}/traces/{trace_id}",
        "logging.googleapis.com/spanId": span_id,
        "logging.googleapis.com/trace_sampled": True,
    }


def _safe_str(value: Any) -> str:
    try:
        return str(value)
    except Exception:  # pylint: disable=broad-except
        try:
            return repr(value)
        except Exception:  # pylint: disable=broad-except
            return f"<unprintable {type(value).__name__}>"


def _json_safe(value: Any, _seen: Optional[set] = None) -> Any:
    """Copy a value into JSON-safe types: str keys at any depth, no cycles."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value

    seen = _seen if _seen is not None else set()
    if id(value) in seen:
        return "<cycle>"

    if isinstance(value, dict):
        seen.add(id(value))
        try:
            return {
                (k if isinstance(k, str) else _safe_str(k)): _json_safe(v, seen)
                for k, v in value.items()
            }
        finally:
            seen.discard(id(value))
    if isinstance(value, (list, tuple, set, frozenset)):
        seen.add(id(value))
        try:
            return [_json_safe(v, seen) for v in value]
        finally:
            seen.discard(id(value))

    return _safe_str(value)


def dumps_log_record(record: dict) -> str:
    """Serialize a log record. Never raises: a log call must not break a request."""
    try:
        return json.dumps(record, default=str)
    except Exception:  # pylint: disable=broad-except
        pass
    try:
        return json.dumps(_json_safe(record))
    except Exception:  # pylint: disable=broad-except
        pass
    # last resort: the message plus a repr of the other fields
    fields = {
        k: v for k, v in record.items() if k not in ("severity", "message", "time")
    }
    return json.dumps(
        {
            "severity": _safe_str(record.get("severity", "DEFAULT")),
            "message": _safe_str(record.get("message", "")),
            "time": _safe_str(record.get("time", "")),
            "fields": _safe_str(fields),
        }
    )


def json_renderer(project: Optional[str] = None) -> Processor:
    """Render a structlog event as one JSON object (Google Cloud Logging fields)."""

    def render(_, __, event_dict: EventDict) -> str:
        level = event_dict.get("level", "INFO")
        record = {
            "severity": JSON_SEVERITIES.get(level, "DEFAULT"),
            "message": event_dict.pop("event", ""),
            "time": event_dict.pop("Timestamp", None)
            or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        for key, value in event_dict.items():
            if key not in JSON_HIDDEN:
                record[key] = value
        record.update(trace_fields(project))
        return dumps_log_record(record)

    return render


class JsonFormatter(logging.Formatter):
    """Format a plain stdlib record (uvicorn, gunicorn, ...) like json_renderer."""

    def __init__(self, project: Optional[str] = None):
        super().__init__()
        self.project = project

    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "severity": JSON_SEVERITIES.get(record.levelname, "DEFAULT"),
            "message": record.getMessage(),
            "time": datetime.fromtimestamp(record.created, timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
            "logger": record.name,
        }
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        entry.update(trace_fields(self.project))
        return dumps_log_record(entry)


def console_renderer(
    log_format: Optional[str] = None, project: Optional[str] = None
) -> Processor:
    if (log_format or AGENTA_LOG_FORMAT) == "json":
        return json_renderer(project)
    return colored_console_renderer()


SHARED_PROCESSORS: list[Processor] = [
    structlog.processors.TimeStamper(fmt="iso", utc=True, key="Timestamp"),
    process_positional_args,
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


# Guard against double initialization
_LOGGING_CONFIGURED = False

# CONFIGURE HANDLERS AND STRUCTLOG LOGGERS
handlers = []
loggers = []

if AGENTA_LOG_CONSOLE_ENABLED and not _LOGGING_CONFIGURED:
    _LOGGING_CONFIGURED = True

    # Check if console logger already has handlers (from OSS module)
    console_logger = logging.getLogger("console")

    if not console_logger.handlers:
        # Only add handler if it doesn't exist yet
        h = logging.StreamHandler(sys.stdout)
        h.setLevel(getattr(logging, AGENTA_LOG_CONSOLE_LEVEL, TRACE_LEVEL))
        h.setFormatter(logging.Formatter("%(message)s"))
        console_logger.addHandler(h)
        console_logger.setLevel(TRACE_LEVEL)
        console_logger.propagate = False

    loggers.append(
        create_struct_logger(
            [console_renderer(AGENTA_LOG_FORMAT, GOOGLE_CLOUD_PROJECT)], "console"
        )
    )


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
