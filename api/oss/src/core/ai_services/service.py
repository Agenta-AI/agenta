from __future__ import annotations

from typing import Any, Dict, Optional

import json

from oss.src.utils.logging import get_module_logger

from oss.src.core.ai_services.client import AgentaAIServicesClient
from oss.src.core.ai_services.dtos import (
    AIServicesStatus,
    RefinePromptArguments,
    ToolCallMeta,
    ToolCallResponse,
    ToolCallTextContent,
    ToolDefinition,
    TOOL_REFINE_PROMPT,
)
from oss.src.utils.env import AIServicesConfig, env


log = get_module_logger(__name__)


_REFINE_PROMPT_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "prompt_template_json": {
            "type": "string",
            "description": "The full prompt template as a stringified JSON object.",
        },
        "guidelines": {"type": "string"},
        "context": {"type": "string"},
    },
    "required": ["prompt_template_json"],
}

_REFINE_PROMPT_OUTPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "messages": {
            "type": "array",
            "description": "The refined messages array (same count and roles as input).",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "role": {
                        "type": "string",
                        "enum": ["system", "developer", "user", "assistant"],
                        "description": "Message role. Must match the original.",
                    },
                    "content": {
                        "type": "string",
                        "description": "Refined message content.",
                    },
                },
                "required": ["role", "content"],
            },
        },
        "summary": {
            "type": "string",
            "description": "A short summary describing what was changed in this refinement.",
        },
    },
    "required": ["messages", "summary"],
}


def _extract_structured_output(outputs: Any) -> Optional[Dict[str, Any]]:
    """Extract the structured output from the cloud completion runner response.

    The cloud returns ``{"data": "<json-string>", "trace_id": "..."}``
    where ``data`` is a JSON string containing ``messages`` (refined array)
    and ``summary`` (short description of changes).

    Returns the parsed dict or None on failure.
    """

    if not isinstance(outputs, dict):
        return None

    data_val = outputs.get("data")
    if not isinstance(data_val, str) or not data_val.strip():
        return None

    try:
        parsed = json.loads(data_val)
    except Exception:  # pylint: disable=broad-exception-caught
        return None

    if not isinstance(parsed, dict):
        return None

    messages = parsed.get("messages")
    if not isinstance(messages, list) or len(messages) == 0:
        return None

    return parsed


def _validate_messages(messages: Any) -> bool:
    """Validate that messages is a well-formed list of {role, content} dicts."""

    if not isinstance(messages, list) or len(messages) == 0:
        return False

    for msg in messages:
        if not isinstance(msg, dict):
            return False
        if "role" not in msg or "content" not in msg:
            return False

    return True


class AIServicesService:
    @classmethod
    def from_env(cls) -> "AIServicesService":
        config = env.ai_services

        if not config.enabled:
            return cls(config=config, client=None)

        api_url = config.normalized_api_url
        api_key = config.api_key

        # enabled implies these exist, but keep this defensive.
        if not api_url or not api_key:
            return cls(config=config, client=None)

        client = AgentaAIServicesClient(
            api_url=api_url,
            api_key=api_key,
        )

        return cls(config=config, client=client)

    def __init__(
        self,
        *,
        config: AIServicesConfig,
        client: Optional[AgentaAIServicesClient] = None,
    ):
        self.config = config
        self.client = client

    @property
    def enabled(self) -> bool:
        return self.config.enabled

    def status(self, *, allow_tools: bool) -> AIServicesStatus:
        if not self.enabled:
            return AIServicesStatus(enabled=False, tools=[])

        if not allow_tools:
            return AIServicesStatus(enabled=True, tools=[])

        return AIServicesStatus(
            enabled=True,
            tools=[
                ToolDefinition(
                    name=TOOL_REFINE_PROMPT,
                    title="Refine Prompt",
                    description=(
                        "Refine a prompt template. Input is a stringified JSON prompt "
                        "template; output is a refined version with the same structure."
                    ),
                    inputSchema=_REFINE_PROMPT_INPUT_SCHEMA,
                    outputSchema=_REFINE_PROMPT_OUTPUT_SCHEMA,
                )
            ],
        )

    async def call_tool(
        self, *, name: str, arguments: Dict[str, Any]
    ) -> ToolCallResponse:
        if name != TOOL_REFINE_PROMPT:
            raise ValueError(f"Unknown tool: {name}")

        args = RefinePromptArguments.model_validate(arguments)

        return await self.refine_prompt(
            prompt_template_json=args.prompt_template_json,
            guidelines=args.guidelines,
            context=args.context,
        )

    async def refine_prompt(
        self,
        *,
        prompt_template_json: str,
        guidelines: Optional[str] = None,
        context: Optional[str] = None,
    ) -> ToolCallResponse:
        if not self.enabled:
            return ToolCallResponse(
                isError=True,
                content=[ToolCallTextContent(text="AI services are not configured.")],
            )

        if not self.client:
            return ToolCallResponse(
                isError=True,
                content=[
                    ToolCallTextContent(text="AI services client is not available.")
                ],
            )

        outputs, trace_id = await self.client.invoke_deployed_prompt(
            application_slug=str(self.config.refine_prompt_app),
            environment_slug=str(self.config.environment),
            inputs={
                "__ag_prompt_template_json": prompt_template_json,
                "__ag_guidelines": guidelines or "",
                "__ag_context": context or "",
            },
        )

        # Upstream failure is encoded into outputs as a dict with _error flag
        if isinstance(outputs, dict) and outputs.get("_error"):
            detail = outputs.get("detail")
            msg = "AI refine failed."
            if isinstance(detail, str) and detail.strip():
                msg = detail
            elif isinstance(detail, dict):
                msg = str(detail.get("detail") or detail.get("message") or msg)

            return ToolCallResponse(
                isError=True,
                content=[ToolCallTextContent(text=msg)],
                meta=ToolCallMeta(trace_id=trace_id),
            )

        # Extract and validate structured output
        structured = _extract_structured_output(outputs)
        if not structured:
            log.warning(
                "[ai-services] Failed to extract structured output",
                outputs_type=type(outputs).__name__,
            )
            return ToolCallResponse(
                isError=True,
                content=[
                    ToolCallTextContent(
                        text="AI refine returned an unexpected response format."
                    )
                ],
                meta=ToolCallMeta(trace_id=trace_id),
            )

        messages = structured["messages"]

        # Validate the messages array
        if not _validate_messages(messages):
            log.warning(
                "[ai-services] messages array is not valid",
            )
            return ToolCallResponse(
                isError=True,
                content=[
                    ToolCallTextContent(
                        text="AI refine returned an invalid messages array."
                    )
                ],
                meta=ToolCallMeta(trace_id=trace_id),
            )

        summary = structured.get("summary", "Prompt refined successfully.")

        return ToolCallResponse(
            isError=False,
            content=[ToolCallTextContent(text=summary)],
            structuredContent=structured,
            meta=ToolCallMeta(trace_id=trace_id),
        )
