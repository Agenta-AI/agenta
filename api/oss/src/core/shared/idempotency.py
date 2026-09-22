import hashlib
import json
from typing import Optional
from uuid import UUID, uuid5

from pydantic import BaseModel


_RESOURCE_NAMESPACE = UUID("1a470a9e-e428-4eb0-8f19-a6d52b7689e8")


def resource_identity(
    project_id: UUID,
    namespace: str,
    key: str,
    component: str,
) -> UUID:
    return uuid5(_RESOURCE_NAMESPACE, f"{project_id}:{namespace}:{key}:{component}")


def idempotent_workflow_slug(*, slug: Optional[str], workflow_id: UUID) -> str:
    """The slug an idempotent workflow create produces for ``workflow_id``.

    Shared so a caller that plans a reference and the creator that writes it cannot disagree:
    they did, above 48 characters, and the mismatch raised on every retry of a load that had
    already created the workflow.
    """
    prefix = (slug or "workflow").strip("-")[:48]
    return f"{prefix or 'workflow'}-{workflow_id.hex[:8]}"


def request_key_hash(key: str) -> str:
    return "sha256:" + hashlib.sha256(key.encode("utf-8")).hexdigest()


def request_fingerprint(payload: BaseModel | dict) -> str:
    value = (
        payload.model_dump(mode="json", exclude_none=True)
        if isinstance(payload, BaseModel)
        else payload
    )
    encoded = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()
