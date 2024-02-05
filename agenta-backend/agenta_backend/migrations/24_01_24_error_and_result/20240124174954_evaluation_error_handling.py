from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from beanie import iterative_migration, Document, Link, PydanticObjectId


#### Old Schemas ####
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


class UserDB(Document):
    uid: str = Field(default="0", unique=True, index=True)
    username: str = Field(default="agenta")
    email: str = Field(default="demo@agenta.ai", unique=True)
    organizations: Optional[List[PydanticObjectId]] = []
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "users"


class AppDB(Document):
    app_name: str
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "app_db"


class TestSetDB(Document):
    name: str
    app: Link[AppDB]
    csvdata: List[Dict[str, str]]
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "testsets"


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


class Result(BaseModel):
    type: str
    value: Any


class AggregatedResult(BaseModel):
    evaluator_config: PydanticObjectId
    result: Result


class EvaluationDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    status: str = Field(default="EVALUATION_INITIALIZED")
    testset: Link[TestSetDB]
    variant: PydanticObjectId
    evaluators_configs: List[PydanticObjectId]
    aggregated_results: List[AggregatedResult]
    created_at: datetime = Field(default=datetime.now())
    updated_at: datetime = Field(default=datetime.now())

    class Settings:
        name = "new_evaluations"


#### New Schemas ####
class Error(BaseModel):
    message: str
    stacktrace: Optional[str] = None


class NewResult(BaseModel):
    type: str
    value: Optional[Any] = None
    error: Optional[Error] = None


class NewEvaluationDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    status: NewResult
    testset: Link[TestSetDB]
    variant: PydanticObjectId
    evaluators_configs: List[PydanticObjectId]
    aggregated_results: List[AggregatedResult]
    created_at: datetime = Field(default=datetime.now())
    updated_at: datetime = Field(default=datetime.now())

    class Settings:
        name = "new_evaluations"


class Forward:
    @iterative_migration(
        document_models=[
            OrganizationDB,
            AppDB,
            UserDB,
            TestSetDB,
            EvaluatorConfigDB,
            EvaluationDB,
            NewEvaluationDB,
        ]
    )
    async def migrate_evaluation_status(
        self, input_document: EvaluationDB, output_document: NewEvaluationDB
    ):
        output_document.status = NewResult(type="status", value=input_document.status)


class Backward:
    @iterative_migration(
        document_models=[
            OrganizationDB,
            AppDB,
            UserDB,
            TestSetDB,
            EvaluatorConfigDB,
            EvaluationDB,
            NewEvaluationDB,
        ]
    )
    async def revert_evaluation_status(
        self, input_document: NewEvaluationDB, output_document: EvaluationDB
    ):
        output_document.status = input_document.status.value  # type: ignore
