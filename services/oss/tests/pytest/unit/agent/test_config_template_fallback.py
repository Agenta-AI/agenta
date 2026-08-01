"""``config.py``: the default template dir resolves under `services/runner`, and a missing
template logs a warning instead of silently falling through to the hello-world constants
(PY-A2)."""

from __future__ import annotations

import json
import logging


from agenta.sdk.agents.pi_builtins import PI_DEFAULT_ACTIVE_BUILTINS

from oss.src.agent import config as agent_config


def test_default_agent_dir_resolves_under_services_runner():
    assert agent_config._DEFAULT_AGENT_DIR.name == "runner"
    assert agent_config._DEFAULT_AGENT_DIR.parent.name == "services"


def test_load_config_uses_real_template_when_present():
    template = agent_config.load_config()

    assert template.agents_md != agent_config.DEFAULT_AGENTS_MD


def test_on_disk_template_grants_pi_default_builtins():
    """The on-disk `agent.json` is a second copy of the shipped default (issue #5590). An empty
    `tools` list there reaches the runner as "grant no built-ins", so a request that carries no
    template of its own would run with no read, bash, edit or write."""
    expected = [
        {"type": "builtin", "name": name} for name in PI_DEFAULT_ACTIVE_BUILTINS
    ]

    assert agent_config.load_config().tools == expected
    assert agent_config.DEFAULT_TOOLS == expected


def _write_template(tmp_path, monkeypatch, meta: dict):
    """Point `load_config` at a throwaway template dir holding `meta` as its agent.json."""
    (tmp_path / "AGENTS.md").write_text("Be terse.", encoding="utf-8")
    (tmp_path / "agent.json").write_text(json.dumps(meta), encoding="utf-8")
    monkeypatch.setenv("AGENTA_AGENT_TEMPLATE_DIR", str(tmp_path))


def test_agent_json_without_tools_key_keeps_the_defaults(monkeypatch, tmp_path):
    """An agent.json written before the grant list existed carries no `tools` key. Reading that
    as an empty list would strip read/bash/edit/write from every deployment still on the older
    file (issue #5590)."""
    _write_template(tmp_path, monkeypatch, {"model": "gpt-5.6-luna"})

    assert agent_config.load_config().tools == agent_config.DEFAULT_TOOLS


def test_agent_json_with_empty_tools_grants_nothing(monkeypatch, tmp_path):
    # An explicit empty list is the documented way to ship an agent with no built-ins.
    _write_template(tmp_path, monkeypatch, {"model": "gpt-5.6-luna", "tools": []})

    assert agent_config.load_config().tools == []


def test_agent_json_tools_override_the_defaults(monkeypatch, tmp_path):
    tools = [{"type": "builtin", "name": "read"}]
    _write_template(tmp_path, monkeypatch, {"model": "gpt-5.6-luna", "tools": tools})

    assert agent_config.load_config().tools == tools


def test_missing_template_logs_warning_and_falls_back(monkeypatch, tmp_path, caplog):
    monkeypatch.setenv("AGENTA_AGENT_TEMPLATE_DIR", str(tmp_path / "does-not-exist"))

    with caplog.at_level(logging.WARNING):
        template = agent_config.load_config()

    assert template.agents_md == agent_config.DEFAULT_AGENTS_MD
    assert template.model == agent_config.DEFAULT_MODEL
    assert template.tools == agent_config.DEFAULT_TOOLS

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
