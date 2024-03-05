from datetime import datetime
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


class HumanEvaluationDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    status: str
    evaluation_type: str
    variants: List[PydanticObjectId]
    testset: Link[TestSetDB]
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

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
    created_at: datetime = Field(default=datetime.now())
    updated_at: datetime = Field(default=datetime.now())

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
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "evaluations"


class OldCustomEvaluationDB(Document):
    evaluation_name: str
    python_code: str
    version: str = Field("odmantic")
    app: Link[AppDB]
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "custom_evaluations"


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
        # Review the evaluations and create a unique evaluation for each one.
        old_evaluations = await OldEvaluationDB.find(
            In(
                OldEvaluationDB.evaluation_type,
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
        for old_eval in old_evaluations:
            if getattr(old_eval, "id", None) and not getattr(
                getattr(old_eval, "app", None), "id", None
            ):
                continue
            list_of_eval_configs = []
            evaluation_type = old_eval.evaluation_type
            # Use the created evaluator if the evaluation uses "exact_match" or a code evaluator.
            # Otherwise, create a new evaluator.
            if evaluation_type == "custom_code_run":
                custom_code = await OldCustomEvaluationDB.find_one(
                    OldCustomEvaluationDB.id
                    == PydanticObjectId(
                        old_eval.evaluation_type_settings.custom_code_evaluation_id
                    )
                )
                eval_config = EvaluatorConfigDB(
                    app=old_eval.app,
                    organization=old_eval.organization,
                    user=old_eval.user,
                    name="Custom Code Run",
                    evaluator_key="auto_custom_code_run",
                    settings_values=dict({"code": custom_code.python_code}),
                )
                await eval_config.insert(session=session)
                list_of_eval_configs.append(eval_config.id)

            if evaluation_type == "auto_exact_match":
                eval_config = await EvaluatorConfigDB.find_one(
                    EvaluatorConfigDB.app.id == old_eval.app.id,
                    EvaluatorConfigDB.evaluator_key == "auto_exact_match",
                )
                if eval_config is not None:
                    list_of_eval_configs.append(eval_config.id)

            if evaluation_type == "auto_similarity_match":
                eval_config = EvaluatorConfigDB(
                    app=old_eval.app,
                    organization=old_eval.organization,
                    user=old_eval.user,
                    name="Similarity Match",
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
                list_of_eval_configs.append(eval_config.id)

            if evaluation_type == "auto_regex_test":
                eval_config = EvaluatorConfigDB(
                    app=old_eval.app,
                    organization=old_eval.organization,
                    user=old_eval.user,
                    name="Regex Test",
                    evaluator_key=evaluation_type,
                    settings_values=dict(
                        {
                            "regex_pattern": old_eval.evaluation_type_settings.regex_pattern,
                            "regex_should_match": old_eval.evaluation_type_settings.regex_should_match,
                        }
                    ),
                )
                await eval_config.insert(session=session)
                list_of_eval_configs.append(eval_config.id)

            if evaluation_type == "auto_webhook_test":
                eval_config = EvaluatorConfigDB(
                    app=old_eval.app,
                    organization=old_eval.organization,
                    user=old_eval.user,
                    name="Webhook Test",
                    evaluator_key=evaluation_type,
                    settings_values=dict(
                        {
                            "webhook_url": old_eval.evaluation_type_settings.webhook_url,
                            "webhook_body": {},
                        }
                    ),
                )
                await eval_config.insert(session=session)
                list_of_eval_configs.append(eval_config.id)

            if evaluation_type == "auto_ai_critique":
                eval_config = EvaluatorConfigDB(
                    app=old_eval.app,
                    organization=old_eval.organization,
                    user=old_eval.user,
                    name="AI Critique",
                    evaluator_key=evaluation_type,
                    settings_values=dict(
                        {
                            "prompt_template": old_eval.evaluation_type_settings.evaluation_prompt_template
                        }
                    ),
                )
                await eval_config.insert(session=session)
                list_of_eval_configs.append(eval_config.id)

            new_eval = EvaluationDB(
                id=old_eval.id,
                app=old_eval.app,
                organization=old_eval.organization,
                user=old_eval.user,
                status=old_eval.status,
                testset=old_eval.testset,
                variant=PydanticObjectId(old_eval.variants[0]),
                evaluators_configs=list_of_eval_configs,
                aggregated_results=[],
                created_at=old_eval.created_at,
            )
            await new_eval.insert(session=session)

        # STEP 3:
        # Create the human evaluation
        old_human_evaluations = await OldEvaluationDB.find(
            In(
                OldEvaluationDB.evaluation_type,
                [
                    "human_a_b_testing",
                    "single_model_test",
                ],
            ),
            fetch_links=True,
        ).to_list()
        for old_evaluation in old_human_evaluations:
            new_eval = HumanEvaluationDB(
                id=old_evaluation.id,
                app=old_evaluation.app,
                organization=old_evaluation.organization,
                user=old_evaluation.user,
                status=old_evaluation.status,
                evaluation_type=old_evaluation.evaluation_type,
                variants=old_evaluation.variants,
                testset=old_evaluation.testset,
                created_at=old_evaluation.created_at,
                updated_at=old_evaluation.updated_at,
            )
            await new_eval.insert(session=session)


class Backward:
    pass
