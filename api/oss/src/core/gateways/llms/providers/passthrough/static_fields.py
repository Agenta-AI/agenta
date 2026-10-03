"""Apply fixed provider-specific fields to relayed request bodies."""

import json
import mimetypes
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


def _fill_thought_signatures(messages: List[Any]) -> bool:
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
    return filled


# Vertex's chat completions refuse an OpenAI `file` content part ("Unrecognized 'type'
# field") but read the same document as an `image_url` data URL, PDFs included. A part
# that names an OpenAI file id has no data to carry and is relayed as it came.
def _inline_file_parts(messages: List[Any]) -> bool:
    inlined = False
    for message in messages:
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, list):
            continue
        for index, part in enumerate(content):
            if not isinstance(part, dict) or part.get("type") != "file":
                continue
            file = part.get("file")
            data = file.get("file_data") if isinstance(file, dict) else None
            if not isinstance(data, str) or not data:
                continue
            if not data.startswith("data:"):
                mime = mimetypes.guess_type(file.get("filename") or "")[0]
                data = f"data:{mime or 'application/pdf'};base64,{data}"
            content[index] = {"type": "image_url", "image_url": {"url": data}}
            inlined = True
    return inlined


def _rewrite_vertex_chat(body: bytes) -> bytes:
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, TypeError):
        return body
    messages = payload.get("messages") if isinstance(payload, dict) else None
    if not isinstance(messages, list):
        return body
    signed = _fill_thought_signatures(messages)
    inlined = _inline_file_parts(messages)
    return json.dumps(payload).encode() if signed or inlined else body


def apply_static_fields(
    *, deployment_kind: LLMDeploymentKind, protocol: LLMProtocol, body: bytes
) -> bytes:
    """Apply the deployment rewrite to Messages JSON without overwriting supplied values,
    and make a Vertex chat completion one Gemini accepts: unsigned tool calls get the
    signature it requires, and `file` parts become data URLs."""
    if deployment_kind == LLMDeploymentKind.VERTEX and protocol == (
        LLMProtocol.CHAT_COMPLETIONS
    ):
        return _rewrite_vertex_chat(body)
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
