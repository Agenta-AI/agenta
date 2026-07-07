"""``config.py``: the default template dir resolves under `services/runner`, and a missing
template logs a warning instead of silently falling through to the hello-world constants
(PY-A2)."""

from __future__ import annotations

import logging


from oss.src.agent import config as agent_config


def test_default_agent_dir_resolves_under_services_runner():
    assert agent_config._DEFAULT_AGENT_DIR.name == "runner"
    assert agent_config._DEFAULT_AGENT_DIR.parent.name == "services"


def test_load_config_uses_real_template_when_present():
    template = agent_config.load_config()

    assert template.agents_md != agent_config.DEFAULT_AGENTS_MD


def test_missing_template_logs_warning_and_falls_back(monkeypatch, tmp_path, caplog):
    monkeypatch.setenv("AGENTA_AGENT_TEMPLATE_DIR", str(tmp_path / "does-not-exist"))

    with caplog.at_level(logging.WARNING):
        template = agent_config.load_config()

    assert template.agents_md == agent_config.DEFAULT_AGENTS_MD
    assert template.model == agent_config.DEFAULT_MODEL
    assert template.tools == []

    messages = [
        record.message % record.args if record.args else record.message
        for record in caplog.records
    ]
    assert any(
        "AGENTS.md" in message and "falling back" in message for message in messages
    )
    assert any(
        "agent.json" in message and "falling back" in message for message in messages
    )
