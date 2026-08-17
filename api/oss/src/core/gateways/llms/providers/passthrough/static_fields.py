"""Static field rewrite for the one resold Anthropic wire that still needs it (D40, amends
D34; OD19).

Vertex's `rawPredict` resells the Anthropic Messages wire with one fixed structural
difference: `anthropic_version` must be in the body, `model` must not (it rides the URL).
Bedrock needed the same shape when its Messages door was `InvokeModel`; it no longer does —
the door moved to `bedrock-mantle`, which takes the native Anthropic body untouched (OD19).
The table below is literal — fixed keys, fixed constant values, nothing computed from the
request — and `apply_static_fields` never branches on what those keys or values mean, only on
`deployment_kind` and `protocol`.
"""

import json
from typing import Any, Dict, List

from pydantic import BaseModel

from oss.src.core.gateways.llms.dtos import LLMDeploymentKind, LLMProtocol


class LLMStaticFieldRewrite(BaseModel):
    fields_added: Dict[str, Any] = {}
    fields_removed: List[str] = []


# D40: one literal entry. Both lists are constants — nothing here is derived from a
# request's content, size, or another field's value. Bedrock had an entry here until OD19
# moved its Messages door to bedrock-mantle, which needs no rewrite at all.
STATIC_FIELD_REWRITES: Dict[LLMDeploymentKind, LLMStaticFieldRewrite] = {
    LLMDeploymentKind.VERTEX: LLMStaticFieldRewrite(
        fields_added={"anthropic_version": "vertex-2023-10-16"},
        fields_removed=["model"],
    ),
}


def apply_static_fields(
    *, deployment_kind: LLMDeploymentKind, protocol: LLMProtocol, body: bytes
) -> bytes:
    """Applies the deployment's table entry, if any, on the Messages front door only.

    `fields_added` uses setdefault semantics (mirrors the vendor SDKs): a field the caller
    already sent is left alone, never overwritten. A body this can't parse as a JSON object
    is returned unchanged — that is a policy-parse failure elsewhere, not this function's job.
    """
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
