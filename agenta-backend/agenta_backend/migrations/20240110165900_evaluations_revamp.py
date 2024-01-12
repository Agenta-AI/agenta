from datetime import datetime
from typing import Any, Dict, List, Optional


from pydantic import BaseModel, Field
from beanie import free_fall_migration, Document, Link, PydanticObjectId


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
    evaluation: Link[OldEvaluationDB]
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


class OldCustomEvaluationDB(Document):
    evaluation_name: str
    python_code: str
    app: Link[AppDB]
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "custom_evaluations"


def modify_app_id_store(
    app_id: str,
    variant_ids: str,
    evaluation_type: str,
    app_keyvalue_store: Dict[str, Dict[str, List[str]]],
):
    app_id_store = app_keyvalue_store.get(app_id, None)
    if not app_id_store:
        app_keyvalue_store[app_id] = {"variant_ids": [], "evaluation_types": []}
        app_id_store = app_keyvalue_store[app_id]

    app_id_store_variant_ids = list(app_id_store["variant_ids"])
    if variant_ids not in list(app_id_store["variant_ids"]):
        app_id_store_variant_ids.extend(variant_ids)
        app_id_store["variant_ids"] = list(set(app_id_store_variant_ids))

    app_id_store_evaluation_types = list(app_id_store["evaluation_types"])
    if evaluation_type not in app_id_store_evaluation_types:
        app_id_store_evaluation_types.append(evaluation_type)
        app_id_store["evaluation_types"] = list(set(app_id_store_evaluation_types))


class Forward:
    @free_fall_migration(
        document_models=[
            AppDB,
            UserDB,
            OrganizationDB,
            TestSetDB,
            OldEvaluationDB,
            EvaluatorConfigDB,
            HumanEvaluationDB,
            EvaluationDB,
            OldCustomEvaluationDB,
        ]
    )
    async def migrate_old_evaluation_to_new_evaluation(self, session):
        # STEP 1:
        # Create a key-value store that saves all the variants & evaluation types for a particular app id
        # Example: {"app_id": {"evaluation_types": ["string", "string"], "variant_ids": ["string", "string"]}}
        app_keyvalue_store = {}
        old_evaluations = await OldEvaluationDB.find(fetch_links=True).to_list()
        for old_eval in old_evaluations:
            app_id = old_eval.app.id
            variant_ids = [str(variant_id) for variant_id in old_eval.variants]
            evaluation_type = old_eval.evaluation_type
            modify_app_id_store(
                str(app_id), variant_ids, evaluation_type, app_keyvalue_store
            )

        # STEP 2:
        # Loop through the app_id key-store to create evaluator configs
        # based on the evaluation types available
        for app_id, app_id_store in app_keyvalue_store.items():
            app_evaluator_configs: List[EvaluatorConfigDB] = []
            for evaluation_type in app_id_store[
                "evaluation_types"
            ]:  # the values in this case are the evaluation type
                custom_code_evaluations = await OldCustomEvaluationDB.find(
                    OldCustomEvaluationDB.app == PydanticObjectId(app_id)
                ).to_list()
                if evaluation_type == "custom_code_run":
                    for custom_code_evaluation in custom_code_evaluations:
                        eval_config = EvaluatorConfigDB(
                            app=PydanticObjectId(app_id),
                            organization=old_eval.organization.id,
                            user=old_eval.user.id,
                            name=f"{old_eval.app.app_name}_{old_eval.evaluation_type}",
                            evaluator_key=f"auto_{evaluation_type}",
                            settings_values={}
                            if custom_code_evaluation is None
                            else {"code": custom_code_evaluation.python_code},
                        )
                        await eval_config.create(session=session)
                        app_evaluator_configs.append(eval_config)

                if evaluation_type != "custom_code_run":
                    eval_config = EvaluatorConfigDB(
                        app=PydanticObjectId(app_id),
                        organization=old_eval.organization.id,
                        user=old_eval.user.id,
                        name=f"{old_eval.app.app_name}_{old_eval.evaluation_type}",
                        evaluator_key=evaluation_type,
                        settings_values={},
                    )
                    await eval_config.create(session=session)
                    app_evaluator_configs.append(eval_config)

            # STEP 3 (a):
            # Retrieve evaluator configs for app id
            auto_evaluator_configs: List[PydanticObjectId] = []
            for evaluator_config in app_evaluator_configs:
                # In the case where the evaluator key is not a human evaluator,
                # Append the evaluator config id in the list of auto evaluator configs
                if evaluator_config.evaluator_key not in [
                    "human_a_b_testing",
                    "single_model_test",
                ]:
                    auto_evaluator_configs.append(evaluator_config.id)

            # STEP 3 (b):
            # In the case where the evaluator key is a human evaluator,
            # Proceed to create the human evaluation with the evaluator config
            for evaluator_config in app_evaluator_configs:
                if evaluator_config.evaluator_key in [
                    "human_a_b_testing",
                    "single_model_test",
                ]:
                    new_eval = HumanEvaluationDB(
                        app=PydanticObjectId(app_id),
                        organization=old_eval.organization.id,
                        user=old_eval.user.id,
                        status=old_eval.status,
                        evaluation_type=evaluator_config.evaluator_key,
                        variants=app_id_store["variant_ids"],
                        testset=old_eval.testset.id,
                    )
                    await new_eval.create(session=session)  # replace(session=session)

            # STEP 3 (c):
            # Proceed to create a single evaluation for every variant in the app_id_store
            # with the auto_evaluator_configs
            if auto_evaluator_configs is not None:
                for variant in app_id_store["variant_ids"]:
                    new_eval = EvaluationDB(
                        app=PydanticObjectId(app_id),
                        organization=old_eval.organization.id,
                        user=old_eval.user.id,
                        status=old_eval.status,
                        testset=old_eval.testset.id,
                        variant=variant,
                        evaluators_configs=auto_evaluator_configs,
                        aggregated_results=[],
                    )
                    await new_eval.create(session=session)

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
    async def migrate_old_evaluation_scenario_to_new_evaluation_scenario(self, session):
        old_scenarios = await OldEvaluationScenarioDB.find(fetch_links=True).to_list()
        for old_scenario in old_scenarios:
            if old_scenario.evaluation.evaluation_type in [
                "human_a_b_testing",
                "single_model_test",
            ]:
                scenario_inputs = [
                    HumanEvaluationScenarioInput(
                        input_name=input.input_name,
                        input_value=input.input_value,
                    )
                    for input in old_scenario.inputs
                ]
                scenario_outputs = [
                    HumanEvaluationScenarioOutput(
                        variant_id=output.variant_id,
                        variant_output=output.variant_output,
                    )
                    for output in old_scenario.outputs
                ]
                new_scenario = HumanEvaluationScenarioDB(
                    user=old_scenario.user.id,
                    organization=old_scenario.organization.id,
                    evaluation=old_scenario.evaluation.id,
                    inputs=scenario_inputs,
                    outputs=scenario_outputs,
                    correct_answer=old_scenario.correct_answer,
                    is_pinned=old_scenario.is_pinned,
                    note=old_scenario.note,
                    vote=old_scenario.vote,
                    score=old_scenario.score,
                )
                await new_scenario.insert(session=session)
            else:
                new_scenario = EvaluationScenarioDB(
                    user=old_scenario.user.id,
                    organization=old_scenario.organization.id,
                    evaluation=old_scenario.evaluation.id,
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
                    evaluators_configs=[],
                    results=[],
                )
                await new_scenario.insert(session=session)


class Backward:
    pass
