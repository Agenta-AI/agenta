"""Apply fixed provider-specific fields to relayed request bodies, and carry Gemini
thought signatures in tool call ids."""

import json
import mimetypes
from typing import Any, Dict, List, Optional

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


# Gemini refuses a chat completion whose current turn holds a tool call without the
# `thought_signature` the model returned with it (HTTP 400). Most OpenAI-compatible
# clients, Pi among them, drop the `extra_content` that carries it but send the tool call
# id back, so the gateway appends the signature to the id in the response and splits it
# back out on the next request. The separator is LiteLLM's.
THOUGHT_SIGNATURE_SEPARATOR = "__thought__"


def is_gemini_chat(
    deployment_kind: LLMDeploymentKind,
    protocol: LLMProtocol,
    provider_key: Optional[str],
) -> bool:
    return protocol == LLMProtocol.CHAT_COMPLETIONS and (
        deployment_kind == LLMDeploymentKind.VERTEX
        or (deployment_kind == LLMDeploymentKind.DIRECT and provider_key == "gemini")
    )


def encode_thought_signatures(payload: Any) -> bool:
    """Append each Gemini thought signature to its tool call id, in a parsed chunk or
    body, so a client that keeps only the id sends the signature back."""
    encoded = False
    choices = payload.get("choices") if isinstance(payload, dict) else None
    for choice in choices if isinstance(choices, list) else []:
        part = (
            (choice.get("delta") or choice.get("message"))
            if isinstance(choice, dict)
            else None
        )
        for call in (part.get("tool_calls") if isinstance(part, dict) else None) or []:
            extra = call.get("extra_content") if isinstance(call, dict) else None
            google = extra.get("google") if isinstance(extra, dict) else None
            signature = (
                google.get("thought_signature") if isinstance(google, dict) else None
            )
            if signature and call.get("id"):
                call["id"] = f"{call['id']}{THOUGHT_SIGNATURE_SEPARATOR}{signature}"
                encoded = True
    return encoded


def _split_thought_signatures(messages: List[Any], *, restore: bool) -> bool:
    """Cut the signature off every tool call id and tool result id. With `restore`, put
    it back on the call where Gemini reads it; without, drop it for a model that never
    asked for it and may cap the id's length."""
    split = False
    for message in messages:
        if not isinstance(message, dict):
            continue
        call_id = message.get("tool_call_id")
        if isinstance(call_id, str) and THOUGHT_SIGNATURE_SEPARATOR in call_id:
            message["tool_call_id"] = call_id.split(THOUGHT_SIGNATURE_SEPARATOR, 1)[0]
            split = True
        for call in message.get("tool_calls") or []:
            call_id = call.get("id") if isinstance(call, dict) else None
            if isinstance(call_id, str) and THOUGHT_SIGNATURE_SEPARATOR in call_id:
                call["id"], signature = call_id.split(THOUGHT_SIGNATURE_SEPARATOR, 1)
                if restore:
                    call["extra_content"] = {"google": {"thought_signature": signature}}
                split = True
    return split


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
    signed = _split_thought_signatures(messages, restore=True)
    inlined = _inline_file_parts(messages)
    return json.dumps(payload).encode() if signed or inlined else body


# Fields OpenAI clients send that Google's OpenAI-compatible endpoint refuses outright
# ("Unknown name"). Pi's OpenAI client sends `store: false` on every call.
_GOOGLE_OPENAI_UNKNOWN_FIELDS = ("store",)


def _rewrite_google_chat(body: bytes) -> bytes:
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, TypeError):
        return body
    if not isinstance(payload, dict):
        return body
    dropped = [payload.pop(f) for f in _GOOGLE_OPENAI_UNKNOWN_FIELDS if f in payload]
    messages = payload.get("messages")
    signed = isinstance(messages, list) and _split_thought_signatures(
        messages, restore=True
    )
    return json.dumps(payload).encode() if dropped or signed else body


def _strip_thought_signatures(body: bytes) -> bytes:
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, TypeError):
        return body
    messages = payload.get("messages") if isinstance(payload, dict) else None
    if isinstance(messages, list) and _split_thought_signatures(
        messages, restore=False
    ):
        return json.dumps(payload).encode()
    return body


def apply_static_fields(
    *,
    deployment_kind: LLMDeploymentKind,
    protocol: LLMProtocol,
    body: bytes,
    provider_key: Optional[str] = None,
) -> bytes:
    """Apply the deployment rewrite to Messages JSON without overwriting supplied values,
    and make a Gemini chat completion one Gemini accepts: tool calls get back the thought
    signature their ids carry, on Vertex and on Google's own OpenAI-compatible endpoint;
    on Vertex `file` parts become data URLs, and on Google's endpoint fields it refuses
    are dropped. Any other chat completion loses the signatures in its ids, after a
    session moves off Gemini."""
    if protocol == LLMProtocol.CHAT_COMPLETIONS:
        if deployment_kind == LLMDeploymentKind.VERTEX:
            return _rewrite_vertex_chat(body)
        if deployment_kind == LLMDeploymentKind.DIRECT and provider_key == "gemini":
            return _rewrite_google_chat(body)
        if THOUGHT_SIGNATURE_SEPARATOR.encode() in body:
            return _strip_thought_signatures(body)
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
