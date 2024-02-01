from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from beanie import Document, Link, PydanticObjectId, free_fall_migration


# Common Models
class InvitationDB(BaseModel):
    token: str = Field(unique=True)
    email: str
    expiration_date: datetime = Field(default="0")
    used: bool = False


class OrganizationDB(Document):
    name: str = Field(default="agenta")
    description: str = Field(default="")
    type: Optional[str]
    owner: str  # user id
    members: Optional[List[PydanticObjectId]]
    invitations: Optional[List[InvitationDB]] = []
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "organizations"


class UserDB(Document):
    uid: str = Field(default="0", unique=True, index=True)
    username: str = Field(default="agenta")
    email: str = Field(default="demo@agenta.ai", unique=True)
    organizations: Optional[List[PydanticObjectId]] = []
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "users"


class ImageDB(Document):
    """Defines the info needed to get an image and connect it to the app variant"""

    type: Optional[str] = Field(default="image")
    template_uri: Optional[str]
    docker_id: Optional[str] = Field(index=True)
    tags: Optional[str]
    deletable: bool = Field(default=True)
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "docker_images"


class AppDB(Document):
    app_name: str
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "app_db"


class DeploymentDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    container_name: Optional[str]
    container_id: Optional[str]
    uri: Optional[str]
    status: str
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "deployments"


class VariantBaseDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    base_name: str
    image: Link[ImageDB]
    deployment: Optional[PydanticObjectId]  # Link to deployment
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "bases"


class ConfigDB(BaseModel):
    config_name: str
    parameters: Dict[str, Any] = Field(default_factory=dict)


class AppVariantDB(Document):
    app: Link[AppDB]
    variant_name: str
    revision: int
    image: Link[ImageDB]
    user: Link[UserDB]
    modified_by: Link[UserDB]
    organization: Link[OrganizationDB]
    parameters: Dict[str, Any] = Field(default=dict)  # TODO: deprecated. remove
    previous_variant_name: Optional[str]  # TODO: deprecated. remove
    base_name: Optional[str]
    base: Link[VariantBaseDB]
    config_name: Optional[str]
    config: ConfigDB
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    is_deleted: bool = Field(  # TODO: deprecated. remove
        default=False
    )  # soft deletion for using the template variants

    class Settings:
        name = "app_variants"


class AppVariantRevisionsDB(Document):
    variant: Link[AppVariantDB]
    revision: int
    modified_by: Link[UserDB]
    base: Link[VariantBaseDB]
    config: ConfigDB
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "app_variant_revisions"


class AppEnvironmentDB(Document):
    app: Link[AppDB]
    name: str
    user: Link[UserDB]
    revision: int
    organization: Link[OrganizationDB]
    deployed_app_variant: Optional[PydanticObjectId]
    deployed_app_variant_revision: Optional[Link[AppVariantRevisionsDB]]
    deployment: Optional[PydanticObjectId]  # reference to deployment
    created_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "environments"


# New Models
class AppEnvironmentRevisionDB(Document):
    environment: Link[AppEnvironmentDB]
    revision: int
    modified_by: Link[UserDB]
    deployed_app_variant_revision: Optional[PydanticObjectId]
    deployment: Optional[PydanticObjectId]  # reference to deployment
    created_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "environments_revisions"


class Forward:
    @free_fall_migration(
        document_models=[
            OrganizationDB,
            UserDB,
            ImageDB,
            AppDB,
            DeploymentDB,
            VariantBaseDB,
            AppVariantDB,
            AppVariantRevisionsDB,
            AppEnvironmentDB,
            AppEnvironmentRevisionDB,
        ]
    )
    async def create_environment_revision_for_app_environments(self, session):
        app_environments = await AppEnvironmentDB.find(fetch_links=True).to_list()
        for app_environment in app_environments:
            if app_environment.deployed_app_variant_revision is not None:
                deployed_app_variant_revision = (
                    app_environment.deployed_app_variant_revision.id
                )
            else:
                deployed_app_variant_revision = None
            app_environment_revision = AppEnvironmentRevisionDB(
                environment=app_environment,
                revision=app_environment.revision,
                modified_by=app_environment.user,
                deployed_app_variant_revision=deployed_app_variant_revision,
                deployment=app_environment.deployment,
            )
            await app_environment_revision.create(session=session)


class Backward:
    @free_fall_migration(
        document_models=[
            OrganizationDB,
            UserDB,
            ImageDB,
            AppDB,
            DeploymentDB,
            VariantBaseDB,
            AppVariantDB,
            AppVariantRevisionsDB,
            AppEnvironmentDB,
            AppEnvironmentRevisionDB,
        ]
    )
    async def delete_environment_revision_for_app_environments(self, session):
        app_environments = await AppEnvironmentDB.find(fetch_links=True).to_list()
        for app_environment in app_environments:
            app_environment_revision = await AppEnvironmentRevisionDB.find_one(
                AppEnvironmentRevisionDB.environment.id == app_environment.id
            )
            if app_environment_revision is not None:
                await app_environment_revision.delete(session=session)
