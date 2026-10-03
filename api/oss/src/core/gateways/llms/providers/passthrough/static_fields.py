"""Apply fixed provider-specific fields to relayed request bodies."""

import json
from typing import Any, Dict, List

from pydantic import BaseModel, Field

from oss.src.core.gateways.llms.dtos import LLMDeploymentKind, LLMProtocol


class LLMStaticFieldRewrite(BaseModel):
    fields_added: Dict[str, Any] = Field(default_factory=dict)
    fields_removed: List[str] = Field(default_factory=list)


# Vertex Anthropic Messages uses `anthropic_version` in the body and the model in the URL.
STATIC_FIELD_REWRITES: Dict[LLMDeploymentKind, LLMStaticFieldRewrite] = {
    LLMDeploymentKind.VERTEX: LLMStaticFieldRewrite(
        fields_added={"anthropic_version": "vertex-2023-10-16"},
        fields_removed=["model"],
    ),
}


# Gemini on Vertex refuses a chat completion whose history holds an assistant tool call
# without the `thought_signature` the model returned with it (HTTP 400 INVALID_ARGUMENT).
# Most OpenAI-compatible clients, Pi among them, drop the `extra_content` that carries it.
# Google documents this value for a history that has no signature: it skips the check, at
# some cost to the model's reasoning across tool calls. A signature the client did keep is
# relayed as it came.
GEMINI_SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator"


def _fill_thought_signatures(body: bytes) -> bytes:
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, TypeError):
        return body
    messages = payload.get("messages") if isinstance(payload, dict) else None
    if not isinstance(messages, list):
        return body
    filled = False
    for message in messages:
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        for call in message.get("tool_calls") or []:
            if not isinstance(call, dict):
                continue
            extra = call.get("extra_content")
            google = extra.get("google") if isinstance(extra, dict) else None
            if isinstance(google, dict) and google.get("thought_signature"):
                continue
            call["extra_content"] = {
                **(extra if isinstance(extra, dict) else {}),
                "google": {
                    **(google if isinstance(google, dict) else {}),
                    "thought_signature": GEMINI_SKIP_THOUGHT_SIGNATURE,
                },
            }
            filled = True
    return json.dumps(payload).encode() if filled else body


def apply_static_fields(
    *, deployment_kind: LLMDeploymentKind, protocol: LLMProtocol, body: bytes
) -> bytes:
    """Apply the deployment rewrite to Messages JSON without overwriting supplied values,
    and give a Vertex chat completion's unsigned tool calls the signature Gemini requires."""
    if deployment_kind == LLMDeploymentKind.VERTEX and protocol == (
        LLMProtocol.CHAT_COMPLETIONS
    ):
        return _fill_thought_signatures(body)
    if protocol != LLMProtocol.MESSAGES:
        return body
    rewrite = STATIC_FIELD_REWRITES.get(deployment_kind)
    if rewrite is None:
        return body
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, TypeError):
        return body
    if not isinstance(payload, dict):
        return body
    for key in rewrite.fields_removed:
        payload.pop(key, None)
    for key, value in rewrite.fields_added.items():
        payload.setdefault(key, value)
    return json.dumps(payload).encode()
