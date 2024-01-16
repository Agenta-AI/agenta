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


class OldEvaluationTypeSettings(BaseModel):
    similarity_threshold: Optional[float]
    regex_pattern: Optional[str]
    regex_should_match: Optional[bool]
    webhook_url: Optional[str]
    llm_app_prompt_template: Optional[str]
    custom_code_evaluation_id: Optional[str]
    evaluation_prompt_template: Optional[str]


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
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "evaluations"


class OldCustomEvaluationDB(Document):
    evaluation_name: str
    python_code: str
    version: str = Field("odmantic")
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
    if variant_ids not in app_id_store_variant_ids:
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
            app_db = await AppDB.find_one(AppDB.id == PydanticObjectId(app_id))
            for evaluation_type in app_id_store[
                "evaluation_types"
            ]:  # the values in this case are the evaluation type
                custom_code_evaluations = await OldCustomEvaluationDB.find(
                    OldCustomEvaluationDB.app == PydanticObjectId(app_id)
                ).to_list()
                if evaluation_type == "custom_code_run":
                    for custom_code_evaluation in custom_code_evaluations:
                        eval_config = EvaluatorConfigDB(
                            app=app_db,
                            organization=app_db.organization,
                            user=app_db.user,
                            name=f"{app_db.app_name}_{evaluation_type}",
                            evaluator_key=f"auto_{evaluation_type}",
                            settings_values=dict(
                                {"code": custom_code_evaluation.python_code}
                            ),
                        )
                        await eval_config.insert(session=session)
                        app_evaluator_configs.append(eval_config)

                if evaluation_type == "auto_similarity_match":
                    eval_config = EvaluatorConfigDB(
                        app=app_db,
                        organization=app_db.organization,
                        user=app_db.user,
                        name=f"{app_db.app_name}_{evaluation_type}",
                        evaluator_key=evaluation_type,
                        settings_values=dict(
                            {
                                "similarity_threshold": float(
                                    old_eval.evaluation_type_settings.similarity_threshold
                                )
                            }
                        ),
                    )
                    await eval_config.insert(session=session)
                    app_evaluator_configs.append(eval_config)

                if evaluation_type == "auto_exact_match":
                    eval_config = EvaluatorConfigDB(
                        app=app_db,
                        organization=app_db.organization,
                        user=app_db.user,
                        name=f"{app_db.app_name}_{evaluation_type}",
                        evaluator_key=evaluation_type,
                        settings_values={},
                    )
                    await eval_config.insert(session=session)
                    app_evaluator_configs.append(eval_config)

                if evaluation_type == "auto_regex_test":
                    eval_config = EvaluatorConfigDB(
                        app=app_db,
                        organization=app_db.organization,
                        user=app_db.user,
                        name=f"{app_db.app_name}_{evaluation_type}",
                        evaluator_key=evaluation_type,
                        settings_values=dict(
                            {
                                "regex_pattern": old_eval.evaluation_type_settings.regex_pattern,
                                "regex_should_match": old_eval.evaluation_type_settings.regex_should_match,
                            }
                        ),
                    )
                    await eval_config.insert(session=session)
                    app_evaluator_configs.append(eval_config)

                if evaluation_type == "auto_webhook_test":
                    eval_config = EvaluatorConfigDB(
                        app=app_db,
                        organization=app_db.organization,
                        user=app_db.user,
                        name=f"{app_db.app_name}_{evaluation_type}",
                        evaluator_key=evaluation_type,
                        settings_values=dict(
                            {
                                "webhook_url": old_eval.evaluation_type_settings.webhook_url,
                                "webhook_body": {},
                            }
                        ),
                    )
                    await eval_config.insert(session=session)
                    app_evaluator_configs.append(eval_config)

                if evaluation_type == "auto_ai_critique":
                    eval_config = EvaluatorConfigDB(
                        app=app_db,
                        organization=app_db.organization,
                        user=app_db.user,
                        name=f"{app_db.app_name}_{evaluation_type}",
                        evaluator_key=evaluation_type,
                        settings_values=dict(
                            {
                                "prompt_template": old_eval.evaluation_type_settings.evaluation_prompt_template
                            }
                        ),
                    )
                    await eval_config.insert(session=session)
                    app_evaluator_configs.append(eval_config)

            # STEP 3:
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

            # STEP 4:
            # Proceed to create a single evaluation for every variant in the app_id_store
            # with the auto_evaluator_configs
            if auto_evaluator_configs is not None:
                for variant in app_id_store["variant_ids"]:
                    new_eval = EvaluationDB(
                        app=app_db,
                        organization=app_db.organization,
                        user=app_db.user,
                        status=old_eval.status,
                        testset=old_eval.testset,
                        variant=PydanticObjectId(variant),
                        evaluators_configs=auto_evaluator_configs,
                        aggregated_results=[],
                        created_at=old_evaluation.created_at,
                    )
                    await new_eval.insert(session=session)

        # STEP 5:
        # Create the human evaluation
        for old_evaluation in old_evaluations:
            if old_evaluation.evaluation_type in [
                "human_a_b_testing",
                "single_model_test",
            ]:
                new_eval = HumanEvaluationDB(
                    app=old_evaluation.app,
                    organization=old_evaluation.organization,
                    user=old_evaluation.user,
                    status=old_evaluation.status,
                    evaluation_type=old_evaluation.evaluation_type,
                    variants=old_evaluation.variants,
                    testset=old_evaluation.testset,
                    created_at=old_evaluation.created_at,
                )
                await new_eval.insert(session=session)


class Backward:
    pass
