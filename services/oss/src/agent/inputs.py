"""Parse the playground/API request into a model, instructions, tools, and messages."""

from typing import Any, Dict, List, Optional, Tuple

from oss.src.agent.config import AgentConfig
from oss.src.harness.ports import Message


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
