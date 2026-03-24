from copy import deepcopy
from typing import Any, Optional

from oss.src.resources.evaluators.evaluators import evaluators as evaluator_catalog
from agenta.sdk.utils.types import CATALOG_TYPES
from agenta.sdk.engines.running.catalog import (
    get_all_catalog_templates,
    get_catalog_template,
)


def _clone(value: Any) -> Any:
    return deepcopy(value)


def _evaluator_metadata_by_key() -> dict[str, dict[str, Any]]:
    return {
        entry["key"]: _clone(entry)
        for entry in evaluator_catalog
        if isinstance(entry.get("key"), str)
    }


def _normalize_preset(
    preset: dict[str, Any],
    *,
    inherited_flags: dict[str, Any],
) -> dict[str, Any]:
    flags = {
        "is_archived": preset.get("archived") or False,
        "is_recommended": preset.get("recommended") or False,
        "is_application": inherited_flags["is_application"],
        "is_evaluator": inherited_flags["is_evaluator"],
        "is_snippet": inherited_flags["is_snippet"],
        **(preset.get("flags") or {}),
    }
    data = preset.get("data")

    return {
        "key": preset["key"],
        "name": preset.get("name"),
        "description": preset.get("description"),
        "categories": _clone(preset.get("categories") or []),
        "flags": flags,
        "data": _clone(data),
    }


def _enrich_entry(
    entry: dict[str, Any], *, evaluator_metadata: Optional[dict[str, Any]]
) -> dict[str, Any]:
    metadata = evaluator_metadata or {}
    flags = _clone(entry["flags"])
    flags.update(metadata.get("flags") or {})
    flags["is_archived"] = metadata.get("archived") or flags["is_archived"]
    flags["is_recommended"] = metadata.get("recommended") or flags["is_recommended"]

    enriched = {
        **_clone(entry),
        "name": metadata.get("name") or entry["name"],
        "description": metadata.get("description") or entry["description"],
        "categories": _clone(
            metadata.get("categories") or metadata.get("tags") or entry["categories"]
        ),
        "flags": flags,
    }

    if metadata:
        enriched_data = _clone(enriched["data"])
        enriched_schemas = _clone(enriched_data.get("schemas") or {})

        settings_template = metadata.get("settings_template")
        outputs_schema = metadata.get("outputs_schema")

        if settings_template is not None:
            enriched_schemas["parameters"] = _clone(settings_template)
        if outputs_schema is not None:
            enriched_schemas["outputs"] = _clone(outputs_schema)

        enriched_data["schemas"] = enriched_schemas
        enriched["data"] = enriched_data

    presets = metadata.get("presets") or metadata.get("settings_presets") or []
    enriched["presets"] = [
        _normalize_preset(
            {
                **preset,
                "data": preset.get("data")
                or {
                    "uri": entry["data"]["uri"],
                    "parameters": preset.get("values") or {},
                },
                "categories": preset.get("categories")
                or preset.get("tags")
                or enriched["categories"],
            },
            inherited_flags=flags,
        )
        for preset in presets
    ]

    return enriched


def get_workflow_catalog_types() -> list[dict[str, Any]]:
    return [
        {
            "key": key,
            "schema": _clone(schema),
        }
        for key, schema in CATALOG_TYPES.items()
    ]


def get_workflow_catalog_type(*, ag_type: str) -> Optional[dict[str, Any]]:
    schema = CATALOG_TYPES.get(ag_type)
    return _clone(schema) if schema is not None else None


catalog = [
    _enrich_entry(
        entry, evaluator_metadata=_evaluator_metadata_by_key().get(entry["key"])
    )
    for entry in get_all_catalog_templates()
]


def get_all_workflow_catalog_templates() -> list[dict[str, Any]]:
    return _clone(catalog)


def get_filtered_workflow_catalog_templates(
    *,
    is_application: Optional[bool] = None,
    is_evaluator: Optional[bool] = None,
    is_snippet: Optional[bool] = None,
) -> list[dict[str, Any]]:
    return [
        entry
        for entry in get_all_workflow_catalog_templates()
        if _matches_flags(
            entry,
            is_application=is_application,
            is_evaluator=is_evaluator,
            is_snippet=is_snippet,
        )
    ]


def get_workflow_catalog_template(
    *,
    template_key: str,
    is_application: Optional[bool] = None,
    is_evaluator: Optional[bool] = None,
    is_snippet: Optional[bool] = None,
) -> Optional[dict[str, Any]]:
    sdk_entry = get_catalog_template(
        template_key=template_key,
        is_application=is_application,
        is_evaluator=is_evaluator,
        is_snippet=is_snippet,
    )
    if not sdk_entry:
        return None
    return next(
        (entry for entry in catalog if entry["key"] == sdk_entry["key"]),
        None,
    )


def get_filtered_workflow_catalog_presets(
    *,
    template_key: str,
    is_application: Optional[bool] = None,
    is_evaluator: Optional[bool] = None,
    is_snippet: Optional[bool] = None,
) -> list[dict[str, Any]]:
    entry = get_workflow_catalog_template(
        template_key=template_key,
        is_application=is_application,
        is_evaluator=is_evaluator,
        is_snippet=is_snippet,
    )
    if not entry:
        return []

    return _clone(entry.get("presets") or [])


def get_workflow_catalog_preset(
    *,
    template_key: str,
    preset_key: str,
    is_application: Optional[bool] = None,
    is_evaluator: Optional[bool] = None,
    is_snippet: Optional[bool] = None,
) -> Optional[dict[str, Any]]:
    return next(
        (
            preset
            for preset in get_filtered_workflow_catalog_presets(
                template_key=template_key,
                is_application=is_application,
                is_evaluator=is_evaluator,
                is_snippet=is_snippet,
            )
            if preset.get("key") == preset_key
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
