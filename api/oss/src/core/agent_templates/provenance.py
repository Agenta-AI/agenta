import copy
from typing import Any

from pydantic import ValidationError

from oss.src.core.agent_templates.dtos import (
    GitHubTemplateSource,
    InternalTemplateSource,
    ResolvedTemplateSource,
    TemplateSourcePin,
)
from oss.src.core.agent_templates.exceptions import TemplateProvenanceInvalid

_ORIGIN_KINDS = {"internal", "upload", "session_file", "github"}
_ORIGIN_FIELDS = {"kind", "key", "version", "digest"}
# A GitHub origin also records where the exact package bytes came from.
_GITHUB_ORIGIN_FIELDS = {"repo_url", "commit", "path"}
_PLATFORM_META_KEY = "_ag"


def template_origin_meta(resolved: ResolvedTemplateSource) -> dict[str, Any]:
    origin = {
        "kind": resolved.source.kind,
        "key": resolved.key,
        "version": resolved.version,
        "digest": resolved.digest,
    }
    if isinstance(resolved.source, GitHubTemplateSource):
        origin.update(
            repo_url=resolved.source.repo_url,
            commit=resolved.source.commit,
            path=resolved.source.path,
        )
    return {_PLATFORM_META_KEY: {"template_origin": origin}}


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
    required = set(_ORIGIN_FIELDS)
    if origin.get("kind") == "github":
        required |= _GITHUB_ORIGIN_FIELDS
    if set(origin) != required or not all(
        isinstance(origin[key], str) and origin[key] for key in required
    ):
        raise TemplateProvenanceInvalid()
    if origin["kind"] not in _ORIGIN_KINDS:
        raise TemplateProvenanceInvalid()
    try:
        # Archive origins record the package name, which follows the catalog key rule.
        InternalTemplateSource(key=origin["key"])
        TemplateSourcePin(version=origin["version"], digest=origin["digest"])
        if origin["kind"] == "github":
            source = GitHubTemplateSource(
                repo_url=origin["repo_url"],
                commit=origin["commit"],
                path=origin["path"],
            )
            # Stored provenance must already be in normalized form.
            if (source.repo_url, source.commit, source.path) != (
                origin["repo_url"],
                origin["commit"],
                origin["path"],
            ):
                raise TemplateProvenanceInvalid()
    except ValidationError as exc:
        raise TemplateProvenanceInvalid() from exc
    return copy.deepcopy(origin)
