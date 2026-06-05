"""Runtime registry.

Maps a runtime slug (the ``{runtime}`` segment of ``/api/chat/{runtime}``) to a
``RuntimeSpec``: how to build its framework agent and which ``kind`` of streamer
the server should drive it with. Per-request DI is done via the framework's
native context at run time, not here.

Adding a runtime: import its agent and add a ``RuntimeSpec`` entry. Each runtime
owns its own model selection, system prompt, and tool registration; the server
only needs the ``kind`` to pick the right event-stream translator.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from runtimes.langgraph.vanilla import agent as langgraph_vanilla_agent
from runtimes.openai_agents.vanilla import agent as openai_agents_vanilla_agent
from runtimes.pydanticai.vanilla import agent as pydanticai_vanilla_agent


@dataclass(frozen=True)
class RuntimeSpec:
    slug: str
    # Which streamer drives it: "pydanticai" | "openai_agents".
    kind: str
    # Human-friendly name (handy if the UI wants to show labels).
    label: str
    # Returns the framework agent. A thunk so per-request construction stays
    # possible later (e.g. Agenta variants that need a fresh prompt per call).
    build: Callable[[], Any]


RUNTIMES: dict[str, RuntimeSpec] = {
    "pydanticai_vanilla": RuntimeSpec(
        slug="pydanticai_vanilla",
        kind="pydanticai",
        label="Pydantic-AI (vanilla)",
        build=lambda: pydanticai_vanilla_agent,
    ),
    "openai_agents_vanilla": RuntimeSpec(
        slug="openai_agents_vanilla",
        kind="openai_agents",
        label="OpenAI Agents SDK (vanilla)",
        build=lambda: openai_agents_vanilla_agent,
    ),
    "langgraph_vanilla": RuntimeSpec(
        slug="langgraph_vanilla",
        kind="langgraph",
        label="LangChain (vanilla)",
        build=lambda: langgraph_vanilla_agent,
    ),
    # "pydanticai_with_agenta": ...,
    # "openai_agents_with_agenta": ...,
    # "claude_sdk_vanilla": ...,
    # "langgraph_with_agenta": ...,
}


def get_spec(runtime: str) -> RuntimeSpec:
    if runtime not in RUNTIMES:
        raise KeyError(runtime)
    return RUNTIMES[runtime]


def get_agent(runtime: str) -> Any:
    return get_spec(runtime).build()


def list_runtimes() -> list[str]:
    return sorted(RUNTIMES)
