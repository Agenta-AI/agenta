"""AGENTA_LOG_FORMAT picks the API's console output: colored text or one JSON object per line."""

import json
import logging

import oss.src.utils.logging as api_logging
from agenta.sdk.utils.logging import JsonFormatter


EVENT = {
    "event": "hello",
    "level": "INFO.",
    "Timestamp": "2026-01-02T03:04:05.678Z",
    "logger": "oss.src.core.things",
    "pid": 7,
}


def test_text_format_keeps_the_colored_console(monkeypatch):
    monkeypatch.setattr(api_logging, "AGENTA_LOG_FORMAT", "text")

    line = api_logging._console_renderer()(None, "info", dict(EVENT))

    assert "\033[" in line
    assert "hello" in line
    assert isinstance(api_logging._plain_formatter(), logging.Formatter)
    assert not isinstance(api_logging._plain_formatter(), JsonFormatter)


def test_json_format_renders_one_object(monkeypatch):
    monkeypatch.setattr(api_logging, "AGENTA_LOG_FORMAT", "json")
    monkeypatch.setattr(api_logging, "GOOGLE_CLOUD_PROJECT", "my-project")

    line = json.loads(api_logging._console_renderer()(None, "info", dict(EVENT)))

    assert line["severity"] == "INFO"
    assert line["message"] == "hello"
    assert line["time"] == "2026-01-02T03:04:05.678Z"
    assert line["logger"] == "oss.src.core.things"
    assert line["pid"] == 7


def test_json_format_also_covers_stdlib_records(monkeypatch):
    monkeypatch.setattr(api_logging, "AGENTA_LOG_FORMAT", "json")
    monkeypatch.setattr(api_logging, "GOOGLE_CLOUD_PROJECT", "my-project")

    formatter = api_logging._plain_formatter()

    assert isinstance(formatter, JsonFormatter)
    assert formatter.project == "my-project"
