"""Converts db models to pydantic models
"""
from typing import List
from agenta_backend.models.db_models import AppVariantDB, ImageDB, TemplateDB
from agenta_backend.models.api.api_models import (
    AppVariant,
    ImageExtended,
    Template,
    TemplateImageInfo,
)


def app_variant_db_to_pydantic(
    app_variant_db: AppVariantDB, previous_variant_name: str = None
) -> AppVariant:
    return AppVariant(
        app_name=app_variant_db.app_name,
        variant_name=app_variant_db.variant_name,
        parameters=app_variant_db.parameters,
        previous_variant_name=app_variant_db.previous_variant_name,
        base_name=app_variant_db.base_name,
        config_name=app_variant_db.config_name,
    )


def image_db_to_pydantic(image_db: ImageDB) -> ImageExtended:
    return ImageExtended(
        docker_id=image_db.docker_id, tags=image_db.tags, id=str(image_db.id)
    )


def templates_db_to_pydantic(templates_db: List[TemplateDB]) -> List[Template]:
    return [
        Template(
            id=template.template_id,
            image=TemplateImageInfo(
                name=template.name,
                size=template.size,
                digest=template.digest,
                title=template.title,
                description=template.description,
                architecture=template.architecture,
                status=template.status,
                last_pushed=template.last_pushed,
                repo_name=template.repo_name,
                media_type=template.media_type,
            ),
        )
        for template in templates_db
    ]
