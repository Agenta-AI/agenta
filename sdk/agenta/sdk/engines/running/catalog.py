from copy import deepcopy
from typing import Any, Optional

from agenta.sdk.engines.running.utils import (
    INTERFACE_REGISTRY,
    _AGENTA_ROLE_TABLE,
)


def _humanize_key(key: str) -> str:
    return key.replace("_", " ").replace("-", " ").title()


def _clone(value: Any) -> Any:
    return deepcopy(value)


def _infer_flags(*, kind: str, key: str) -> dict[str, Any]:
    is_application, is_evaluator, is_snippet = _AGENTA_ROLE_TABLE[(kind, key)]
    return {
        "is_archived": False,
        "is_recommended": False,
        "is_application": is_application,
        "is_evaluator": is_evaluator,
        "is_snippet": is_snippet,
    }


def _build_entry(*, kind: str, key: str, interface: Any) -> dict[str, Any]:
    schemas = (
        interface.schemas.model_dump(mode="json", exclude_none=True)
        if interface.schemas
        else None
    )

    return {
        "key": key,
        "name": _humanize_key(key),
        "description": (
            schemas.get("parameters", {}).get("description")
            if isinstance(schemas, dict)
            else None
        )
        or f"Managed Agenta workflow for `{interface.uri}`.",
        "categories": [kind],
        "flags": _infer_flags(kind=kind, key=key),
        "data": {
            "uri": interface.uri,
            "schemas": schemas,
        },
        "presets": [],
    }


def build_agenta_catalog() -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    agenta_registry = INTERFACE_REGISTRY.get("agenta") or {}

    for kind, keys in agenta_registry.items():
        for key, versions in keys.items():
            for _version, interface in versions.items():
                entries.append(_build_entry(kind=kind, key=key, interface=interface))

    return entries


catalog = build_agenta_catalog()


def get_all_catalog_templates() -> list[dict[str, Any]]:
    return _clone(catalog)


def get_filtered_catalog_templates(
    *,
    is_application: Optional[bool] = None,
    is_evaluator: Optional[bool] = None,
    is_snippet: Optional[bool] = None,
) -> list[dict[str, Any]]:
    return [
        entry
        for entry in get_all_catalog_templates()
        if _matches_flags(
            entry,
            is_application=is_application,
            is_evaluator=is_evaluator,
            is_snippet=is_snippet,
        )
    ]


def get_catalog_template(
    *,
    template_key: str,
    is_application: Optional[bool] = None,
    is_evaluator: Optional[bool] = None,
    is_snippet: Optional[bool] = None,
) -> Optional[dict[str, Any]]:
    return next(
        (
            entry
            for entry in get_filtered_catalog_templates(
                is_application=is_application,
                is_evaluator=is_evaluator,
                is_snippet=is_snippet,
            )
            if entry["key"] == template_key
        ),
        None,
    )


def _matches_flags(
    entry: dict[str, Any],
    *,
    is_application: Optional[bool],
    is_evaluator: Optional[bool],
    is_snippet: Optional[bool],
) -> bool:
    flags = entry["flags"]
    if is_application is not None and flags["is_application"] != is_application:
        return False
    if is_evaluator is not None and flags["is_evaluator"] != is_evaluator:
        return False
    if is_snippet is not None and flags["is_snippet"] != is_snippet:
        return False
    return True
