from copy import deepcopy
from typing import Any, Optional

from oss.src.resources.evaluators.evaluators import evaluators as evaluator_catalog
from oss.src.core.workflows.dtos import (
    WorkflowCatalogType,
    WorkflowCatalogTemplate,
    WorkflowCatalogPreset,
)
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
        "is_archived": preset.get("archived", False),
        "is_recommended": preset.get("recommended", False),
        "is_application": inherited_flags.get("is_application", False),
        "is_evaluator": inherited_flags.get("is_evaluator", False),
        "is_snippet": inherited_flags.get("is_snippet", False),
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
    if metadata.get("archived") is not None:
        flags["is_archived"] = metadata["archived"]
    if metadata.get("recommended") is not None:
        flags["is_recommended"] = metadata["recommended"]

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


def get_workflow_catalog_types() -> list[WorkflowCatalogType]:
    return [
        WorkflowCatalogType(
            key=key,
            json_schema=_clone(json_schema),
        )
        for key, json_schema in CATALOG_TYPES.items()
    ]


def get_workflow_catalog_type(*, ag_type: str) -> Optional[WorkflowCatalogType]:
    json_schema = CATALOG_TYPES.get(ag_type)
    if json_schema is None:
        return None

    return WorkflowCatalogType(
        key=ag_type,
        json_schema=_clone(json_schema),
    )


_catalog: Optional[list[dict[str, Any]]] = None


def _build_catalog() -> list[dict[str, Any]]:
    evaluator_metadata_by_key = _evaluator_metadata_by_key()
    return [
        _enrich_entry(
            entry,
            evaluator_metadata=evaluator_metadata_by_key.get(entry["key"]),
        )
        for entry in get_all_catalog_templates()
    ]


def _get_catalog() -> list[dict[str, Any]]:
    global _catalog
    if _catalog is None:
        _catalog = _build_catalog()

    return _catalog


def _get_workflow_catalog_template_entry(
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
        (entry for entry in _get_catalog() if entry["key"] == sdk_entry["key"]),
        None,
    )


def get_all_workflow_catalog_templates() -> list[dict[str, Any]]:
    return _clone(_get_catalog())


def get_filtered_workflow_catalog_templates(
    *,
    is_application: Optional[bool] = None,
    is_evaluator: Optional[bool] = None,
    is_snippet: Optional[bool] = None,
) -> list[WorkflowCatalogTemplate]:
    return [
        WorkflowCatalogTemplate(**entry)
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
) -> Optional[WorkflowCatalogTemplate]:
    entry = _get_workflow_catalog_template_entry(
        template_key=template_key,
        is_application=is_application,
        is_evaluator=is_evaluator,
        is_snippet=is_snippet,
    )
    return WorkflowCatalogTemplate(**entry) if entry else None


def get_filtered_workflow_catalog_presets(
    *,
    template_key: str,
    is_application: Optional[bool] = None,
    is_evaluator: Optional[bool] = None,
    is_snippet: Optional[bool] = None,
) -> list[WorkflowCatalogPreset]:
    entry = _get_workflow_catalog_template_entry(
        template_key=template_key,
        is_application=is_application,
        is_evaluator=is_evaluator,
        is_snippet=is_snippet,
    )
    if not entry:
        return []

    return [
        WorkflowCatalogPreset(**preset) for preset in _clone(entry.get("presets") or [])
    ]


def get_workflow_catalog_preset(
    *,
    template_key: str,
    preset_key: str,
    is_application: Optional[bool] = None,
    is_evaluator: Optional[bool] = None,
    is_snippet: Optional[bool] = None,
) -> Optional[WorkflowCatalogPreset]:
    return next(
        (
            preset
            for preset in get_filtered_workflow_catalog_presets(
                template_key=template_key,
                is_application=is_application,
                is_evaluator=is_evaluator,
                is_snippet=is_snippet,
            )
            if preset.key == preset_key
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
