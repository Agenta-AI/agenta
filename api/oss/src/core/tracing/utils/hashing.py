from hashlib import blake2b
from json import dumps
from typing import Dict, Optional, Tuple, Union
from uuid import UUID

from oss.src.core.tracing.dtos import OTelSpan
from oss.src.core.tracing.utils.attributes import REFERENCE_KEYS


def _trace_id_from_uuid(trace_id: Union[UUID, str]) -> str:
    if isinstance(trace_id, UUID):
        return trace_id.hex
    return UUID(trace_id).hex


def _span_id_from_uuid(span_id: Union[UUID, str]) -> str:
    if isinstance(span_id, UUID):
        return span_id.hex[16:]
    return UUID(span_id).hex[16:]


def extract_references_and_links_from_span(span: OTelSpan) -> Tuple[Dict, Dict]:
    references = {
        ref.attributes["key"]: {
            "id": str(ref.id) if ref.id else None,
            "slug": str(ref.slug) if ref.slug else None,
            "version": str(ref.version) if ref.version else None,
        }
        for ref in span.references or []
        if ref.attributes.get("key") in REFERENCE_KEYS
    }
    links = {
        link.attributes["key"]: {
            "trace_id": _trace_id_from_uuid(link.trace_id),
            "span_id": _span_id_from_uuid(link.span_id),
        }
        for link in span.links or []
        if link.attributes.get("key")
    }
    return references, links


def make_hash_id(
    *,
    references: Optional[Dict[str, Dict[str, str]]] = None,
    links: Optional[Dict[str, Dict[str, str]]] = None,
) -> Optional[str]:
    if not references and not links:
        return None

    payload = dict()
    for k, v in (references or {}).items():
        if k in REFERENCE_KEYS:
            entry = {}
            if v.get("id") is not None:
                entry["id"] = v["id"]
            if v.get("slug") is not None:
                entry["slug"] = v["slug"]
            if v.get("version") is not None:
                entry["version"] = v["version"]
            payload[k] = entry

    for k, v in (links or {}).items():
        payload[k] = {"span_id": v.get("span_id"), "trace_id": v.get("trace_id")}

    hasher = blake2b(digest_size=16)
    serialized = dumps(payload, sort_keys=True).encode("utf-8").replace(b" ", b"")
    hasher.update(serialized)
    return hasher.hexdigest()
