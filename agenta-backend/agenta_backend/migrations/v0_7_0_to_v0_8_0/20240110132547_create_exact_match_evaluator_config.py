from datetime import datetime
from typing import Any, Dict, List, Optional


from beanie.operators import In
from pydantic import BaseModel, Field
from beanie import free_fall_migration, Document, Link, PydanticObjectId


class UserDB(Document):
    uid: str = Field(default="0", unique=True, index=True)
    username: str = Field(default="agenta")
    email: str = Field(default="demo@agenta.ai", unique=True)
    organizations: Optional[List[PydanticObjectId]] = []
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "users"


class OrganizationDB(Document):
    name: str = Field(default="agenta")
    description: str = Field(default="")
    type: Optional[str]
    owner: str  # user id
    members: Optional[List[PydanticObjectId]]
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "organizations"


class AppDB(Document):
    app_name: str
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "app_db"


class EvaluatorConfigDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    name: str
    evaluator_key: str
    settings_values: Optional[Dict[str, Any]]
    created_at: datetime = Field(default=datetime.now())
    updated_at: datetime = Field(default=datetime.now())

    class Settings:
        name = "evaluators_configs"


class Forward:
    @free_fall_migration(
        document_models=[AppDB, UserDB, OrganizationDB, EvaluatorConfigDB]
    )
    async def create_default_exact_match_evaluator(self, session):
        apps_db = await AppDB.find(fetch_links=True).to_list()
        for app_db in apps_db:
            eval_exact_match_config = EvaluatorConfigDB(
                app=app_db,
                organization=app_db.organization,
                user=app_db.user,
                name=f"Exact Match",
                evaluator_key="auto_exact_match",
                settings_values={},
            )
            await eval_exact_match_config.insert(session=session)
