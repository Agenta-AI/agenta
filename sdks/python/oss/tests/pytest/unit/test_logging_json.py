"""AGENTA_LOG_FORMAT=json: one JSON object per line, with Google Cloud Logging fields."""

import sys
import json
import logging
from types import SimpleNamespace

import pytest
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.sampling import ALWAYS_OFF
from opentelemetry.trace import use_span

import agenta as ag
from agenta.sdk.utils import logging as sdk_logging


def _render(project=None, **event):
    event = {
        "event": "hello",
        "level": "INFO.",
        "Timestamp": "2026-01-02T03:04:05.678901Z",
        "SeverityText": "INFO.",
        "SeverityNumber": 9,
        "MethodName": "info",
        "LoggerName": "console",
        "logger": "oss.src.core.things",
        **event,
    }
    return json.loads(sdk_logging.json_renderer(project)(None, "info", event))


@pytest.fixture
def no_product_tracing(monkeypatch):
    monkeypatch.setattr(ag, "tracing", None, raising=False)


def test_json_line_has_severity_message_time_and_fields(no_product_tracing):
    line = _render(user="u1", count=3)

    assert line == {
        "severity": "INFO",
        "message": "hello",
        "time": "2026-01-02T03:04:05.678901Z",
        "logger": "oss.src.core.things",
        "user": "u1",
        "count": 3,
    }


@pytest.mark.parametrize(
    "level,severity",
    [
        ("TRACE", "DEBUG"),
        ("DEBUG", "DEBUG"),
        ("WARN.", "WARNING"),
        ("ERROR", "ERROR"),
        ("FATAL", "CRITICAL"),
    ],
)
def test_json_severity_uses_cloud_logging_names(no_product_tracing, level, severity):
    assert _render(level=level)["severity"] == severity


def test_json_keeps_values_that_are_not_json_native(no_product_tracing):
    marker = object()

    assert _render(thing=marker)["thing"] == str(marker)


def test_console_renderer_picks_the_format():
    event = {"event": "hello", "level": "INFO.", "Timestamp": "2026-01-02T03:04:05Z"}

    text = sdk_logging.console_renderer("text")(None, "info", dict(event))
    line = sdk_logging.console_renderer("json")(None, "info", dict(event))

    assert "\033[" in text
    assert json.loads(line)["message"] == "hello"


def _server_provider():
    return TracerProvider(resource=Resource.create({"service.name": "server"}))


def test_trace_fields_for_a_sampled_span_with_a_project(no_product_tracing):
    span = _server_provider().get_tracer("t").start_span("request")
    ids = span.get_span_context()

    with use_span(span, end_on_exit=True):
        line = _render(project="my-project")

    trace_id = format(ids.trace_id, "032x")
    assert line["logging.googleapis.com/trace"] == (
        f"projects/my-project/traces/{trace_id}"
    )
    assert line["logging.googleapis.com/spanId"] == format(ids.span_id, "016x")
    assert line["logging.googleapis.com/trace_sampled"] is True
    assert "otelTraceID" not in line


def test_trace_fields_without_a_project_are_bare_ids(no_product_tracing):
    span = _server_provider().get_tracer("t").start_span("request")
    ids = span.get_span_context()

    with use_span(span, end_on_exit=True):
        line = _render()

    assert line["otelTraceID"] == format(ids.trace_id, "032x")
    assert line["otelSpanID"] == format(ids.span_id, "016x")
    assert not any(key.split("/")[0] == "logging.googleapis.com" for key in line)


def test_no_trace_fields_without_a_span(no_product_tracing):
    line = _render(project="my-project")

    assert "logging.googleapis.com/trace" not in line
    assert "otelTraceID" not in line


def test_no_trace_fields_for_an_unsampled_span(no_product_tracing):
    provider = TracerProvider(sampler=ALWAYS_OFF)
    span = provider.get_tracer("t").start_span("request")

    with use_span(span, end_on_exit=True):
        line = _render(project="my-project")

    assert "logging.googleapis.com/trace" not in line


def test_no_trace_fields_for_a_product_span(monkeypatch):
    # a product span belongs to the customer's trace in Agenta, not to the server's trace
    product = TracerProvider(resource=Resource.create({"service.name": "agenta-sdk"}))
    monkeypatch.setattr(
        ag, "tracing", SimpleNamespace(tracer_provider=product), raising=False
    )
    span = product.get_tracer("t").start_span("workflow")

    with use_span(span, end_on_exit=True):
        line = _render(project="my-project")

    assert "logging.googleapis.com/trace" not in line


def test_stdlib_records_render_as_json(no_product_tracing):
    record = logging.LogRecord(
        name="uvicorn.access",
        level=logging.WARNING,
        pathname=__file__,
        lineno=1,
        msg="%s %s",
        args=("GET", "/health"),
        exc_info=None,
    )

    line = json.loads(sdk_logging.JsonFormatter("my-project").format(record))

    assert line["severity"] == "WARNING"
    assert line["message"] == "GET /health"
    assert line["logger"] == "uvicorn.access"
    assert line["time"].endswith("Z")


def test_stdlib_records_keep_the_exception(no_product_tracing):
    try:
        raise ValueError("boom")
    except ValueError:
        exc_info = sys.exc_info()

    record = logging.LogRecord(
        name="gunicorn.error",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg="failed",
        args=(),
        exc_info=exc_info,
    )

    line = json.loads(sdk_logging.JsonFormatter().format(record))

    assert line["severity"] == "ERROR"
    assert "ValueError: boom" in line["exception"]


def _render_safe(**fields):
    import json

    from agenta.sdk.utils.logging import json_renderer

    return json.loads(
        json_renderer()(None, None, {"event": "hi", "level": "INFO.", **fields})
    )


def test_json_renderer_stringifies_uuid_keys():
    import uuid

    key = uuid.uuid4()

    assert _render_safe(ids={key: 1})["ids"] == {str(key): 1}


def test_json_renderer_stringifies_nested_uuid_keys():
    import uuid

    a, b = uuid.uuid4(), uuid.uuid4()
    out = _render_safe(ids={a: {"x": [{b: 2}]}})

    assert out["ids"] == {str(a): {"x": [{str(b): 2}]}}
    assert out["message"] == "hi"


def test_json_renderer_survives_object_whose_str_raises():
    class Bad:
        def __str__(self):
            raise RuntimeError("no str")

        def __repr__(self):
            return "<Bad>"

    out = _render_safe(obj=Bad(), keyed={Bad(): 1})

    assert out["message"] == "hi"
    assert out["severity"] == "INFO"


def test_json_renderer_survives_a_cycle():
    import uuid

    loop: dict = {uuid.uuid4(): 1}
    loop["self"] = loop
    out = _render_safe(loop=loop)

    assert out["message"] == "hi"
    assert out["severity"] == "INFO"


def test_json_formatter_survives_non_str_keys_in_message():
    import json
    import logging
    import uuid

    from agenta.sdk.utils.logging import JsonFormatter

    record = logging.LogRecord(
        "x", logging.INFO, "f", 1, "%s", ({uuid.uuid4(): 1},), None
    )

    assert json.loads(JsonFormatter().format(record))["severity"] == "INFO"


def test_text_renderer_survives_object_whose_str_raises():
    from agenta.sdk.utils.logging import colored_console_renderer

    class Bad:
        def __str__(self):
            raise RuntimeError("no str")

    line = colored_console_renderer()(
        None,
        None,
        {
            "event": "hi",
            "level": "INFO.",
            "Timestamp": "2026-01-01T00:00:00.000000Z",
            "logger": "x",
            "obj": Bad(),
        },
    )

    assert "hi" in line


def test_gunicorn_logconfig_is_empty_for_text():
    assert sdk_logging.gunicorn_logconfig("text") == {}


def test_gunicorn_logconfig_routes_gunicorn_loggers_through_the_json_formatter(
    capsys,
):
    import logging.config

    config = sdk_logging.gunicorn_logconfig("json", "my-project")
    saved = {
        name: (
            list(logging.getLogger(name).handlers),
            logging.getLogger(name).propagate,
        )
        for name in ("gunicorn.error", "gunicorn.access")
    }
    try:
        logging.config.dictConfig(config)
        logging.getLogger("gunicorn.access").setLevel(
            logging.INFO
        )  # gunicorn does this
        logging.getLogger("gunicorn.error").warning(
            "Listening at: %s", "http://0.0.0.0:8000"
        )
        logging.getLogger("gunicorn.access").info("GET /health 200")
    finally:
        for name, (handlers, propagate) in saved.items():
            logging.getLogger(name).handlers = handlers
            logging.getLogger(name).propagate = propagate

    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert [(entry["severity"], entry["message"]) for entry in lines] == [
        ("WARNING", "Listening at: http://0.0.0.0:8000"),
        ("INFO", "GET /health 200"),
    ]


def test_python_warnings_become_json_lines_on_stdout(capsys):
    import warnings

    saved = logging.getLogger("py.warnings")
    handlers, propagate = list(saved.handlers), saved.propagate
    try:
        sdk_logging.capture_warnings_as_json()
        warnings.warn("old thing", DeprecationWarning, stacklevel=1)
    finally:
        logging.captureWarnings(False)
        saved.handlers, saved.propagate = handlers, propagate

    (line,) = [json.loads(entry) for entry in capsys.readouterr().out.splitlines()]
    assert line["severity"] == "WARNING"
    assert "old thing" in line["message"]
