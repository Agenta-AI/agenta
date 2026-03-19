from typing import Any, Type, TypeVar

from pydantic import BaseModel

from oss.src.core.workflows.dtos import WorkflowCatalogFlags


CatalogTemplateT = TypeVar("CatalogTemplateT", bound=BaseModel)
CatalogPresetT = TypeVar("CatalogPresetT", bound=BaseModel)


def build_builtin_uri(key: str) -> str:
    return f"agenta:builtin:{key}:v0"


def registry_entry_to_catalog_template(
    *,
    entry: dict[str, Any],
    template_cls: Type[CatalogTemplateT],
) -> CatalogTemplateT:
    return template_cls(
        key=entry["key"],
        name=entry.get("name"),
        description=entry.get("description"),
        categories=entry["categories"],
        flags=WorkflowCatalogFlags(**entry["flags"]),
        data={
            "uri": build_builtin_uri(entry["key"]),
            "schemas": entry["schemas"],
        },
    )


def registry_preset_to_catalog_preset(
    *,
    preset: dict[str, Any],
    uri: str,
    flags: dict[str, Any] | None,
    preset_cls: Type[CatalogPresetT],
) -> CatalogPresetT:
    return preset_cls(
        key=preset["key"],
        name=preset.get("name"),
        description=preset.get("description"),
        categories=preset["categories"],
        flags=WorkflowCatalogFlags(
            **preset["flags"],
            **(flags or {}),
        ),
        data={
            "uri": uri,
            "parameters": preset.get("values") or {},
        },
    )
