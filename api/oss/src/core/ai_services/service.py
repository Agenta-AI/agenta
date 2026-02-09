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
        "refined_prompt": {
            "type": "string",
            "description": "The refined prompt template as a stringified JSON object.",
        },
        "messages": {
            "type": "array",
            "description": "The refined messages array for verification.",
            "items": {
                "type": "object",
                "properties": {
                    "role": {"type": "string"},
                    "content": {"type": "string"},
                },
            },
        },
    },
    "required": ["refined_prompt", "messages"],
}


def _extract_structured_output(outputs: Any) -> Optional[Dict[str, Any]]:
    """Extract the structured output from the cloud completion runner response.

    The cloud returns ``{"data": "<json-string>", "trace_id": "..."}``
    where ``data`` is a JSON string containing ``refined_prompt`` (stringified
    JSON template) and ``messages`` (verification array).

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

    refined_prompt = parsed.get("refined_prompt")
    if not isinstance(refined_prompt, str) or not refined_prompt.strip():
        return None

    return parsed


def _validate_refined_template(refined_prompt_str: str) -> Optional[Dict[str, Any]]:
    """Validate that refined_prompt is a valid JSON prompt template.

    Returns the parsed template dict if valid, None otherwise.
    """

    try:
        template = json.loads(refined_prompt_str)
    except Exception:  # pylint: disable=broad-exception-caught
        return None

    if not isinstance(template, dict):
        return None

    messages = template.get("messages")
    if not isinstance(messages, list) or len(messages) == 0:
        return None

    for msg in messages:
        if not isinstance(msg, dict):
            return None
        if "role" not in msg or "content" not in msg:
            return None

    return template


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
                "prompt_template_json": prompt_template_json,
                **({"guidelines": guidelines} if guidelines else {}),
                **({"context": context} if context else {}),
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

        refined_prompt_str = structured["refined_prompt"]

        # Validate the refined_prompt is a valid JSON prompt template
        template = _validate_refined_template(refined_prompt_str)
        if not template:
            log.warning(
                "[ai-services] refined_prompt is not a valid JSON prompt template",
            )
            return ToolCallResponse(
                isError=True,
                content=[
                    ToolCallTextContent(
                        text="AI refine returned an invalid prompt template."
                    )
                ],
                meta=ToolCallMeta(trace_id=trace_id),
            )

        return ToolCallResponse(
            isError=False,
            content=[ToolCallTextContent(text=refined_prompt_str)],
            structuredContent=structured,
            meta=ToolCallMeta(trace_id=trace_id),
        )
