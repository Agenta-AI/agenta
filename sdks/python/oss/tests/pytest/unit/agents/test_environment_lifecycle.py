"""Environment sandbox policy and the cold ``Harness.prompt`` lifecycle.

These lock the isolation guarantees the design docs promise: a fresh sandbox per session
under the cold model, the session torn down in a ``finally`` even when the turn raises, the
session id carried forward, and AGENTS.md provisioned only when there are instructions.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents import (
    AgentConfig,
    AgentResult,
    HarnessType,
    Message,
    PiHarness,
    SessionConfig,
)


def _config(instructions="hi") -> SessionConfig:
    return SessionConfig(agent=AgentConfig(instructions=instructions, model="m"))


# ------------------------------------------------------------- Environment policy


async def test_fresh_sandbox_per_session(make_env):
    env = make_env(sandbox_per_session=True)
    config = _config()

    await env.create_session(
        PiHarness(env)._to_harness_config(config),
        harness=HarnessType.PI,
        session_config=config,
    )
    await env.create_session(
        PiHarness(env)._to_harness_config(config),
        harness=HarnessType.PI,
        session_config=config,
    )

    assert len(env.backend.sandboxes) == 2  # a new sandbox each time (cold model)


async def test_shared_sandbox_when_not_per_session(make_env):
    env = make_env(sandbox_per_session=False)
    config = _config()

    for _ in range(2):
        await env.create_session(
            PiHarness(env)._to_harness_config(config),
            harness=HarnessType.PI,
            session_config=config,
        )

    assert len(env.backend.sandboxes) == 1  # one sandbox reused
    await env.shutdown()
    assert env.backend.sandboxes[0].destroyed is True  # shutdown tears it down
    assert env.backend.shutdown_calls == 1


async def test_provisioning_writes_agents_md_only_when_present(make_env):
    env = make_env()
    harness = PiHarness(env)

    assert harness._provisioning(_config("hello")) == {"AGENTS.md": b"hello"}
    assert harness._provisioning(_config("")) == {}
    assert harness._provisioning(_config("   ")) == {}
    assert harness._provisioning(_config(None)) == {}


async def test_create_session_adds_files_when_provisioned(make_env):
    env = make_env()
    config = _config("project conventions")

    await PiHarness(env).create_session(config)

    assert env.backend.sandboxes[0].files == {"AGENTS.md": b"project conventions"}


# ------------------------------------------------------- Cold Harness.prompt path


async def test_prompt_runs_and_tears_down(make_env):
    env = make_env(result=AgentResult(output="done"))
    harness = PiHarness(env)

    result = await harness.prompt(_config(), [Message(role="user", content="hi")])

    assert result.output == "done"
    assert env.backend.sessions[0].destroyed is True  # torn down on the happy path


async def test_prompt_destroys_session_even_when_it_raises(make_env):
    env = make_env(raise_on_prompt=True)
    harness = PiHarness(env)

    with pytest.raises(RuntimeError, match="boom"):
        await harness.prompt(_config(), [Message(role="user", content="hi")])

    assert env.backend.sessions[0].destroyed is True  # finally still runs


async def test_prompt_carries_session_id_forward(make_env):
    env = make_env(
        result=AgentResult(output="x", session_id="sess-new"),
        result_session_id="sess-new",
    )
    harness = PiHarness(env)
    config = _config()

    await harness.prompt(config, [Message(role="user", content="hi")])

    assert config.session_id == "sess-new"  # next turn can resume it


async def test_prompt_leaves_session_id_when_result_has_none(make_env):
    env = make_env(result=AgentResult(output="x", session_id=None))
    harness = PiHarness(env)
    config = _config()
    config.session_id = "prior"

    await harness.prompt(config, [Message(role="user", content="hi")])

    assert config.session_id == "prior"  # unchanged
