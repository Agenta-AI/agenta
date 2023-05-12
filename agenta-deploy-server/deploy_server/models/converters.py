"""Converts db models to pydantic models
"""
from deploy_server.models.db_models import AppVersionDB, ImageDB
from deploy_server.models.api_models import AppVersion, Image


def app_version_db_to_pydantic(app_version_db: AppVersionDB) -> AppVersion:
    return AppVersion(app_name=app_version_db.app_name, version_name=app_version_db.version_name)


def image_db_to_pydantic(image_db: ImageDB) -> Image:
    return Image(docker_id=image_db.docker_id, tags=image_db.tags)
