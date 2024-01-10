from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from beanie import free_fall_migration, Link
from beanie import Document, Link, PydanticObjectId


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
    settings_values: Optional[Dict[str, Any]] = None
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Settings:
        name = "evaluators_configs"


class Result(BaseModel):
    type: str
    value: Any


class EvaluationScenarioResult(BaseModel):
    evaluator_config: PydanticObjectId
    result: Result


class AggregatedResult(BaseModel):
    evaluator_config: PydanticObjectId
    result: Result


class EvaluationScenarioInputDB(BaseModel):
    name: str
    type: str
    value: str


class EvaluationScenarioOutputDB(BaseModel):
    type: str
    value: Any


class HumanEvaluationScenarioInput(BaseModel):
    input_name: str
    input_value: str


class HumanEvaluationScenarioOutput(BaseModel):
    variant_id: str
    variant_output: str


class HumanEvaluationDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    status: str
    evaluation_type: str
    variants: List[PydanticObjectId]
    testset: Link[TestSetDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "human_evaluations"


class HumanEvaluationScenarioDB(Document):
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    evaluation: Link[HumanEvaluationDB]
    inputs: List[HumanEvaluationScenarioInput]
    outputs: List[HumanEvaluationScenarioOutput]
    vote: Optional[str]
    score: Optional[Any]
    correct_answer: Optional[str]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())
    is_pinned: Optional[bool]
    note: Optional[str]

    class Settings:
        name = "human_evaluations_scenarios"


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
        name = "evaluations"


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
        name = "evaluation_scenarios"


class OldEvaluationTypeSettings(BaseModel):
    similarity_threshold: Optional[float]
    regex_pattern: Optional[str]
    regex_should_match: Optional[bool]
    webhook_url: Optional[str]
    llm_app_prompt_template: Optional[str]
    custom_code_evaluation_id: Optional[str]
    evaluation_prompt_template: Optional[str]


class OldEvaluationScenarioInput(BaseModel):
    input_name: str
    input_value: str


class OldEvaluationScenarioOutput(BaseModel):
    variant_id: str
    variant_output: str


class OldEvaluationDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    status: str
    evaluation_type: str
    evaluation_type_settings: OldEvaluationTypeSettings
    variants: List[PydanticObjectId]
    testset: Link[TestSetDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "evaluations"


class OldEvaluationScenarioDB(Document):
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    evaluation: Link[EvaluationDB]
    inputs: List[OldEvaluationScenarioInput]
    outputs: List[OldEvaluationScenarioOutput]  # EvaluationScenarioOutput
    vote: Optional[str]
    score: Optional[Any]
    correct_answer: Optional[str]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())
    is_pinned: Optional[bool]
    note: Optional[str]

    class Settings:
        name = "evaluation_scenarios"



class Forward:
    @free_fall_migration(
        document_models=[
            AppDB,
            OrganizationDB,
            UserDB,
            EvaluatorConfigDB,
            OldEvaluationDB,
            EvaluationDB,
        ]
    )
    async def move_old_evals_to_new_evals_document(self, session):
        async for old_eval in OldEvaluationDB.find_all():
            eval_config = EvaluatorConfigDB(
                app=Link(AppDB, old_eval.app.id),
                organization=Link(OrganizationDB, old_eval.organization.id),
                user=Link(UserDB, old_eval.user.id),
                name=f"{old_eval.app.app_name}_{old_eval.evaluation_type}",
                evaluator_key=old_eval.evaluation_type,
                settings_values={},
            )
            await eval_config.create()
            if old_eval.evaluation_type in ["human_a_b_testing", "single_model_test"]:
                new_eval = HumanEvaluationDB(
                    app=Link(AppDB, old_eval.app.id),
                    organization=Link(OrganizationDB, old_eval.organization.id),
                    user=Link(UserDB, old_eval.user.id),
                    status=old_eval.status,
                    evaluation_type=old_eval.evaluation_type,
                    variants=old_eval.variants,
                    testset=Link(TestSetDB, old_eval.testset.id),
                )
            else:
                new_eval = EvaluationDB(
                    app=Link(AppDB, old_eval.app.id),
                    organization=Link(OrganizationDB, old_eval.organization.id),
                    user=Link(UserDB, old_eval.user.id),
                    status=old_eval.status,
                    testset=Link(TestSetDB, old_eval.testset.id),
                    variant=old_eval.variants[0],
                    evaluator_configs=eval_config.id,
                    aggregated_results=[],
                )
            await old_eval.delete()
            await new_eval.replace(session=session)

    @free_fall_migration(
        document_models=[
            AppDB,
            OrganizationDB,
            UserDB,
            OldEvaluationScenarioDB,
            EvaluationScenarioDB,
        ]
    )
    async def move_old_eval_scenarios_to_new_eval_scenarios(self, session):
        async for old_scenario in OldEvaluationScenarioDB.find_all():
            if old_scenario.evaluation_type in [
                "human_a_b_testing",
                "single_model_test",
            ]:
                new_scenario = HumanEvaluationScenarioDB(
                    user=Link(UserDB, old_scenario.user.id),
                    organization=Link(OrganizationDB, old_scenario.organization.id),
                    evaluation=Link(EvaluationDB, old_scenario.evaluation.id),
                    inputs=[
                        HumanEvaluationScenarioInput(
                            name=input.input_name,
                            value=input.input_value,
                        )
                        for input in old_scenario.inputs
                    ],
                    outputs=[
                        HumanEvaluationScenarioOutput(
                            variant_id=output.variant_id,
                            variant_output=output.variant_output,
                        )
                        for output in old_scenario.outputs
                    ],
                    correct_answer=old_scenario.correct_answer,
                    is_pinned=old_scenario.is_pinned,
                    note=old_scenario.note,
                    vote=old_scenario.vote,
                    score=old_scenario.score,
                )
            else:
                new_scenario = EvaluationScenarioDB(
                    user=Link(UserDB, old_scenario.user.id),
                    organization=Link(OrganizationDB, old_scenario.organization.id),
                    evaluation=Link(EvaluationDB, old_scenario.evaluation.id),
                    variant_id=old_scenario.evaluation.variants[0],
                    inputs=[
                        EvaluationScenarioInputDB(
                            name=input.input_name,
                            type=type(input.input_value).__name__,
                            value=input.input_value,
                        )
                        for input in old_scenario.inputs
                    ],
                    outputs=[
                        EvaluationScenarioOutputDB(
                            type=type(output.variant_output).__name__,
                            value=output.variant_output,
                        )
                        for output in old_scenario.outputs
                    ],
                    correct_answer=old_scenario.correct_answer,
                    is_pinned=old_scenario.is_pinned,
                    note=old_scenario.note,
                    evaluators_configs=old_scenario.evaluation.evaluators_configs,
                    results=[],
                )
            await old_scenario.delete()
            await new_scenario.replace(session=session)


class Backward:
    ...
