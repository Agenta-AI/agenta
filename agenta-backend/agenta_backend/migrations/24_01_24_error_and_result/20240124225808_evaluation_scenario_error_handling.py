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


class EvaluatorConfigDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    name: str
    evaluator_key: str
    settings_values: Optional[Dict[str, Any]]
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

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
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Settings:
        name = "new_evaluations"


class EvaluationScenarioOutputDB(BaseModel):
    type: str
    value: Any


class EvaluationScenarioInputDB(BaseModel):
    name: str
    type: str
    value: str


class EvaluationScenarioResult(BaseModel):
    evaluator_config: PydanticObjectId
    result: Result


class EvaluationScenarioDB(Document):
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    evaluation: Link[EvaluationDB]
    variant_id: PydanticObjectId
    inputs: List[EvaluationScenarioInputDB]
    outputs: List[EvaluationScenarioOutputDB]
    correct_answer: Optional[str]
    is_pinned: Optional[bool]
    note: Optional[str]
    evaluators_configs: List[PydanticObjectId]
    results: List[EvaluationScenarioResult]
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Settings:
        name = "new_evaluation_scenarios"


#### New Schemas ####
class Error(BaseModel):
    message: str
    stacktrace: Optional[str] = None


class NewResult(BaseModel):
    type: str
    value: Optional[Any] = None
    error: Optional[Error] = None


class NewEvaluationScenarioOutputDB(BaseModel):
    result: NewResult


class NewEvaluationDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    status: NewResult
    testset: Link[TestSetDB]
    variant: PydanticObjectId
    evaluators_configs: List[PydanticObjectId]
    aggregated_results: List[AggregatedResult]
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Settings:
        name = "new_evaluations"


class NewEvaluationScenarioDB(Document):
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    evaluation: Link[NewEvaluationDB]
    variant_id: PydanticObjectId
    inputs: List[EvaluationScenarioInputDB]
    outputs: List[NewEvaluationScenarioOutputDB]
    correct_answer: Optional[str]
    is_pinned: Optional[bool]
    note: Optional[str]
    evaluators_configs: List[PydanticObjectId]
    results: List[EvaluationScenarioResult]
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Settings:
        name = "new_evaluation_scenarios"


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
            EvaluationScenarioDB,
            NewEvaluationScenarioDB,
        ]
    )
    async def migrate_evaluation_scenario_output(
        self,
        input_document: EvaluationScenarioDB,
        output_document: NewEvaluationScenarioDB,
    ):
        list_of_scenario_outputs: List[NewEvaluationScenarioOutputDB] = []
        for output in input_document.outputs:
            list_of_scenario_outputs.append(
                NewEvaluationScenarioOutputDB(
                    result=NewResult(type=output.type, value=output.value)
                )
            )
        output_document.outputs = list_of_scenario_outputs


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
            EvaluationScenarioDB,
            NewEvaluationScenarioDB,
        ]
    )
    async def revert_evaluation_scenario_output(
        self,
        input_document: NewEvaluationScenarioDB,
        output_document: EvaluationScenarioDB,
    ):
        list_of_scenario_outputs: List[EvaluationScenarioOutputDB] = []
        for output in input_document.outputs:
            list_of_scenario_outputs.append(
                EvaluationScenarioOutputDB(type=output.result.type, value=output.result.value)  # type: ignore
            )
        output_document.outputs = list_of_scenario_outputs
