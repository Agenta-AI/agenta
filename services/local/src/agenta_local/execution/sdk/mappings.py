"""Revision -> SDK parameter-shape mapping."""

from collections.abc import Sequence
from typing import Any

from ...core.agents.dtos import AgentRevision
from ...core.execution.dtos import ExecutionMessage


def revision_to_agent_params(revision: AgentRevision) -> dict[str, Any]:
    # The exact nesting AgentTemplate.from_params consumes (template element at "agent").
    return {
        "agent": {
            "instructions": {"agents_md": revision.instructions},
            "llm": {
                "provider": revision.model.provider,
                "model": revision.model.name,
                "extras": dict(revision.model.parameters),
            },
            "tools": [],
            "mcps": [],
            "skills": [],
            "harness": {"kind": "pi_core", "permissions": {}, "extras": {}},
            "runner": {"kind": "sidecar", "permissions": {"default": "deny"}},
            "sandbox": {"kind": "local"},
        }
    }


def messages_to_sdk(messages: Sequence[ExecutionMessage]) -> list[dict[str, Any]]:
    return [{"role": message.role, "content": message.content} for message in messages]
