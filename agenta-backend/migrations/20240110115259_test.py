from typing import Optional, List
from pydantic import Field, BaseModel
from datetime import datetime
from beanie import Document, free_fall_migration, Link, PydanticObjectId


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


class AppDB(Document):
    app_name: str
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "app_db"


class ProjectDB(Document):
    project_name: str
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "project"


class Forward:
    @free_fall_migration(document_models=[AppDB, ProjectDB, UserDB, OrganizationDB])
    async def name_to_project(self, session):
        async for app in AppDB.find_all():
            prj = ProjectDB(
                project_name=app.app_name,
                organization=app.organization,
                user=app.user,
                created_at=app.created_at,
                updated_at=app.updated_at,
            )
            await prj.save(session=session)


class Backward:
    @free_fall_migration(document_models=[AppDB, ProjectDB])
    async def project_to_name(self, session):
        async for prj in ProjectDB.find_all():
            app = AppDB(
                name=prj.project_name,
                organization=prj.organization,
                user=prj.user,
                created_at=prj.created_at,
                updated_at=prj.updated_at,
            )
            await app.save(session=session)
