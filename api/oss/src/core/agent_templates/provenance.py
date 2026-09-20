import copy
from typing import Any

from pydantic import ValidationError

from oss.src.core.agent_templates.dtos import (
    InternalTemplateSource,
    ResolvedTemplateSource,
    TemplateSourcePin,
)
from oss.src.core.agent_templates.exceptions import TemplateProvenanceInvalid

_PLATFORM_META_KEY = "_ag"


def template_origin_meta(resolved: ResolvedTemplateSource) -> dict[str, Any]:
    return {
        _PLATFORM_META_KEY: {
            "template_origin": {
                "kind": resolved.source.kind,
                "key": resolved.source.key,
                "version": resolved.version,
                "digest": resolved.digest,
            }
        }
    }


def create_request_meta(*, key_hash: str, request_fingerprint: str) -> dict[str, Any]:
    return {
        _PLATFORM_META_KEY: {
            "create_request": {
                "namespace": "agent-template-load",
                "key_hash": key_hash,
                "request_fingerprint": request_fingerprint,
            }
        }
    }


def merge_platform_meta(
    existing: dict[str, Any] | None,
    *updates: dict[str, Any],
) -> dict[str, Any]:
    merged = copy.deepcopy(existing or {})
    agenta = merged.get(_PLATFORM_META_KEY)
    if agenta is None:
        agenta = {}
    if not isinstance(agenta, dict):
        raise TemplateProvenanceInvalid()
    agenta = copy.deepcopy(agenta)
    for update in updates:
        incoming = update.get(_PLATFORM_META_KEY)
        if not isinstance(incoming, dict):
            raise TemplateProvenanceInvalid()
        agenta.update(copy.deepcopy(incoming))
    merged[_PLATFORM_META_KEY] = agenta
    return merged


def read_create_request(meta: dict[str, Any] | None) -> dict[str, str] | None:
    if meta is None:
        return None
    if not isinstance(meta, dict):
        raise TemplateProvenanceInvalid()
    agenta = meta.get(_PLATFORM_META_KEY)
    if agenta is None:
        return None
    if not isinstance(agenta, dict):
        raise TemplateProvenanceInvalid()
    request = agenta.get("create_request")
    if request is None:
        return None
    if not isinstance(request, dict):
        raise TemplateProvenanceInvalid()
    required = {"namespace", "key_hash", "request_fingerprint"}
    if (
        set(request) != required
        or request.get("namespace") != "agent-template-load"
        or not isinstance(request.get("key_hash"), str)
        or not request["key_hash"]
        or not isinstance(request.get("request_fingerprint"), str)
        or not request["request_fingerprint"]
    ):
        raise TemplateProvenanceInvalid()
    return copy.deepcopy(request)


def read_template_origin(meta: dict[str, Any] | None) -> dict[str, Any] | None:
    if meta is None:
        return None
    if not isinstance(meta, dict):
        raise TemplateProvenanceInvalid()
    agenta = meta.get(_PLATFORM_META_KEY)
    if agenta is None:
        return None
    if not isinstance(agenta, dict):
        raise TemplateProvenanceInvalid()
    origin = agenta.get("template_origin")
    if origin is None:
        return None
    if not isinstance(origin, dict):
        raise TemplateProvenanceInvalid()
    required = {"kind", "key", "version", "digest"}
    if set(origin) != required or not all(
        isinstance(origin[key], str) and origin[key] for key in required
    ):
        raise TemplateProvenanceInvalid()
    try:
        InternalTemplateSource(kind=origin["kind"], key=origin["key"])
        TemplateSourcePin(version=origin["version"], digest=origin["digest"])
    except ValidationError as exc:
        raise TemplateProvenanceInvalid() from exc
    return copy.deepcopy(origin)
