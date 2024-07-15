from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from beanie.operators import In
from pydantic import BaseModel, Field
from beanie import free_fall_migration, Document, Link, PydanticObjectId


class OrganizationDB(Document):
    name: str = Field(default="agenta")
    description: str = Field(default="")
    type: Optional[str]
    owner: str  # user id
    members: Optional[List[PydanticObjectId]]
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))

    class Settings:
        name = "organizations"


class UserDB(Document):
    uid: str = Field(default="0", unique=True, index=True)
    username: str = Field(default="agenta")
    email: str = Field(default="demo@agenta.ai", unique=True)
    organizations: Optional[List[PydanticObjectId]] = []
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))

    class Settings:
        name = "users"


class AppDB(Document):
    app_name: str
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))

    class Settings:
        name = "app_db"


class TestSetDB(Document):
    name: str
    app: Link[AppDB]
    csvdata: List[Dict[str, str]]
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))

    class Settings:
        name = "testsets"


class EvaluatorConfigDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    name: str
    evaluator_key: str
    settings_values: Optional[Dict[str, Any]] = None
    created_at: datetime = Field(default=datetime.now(timezone.utc))
    updated_at: datetime = Field(default=datetime.now(timezone.utc))

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
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))

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
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
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
    created_at: datetime = Field(default=datetime.now(timezone.utc))
    updated_at: datetime = Field(default=datetime.now(timezone.utc))

    class Settings:
        name = "new_evaluations"


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
    created_at: datetime = Field(default=datetime.now(timezone.utc))
    updated_at: datetime = Field(default=datetime.now(timezone.utc))

    class Settings:
        name = "new_evaluation_scenarios"


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
    version: str = Field("odmantic")
    testset: Link[TestSetDB]
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))

    class Settings:
        name = "evaluations"


class OldEvaluationScenarioDB(Document):
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    evaluation: Link[OldEvaluationDB]
    inputs: List[OldEvaluationScenarioInput]
    outputs: List[OldEvaluationScenarioOutput]  # EvaluationScenarioOutput
    vote: Optional[str]
    version: str = Field("odmantic")
    score: Optional[Any]
    correct_answer: Optional[str]
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
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
            TestSetDB,
            EvaluationDB,
            OldEvaluationDB,
            OldEvaluationScenarioDB,
            EvaluationScenarioDB,
            HumanEvaluationDB,
            HumanEvaluationScenarioDB,
        ]
    )
    async def migrate_old_auto_evaluation_scenario_to_new_auto_evaluation_scenario(
        self, session
    ):
        new_evaluations = await EvaluationDB.find(
            fetch_links=True,
        ).to_list()
        old_auto_scenarios = await OldEvaluationScenarioDB.find(
            In(
                OldEvaluationScenarioDB.evaluation.evaluation_type,
                [
                    "auto_exact_match",
                    "auto_similarity_match",
                    "auto_regex_test",
                    "auto_ai_critique",
                    "custom_code_run",
                    "auto_webhook_test",
                ],
            ),
            fetch_links=True,
        ).to_list()
        for new_evaluation in new_evaluations:
            for i, old_scenario in enumerate(old_auto_scenarios):
                print(f"auto evaluation {i}")
                if new_evaluation.id == old_scenario.evaluation.id:
                    results = [
                        EvaluationScenarioResult(
                            evaluator_config=PydanticObjectId(evaluator_config),
                            result=Result(
                                type=(
                                    "number"
                                    if isinstance(old_scenario.score, int)
                                    else (
                                        "number"
                                        if isinstance(old_scenario.score, float)
                                        else (
                                            "string"
                                            if isinstance(old_scenario.score, str)
                                            else (
                                                "boolean"
                                                if isinstance(old_scenario.score, bool)
                                                else "any"
                                            )
                                        )
                                    )
                                ),
                                value=old_scenario.score,
                            ),
                        )
                        for evaluator_config in new_evaluation.evaluators_configs
                    ]
                    new_scenario = EvaluationScenarioDB(
                        user=new_evaluation.user,
                        organization=new_evaluation.organization,
                        evaluation=new_evaluation,
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
                        evaluators_configs=new_evaluation.evaluators_configs,
                        results=results,
                    )
                    await new_scenario.insert(session=session)


class Backward:
    pass
