"""Runtime registry.

Maps a runtime slug (the ``{runtime}`` segment of ``/api/chat/{runtime}``) to
a callable that returns its Pydantic-AI ``Agent``. The agent is module-level
in each runtime, so this registry just exposes them; per-request DI is done
via ``deps=`` at run time.

Adding a runtime: import its agent and add an entry. Each runtime owns its
own model selection, system prompt, and tool registration.
"""

from __future__ import annotations

from typing import Callable

from pydantic_ai import Agent

from runtimes.pydanticai.vanilla import agent as pydanticai_vanilla_agent


# slug -> agent factory. Today every factory just returns a module-level
# singleton; this leaves room for per-request agent construction (e.g. for
# Agenta variants that need a fresh prompt per call).
RUNTIMES: dict[str, Callable[[], Agent]] = {
    "pydanticai_vanilla": lambda: pydanticai_vanilla_agent,
    # "pydanticai_with_agenta": ...,
    # "openai_agents_vanilla": ...,
    # "openai_agents_with_agenta": ...,
    # "claude_sdk_vanilla": ...,
    # "claude_sdk_with_agenta": ...,
    # "langgraph_vanilla": ...,
    # "langgraph_with_agenta": ...,
}


def get_agent(runtime: str) -> Agent:
    if runtime not in RUNTIMES:
        raise KeyError(runtime)
    return RUNTIMES[runtime]()


def list_runtimes() -> list[str]:
    return sorted(RUNTIMES)
