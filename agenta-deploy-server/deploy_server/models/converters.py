"""Converts db models to pydantic models
"""
from deploy_server.models.db_models import AppVariantDB, ImageDB
from deploy_server.models.api.api_models import AppVariant, Image


def app_variant_db_to_pydantic(app_variant_db: AppVariantDB) -> AppVariant:
    return AppVariant(app_name=app_variant_db.app_name, variant_name=app_variant_db.variant_name)


def image_db_to_pydantic(image_db: ImageDB) -> Image:
    return Image(docker_id=image_db.docker_id, tags=image_db.tags)
