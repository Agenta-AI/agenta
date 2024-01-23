from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from beanie import Document, Link, PydanticObjectId, free_fall_migration

# Old models


class APIKeyDB(Document):
    prefix: str
    hashed_key: str
    user_id: str
    rate_limit: int = Field(default=0)
    hidden: Optional[bool] = Field(default=False)
    expiration_date: Optional[datetime]
    created_at: Optional[datetime] = datetime.utcnow()
    updated_at: Optional[datetime]

    class Settings:
        name = "api_keys"


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


class ConfigVersionDB(BaseModel):
    version: int
    parameters: Dict[str, Any]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())


class OldConfigDB(Document):
    config_name: str
    current_version: int = Field(default=1)
    parameters: Dict[str, Any] = Field(default=dict)
    version_history: List[ConfigVersionDB] = Field(default=[])
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "configs"


class AppVariantDB(Document):
    app: Link[AppDB]
    variant_name: str
    image: Link[ImageDB]
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    parameters: Dict[str, Any] = Field(default=dict)  # TODO: deprecated. remove
    previous_variant_name: Optional[str]  # TODO: deprecated. remove
    base_name: Optional[str]
    base: Link[VariantBaseDB]
    config_name: Optional[str]
    config: Link[OldConfigDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    is_deleted: bool = Field(  # TODO: deprecated. remove
        default=False
    )  # soft deletion for using the template variants

    class Settings:
        name = "app_variants"


class AppEnvironmentDB(Document):
    app: Link[AppDB]
    name: str
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    deployed_app_variant: Optional[PydanticObjectId]
    deployment: Optional[PydanticObjectId]  # reference to deployment
    created_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "app_environment_db"


class TestSetDB(Document):
    name: str
    app: Link[AppDB]
    csvdata: List[Dict[str, str]]
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "testsets"



# New models
class ConfigDB(BaseModel):
    config_name: str
    parameters: Dict[str, Any] = Field(default=dict)


class NewAppVariantDB(Document):
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


class Forward:
    @free_fall_migration(
        document_models=[
            AppDB,
            UserDB,
            OrganizationDB,
            ImageDB,
            VariantBaseDB,
            OldConfigDB,
            AppVariantDB,
            NewAppVariantDB,
        ]
    )
    async def migrate_old_app_variants_to_new_format(self, session):
        old_app_variants = await AppVariantDB.find(fetch_links=True).to_list()
        for old_app_variant in old_app_variants:
            # Create variables for configuration data
            old_config_name = old_app_variant.config.config_name
            old_config_parameters = old_app_variant.config.parameters

            # Construct the new configuration object
            new_config = ConfigDB(
                config_name=old_config_name,
                parameters=old_config_parameters,
            )

            # Create the new app variant object, reusing values
            new_app_variant = NewAppVariantDB(
                id=old_app_variant.id,
                variant_name=old_app_variant.variant_name,
                app=old_app_variant.app,
                revision=1,
                image=old_app_variant.image,
                user=old_app_variant.user,
                modified_by=old_app_variant.user,
                organization=old_app_variant.organization,
                base_name=old_app_variant.base_name,
                base=old_app_variant.base,
                config_name=old_config_name,
                config=new_config,
            )
            await new_app_variant.replace(session=session)


class Backward:
    pass