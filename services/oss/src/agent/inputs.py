"""Parse the playground/API request into a model, instructions, tools, and messages."""

import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from oss.src.agent.config import AgentConfig
from oss.src.harness.ports import Message


@dataclass
class RunConfig:
    """The agent config for one run, resolved from the request and the file defaults."""

    instructions: str
    model: str
    tools: List[Any] = field(default_factory=list)
    harness: str = "pi"
    sandbox: str = "local"
    permission_policy: str = "auto"


def _as_list(raw: Any) -> List[Any]:
    """Coerce a tools value (a dict, a list, or nothing) into a list."""
    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, list):
        return raw
    return []


def resolve_agent_config(params: Dict[str, Any], config: AgentConfig) -> RunConfig:
    """Resolve the full agent run config from the request parameters.

    Prefers the dedicated ``agent`` config element (the ``agent_config`` control). Falls
    back to the legacy shape (a ``prompt`` prompt-template plus loose ``harness`` /
    ``sandbox`` / ``permission_policy`` params) so existing revisions keep working.
    Unset harness/sandbox fall back to the env defaults.
    """
    agent = params.get("agent")
    if isinstance(agent, dict):
        return RunConfig(
            instructions=agent.get("instructions") or config.agents_md,
            model=agent.get("model") or config.model,
            tools=_as_list(agent.get("tools")),
            harness=(
                agent.get("harness") or os.getenv("AGENTA_AGENT_HARNESS", "pi")
            ).lower(),
            sandbox=(
                agent.get("sandbox") or os.getenv("AGENTA_AGENT_SANDBOX", "local")
            ).lower(),
            permission_policy=(agent.get("permission_policy") or "auto").lower(),
        )

    model, instructions, raw_tools = resolve_run_config(params, config)
    return RunConfig(
        instructions=instructions,
        model=model,
        tools=_as_list(raw_tools),
        harness=(
            params.get("harness") or os.getenv("AGENTA_AGENT_HARNESS", "pi")
        ).lower(),
        sandbox=(
            params.get("sandbox") or os.getenv("AGENTA_AGENT_SANDBOX", "local")
        ).lower(),
        permission_policy=(params.get("permission_policy") or "auto").lower(),
    )


def _system_text(messages: Optional[List[Any]]) -> str:
    """Join the system-message content of a prompt-template into AGENTS.md text."""
    parts: List[str] = []
    for message in messages or []:
        if not isinstance(message, dict) or message.get("role") != "system":
            continue
        content = message.get("content")
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            parts.extend(
                block.get("text", "")
                for block in content
                if isinstance(block, dict) and block.get("type") == "text"
            )
    return "\n\n".join(part for part in parts if part)


def resolve_run_config(
    params: Dict[str, Any],
    config: AgentConfig,
) -> Tuple[str, str, Any]:
    """Pull model, instructions, and raw tools from the request parameters.

    Accepts both shapes: the playground's ``prompt`` (a ``prompt-template`` whose system
    message is the AGENTS.md and whose ``llm_config`` carries model + picker tools) and the
    flat ``{model, agents_md, tools}`` an API caller may send. Falls back to the service
    file config for any unset field.
    """
    prompt_cfg = params.get("prompt")
    if isinstance(prompt_cfg, dict):
        llm_config = prompt_cfg.get("llm_config") or {}
        model = llm_config.get("model") or config.model
        agents_md = _system_text(prompt_cfg.get("messages")) or config.agents_md
        raw_tools = llm_config.get("tools")
        if raw_tools is None:
            raw_tools = prompt_cfg.get("tools")
    else:
        model = params.get("model") or config.model
        agents_md = params.get("agents_md") or config.agents_md
        raw_tools = params.get("tools")

    if raw_tools is None:
        raw_tools = config.tools
    return model, agents_md, raw_tools


def to_messages(raw: Optional[List[Any]]) -> List[Message]:
    """Coerce the playground's loose message dicts into :class:`Message` objects.

    The runner picks the latest user turn and replays the rest as context, so we hand it
    the whole conversation rather than pre-extracting a single prompt.
    """
    messages: List[Message] = []
    for item in raw or []:
        message = Message.from_raw(item)
        if message is not None:
            messages.append(message)
    return messages
