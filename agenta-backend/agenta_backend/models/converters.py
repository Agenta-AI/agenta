"""Converts db models to pydantic models
"""
from typing import List
from agenta_backend.models.db_models import (
    AppVariantDB,
    ImageDB,
    TemplateDB,
    AppDB,
    EnvironmentDB,
)
from agenta_backend.models.api.api_models import (
    AppVariant,
    ImageExtended,
    Template,
    TemplateImageInfo,
    AppVariantOutput,
    App,
    EnvironmentOutput,
)

import logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


def app_variant_db_to_pydantic(
    app_variant_db: AppVariantDB, previous_variant_name: str = None
) -> AppVariant:
    return AppVariant(
        app_id=str(app_variant_db.id),
        variant_name=app_variant_db.variant_name,
        parameters=app_variant_db.parameters,
        previous_variant_name=app_variant_db.previous_variant_name,
        organization_id=app_variant_db.organization_id,
    )


def app_variant_db_to_output(app_variant_db: AppVariantDB) -> AppVariantOutput:
    return AppVariantOutput(
        app_id=str(app_variant_db.app_id.id),
        variant_name=app_variant_db.variant_name,
        variant_id=str(app_variant_db.id),
        user_id=str(app_variant_db.user_id.id),
        organization_id=str(app_variant_db.organization_id.id),
        parameters=app_variant_db.parameters,
        previous_variant_name=app_variant_db.previous_variant_name,
        base_name=app_variant_db.base_name,
        base_id=str(app_variant_db.base_id.id),
        config_name=app_variant_db.config_name,
        config_id=str(app_variant_db.config_id.id),
    )


def environment_db_to_output(environment_db: EnvironmentDB) -> EnvironmentOutput:
    deployed_app_variant_id = (
        str(environment_db.deployed_app_variant_ref)
        if environment_db.deployed_app_variant_ref
        else None
    )
    return EnvironmentOutput(
        name=environment_db.name,
        app_id=str(environment_db.app_id.id),
        deployed_app_variant_id=deployed_app_variant_id,
    )


def app_db_to_pydantic(app_db: AppDB) -> App:
    return App(app_name=app_db.app_name, app_id=str(app_db.id))


def image_db_to_pydantic(image_db: ImageDB) -> ImageExtended:
    return ImageExtended(
        organization_id=image_db.organization_id,
        docker_id=image_db.docker_id,
        tags=image_db.tags,
        id=str(image_db.id),
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
