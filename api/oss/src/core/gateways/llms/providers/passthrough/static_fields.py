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


def apply_static_fields(
    *, deployment_kind: LLMDeploymentKind, protocol: LLMProtocol, body: bytes
) -> bytes:
    """Apply the deployment rewrite to Messages JSON without overwriting supplied values."""
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
