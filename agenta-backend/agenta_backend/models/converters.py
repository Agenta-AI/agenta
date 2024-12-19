"""Converts db models to pydantic models
"""

import uuid
import logging
from typing import List, Tuple, Any

from agenta_backend.services import db_manager
from agenta_backend.utils.common import isCloudEE
from agenta_backend.models.api.user_models import User
from agenta_backend.models.shared_models import ConfigDB, AppType
from agenta_backend.models.api.evaluation_model import (
    CorrectAnswer,
    Evaluation,
    HumanEvaluation,
    EvaluatorConfig,
    EvaluationScenario,
    SimpleEvaluationOutput,
    EvaluationScenarioInput,
    HumanEvaluationScenario,
    EvaluationScenarioOutput,
)

if isCloudEE():
    from agenta_backend.commons.models.db_models import (
        AppDB_ as AppDB,
        UserDB_ as UserDB,
        ImageDB_ as ImageDB,
        TestSetDB_ as TestSetDB,
        EvaluationDB_ as EvaluationDB,
        AppVariantDB_ as AppVariantDB,
        VariantBaseDB_ as VariantBaseDB,
        AppEnvironmentDB_ as AppEnvironmentDB,
        AppEnvironmentRevisionDB_ as AppEnvironmentRevisionDB,
        EvaluatorConfigDB_ as EvaluatorConfigDB,
        HumanEvaluationDB_ as HumanEvaluationDB,
        EvaluationScenarioDB_ as EvaluationScenarioDB,
        HumanEvaluationScenarioDB_ as HumanEvaluationScenarioDB,
    )
    from agenta_backend.commons.models.api.api_models import (
        AppVariant_ as AppVariant,
        ImageExtended_ as ImageExtended,
        AppVariantResponse_ as AppVariantResponse,
        EnvironmentRevision_ as EnvironmentRevision,
        EnvironmentOutput_ as EnvironmentOutput,
        EnvironmentOutputExtended_ as EnvironmentOutputExtended,
    )
else:
    from agenta_backend.models.db_models import (
        AppDB,
        UserDB,
        ImageDB,
        TestSetDB,
        EvaluationDB,
        AppVariantDB,
        VariantBaseDB,
        AppEnvironmentDB,
        AppEnvironmentRevisionDB,
        EvaluatorConfigDB,
        HumanEvaluationDB,
        EvaluationScenarioDB,
        HumanEvaluationScenarioDB,
    )
    from agenta_backend.models.api.api_models import (
        AppVariant,
        ImageExtended,
        AppVariantResponse,
        EnvironmentRevision,
        EnvironmentOutput,
        EnvironmentOutputExtended,
    )

from agenta_backend.models.db_models import (
    TemplateDB,
    AppVariantRevisionsDB,
)
from agenta_backend.models.api.api_models import (
    App,
    Template,
    BaseOutput,
    TestSetOutput,
    TemplateImageInfo,
    AppVariantRevision,
    PaginationParam,
    WithPagination,
)

from agenta_backend.models.shared_models import (
    AggregatedResult,
    EvaluationScenarioResult,
)

from fastapi import Depends


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


async def human_evaluation_db_to_simple_evaluation_output(
    human_evaluation_db: HumanEvaluationDB,
) -> SimpleEvaluationOutput:
    evaluation_variants = await db_manager.fetch_human_evaluation_variants(
        human_evaluation_id=str(human_evaluation_db.id)
    )
    return SimpleEvaluationOutput(
        id=str(human_evaluation_db.id),
        app_id=str(human_evaluation_db.app_id),
        project_id=str(human_evaluation_db.project_id),
        status=human_evaluation_db.status,  # type: ignore
        evaluation_type=human_evaluation_db.evaluation_type,  # type: ignore
        variant_ids=[
            str(evaluation_variant.variant_id)
            for evaluation_variant in evaluation_variants
        ],
    )


async def evaluation_db_to_pydantic(
    evaluation_db: EvaluationDB,
) -> Evaluation:
    variant_name = (
        evaluation_db.variant.variant_name
        if evaluation_db.variant.variant_name
        else str(evaluation_db.variant_id)
    )
    aggregated_results = aggregated_result_of_evaluation_to_pydantic(
        evaluation_db.aggregated_results
    )

    return Evaluation(
        id=str(evaluation_db.id),
        app_id=str(evaluation_db.app_id),
        project_id=str(evaluation_db.project_id),
        status=evaluation_db.status,
        variant_ids=[str(evaluation_db.variant_id)],
        variant_revision_ids=[str(evaluation_db.variant_revision_id)],
        revisions=[str(evaluation_db.variant_revision.revision)],
        variant_names=[variant_name],
        testset_id=str(evaluation_db.testset_id),
        testset_name=evaluation_db.testset.name,
        aggregated_results=aggregated_results,
        created_at=str(evaluation_db.created_at),
        updated_at=str(evaluation_db.updated_at),
        average_cost=evaluation_db.average_cost,
        total_cost=evaluation_db.total_cost,
        average_latency=evaluation_db.average_latency,
    )


async def human_evaluation_db_to_pydantic(
    evaluation_db: HumanEvaluationDB,
) -> HumanEvaluation:
    evaluation_variants = await db_manager.fetch_human_evaluation_variants(
        human_evaluation_id=str(evaluation_db.id)  # type: ignore
    )

    revisions = []
    variants_ids = []
    variants_names = []
    variants_revision_ids = []
    for evaluation_variant in evaluation_variants:
        variant_name = (
            evaluation_variant.variant.variant_name
            if isinstance(evaluation_variant.variant_id, uuid.UUID)
            else str(evaluation_variant.variant_id)
        )
        variants_names.append(str(variant_name))
        variants_ids.append(str(evaluation_variant.variant_id))
        variant_revision = (
            str(evaluation_variant.variant_revision.revision)
            if isinstance(evaluation_variant.variant_revision_id, uuid.UUID)
            else " None"
        )
        revisions.append(variant_revision)
        variants_revision_ids.append(str(evaluation_variant.variant_revision_id))

    return HumanEvaluation(
        id=str(evaluation_db.id),
        app_id=str(evaluation_db.app_id),
        project_id=str(evaluation_db.project_id),
        status=evaluation_db.status,  # type: ignore
        evaluation_type=evaluation_db.evaluation_type,  # type: ignore
        variant_ids=variants_ids,
        variant_names=variants_names,
        testset_id=str(evaluation_db.testset_id),
        testset_name=evaluation_db.testset.name,
        variants_revision_ids=variants_revision_ids,
        revisions=revisions,
        created_at=str(evaluation_db.created_at),  # type: ignore
        updated_at=str(evaluation_db.updated_at),  # type: ignore
    )


def human_evaluation_scenario_db_to_pydantic(
    evaluation_scenario_db: HumanEvaluationScenarioDB, evaluation_id: str
) -> HumanEvaluationScenario:
    return HumanEvaluationScenario(
        id=str(evaluation_scenario_db.id),
        evaluation_id=evaluation_id,
        inputs=evaluation_scenario_db.inputs,  # type: ignore
        outputs=evaluation_scenario_db.outputs,  # type: ignore
        vote=evaluation_scenario_db.vote,  # type: ignore
        score=evaluation_scenario_db.score,  # type: ignore
        correct_answer=evaluation_scenario_db.correct_answer,  # type: ignore
        is_pinned=evaluation_scenario_db.is_pinned or False,  # type: ignore
        note=evaluation_scenario_db.note or "",  # type: ignore
    )


def aggregated_result_of_evaluation_to_pydantic(
    evaluation_aggregated_results: List,
) -> List[dict]:
    transformed_results = []
    for aggregated_result in evaluation_aggregated_results:
        evaluator_config_dict = (
            {
                "id": str(aggregated_result.evaluator_config.id),
                "name": aggregated_result.evaluator_config.name,
                "evaluator_key": aggregated_result.evaluator_config.evaluator_key,
                "settings_values": aggregated_result.evaluator_config.settings_values,
                "created_at": str(aggregated_result.evaluator_config.created_at),
                "updated_at": str(aggregated_result.evaluator_config.updated_at),
            }
            if isinstance(aggregated_result.evaluator_config_id, uuid.UUID)
            else None
        )
        transformed_results.append(
            {
                "evaluator_config": (
                    {} if evaluator_config_dict is None else evaluator_config_dict
                ),
                "result": aggregated_result.result,
            }
        )
    return transformed_results


async def evaluation_scenario_db_to_pydantic(
    evaluation_scenario_db: EvaluationScenarioDB, evaluation_id: str
) -> EvaluationScenario:
    scenario_results = [
        {
            "evaluator_config": str(scenario_result.evaluator_config_id),
            "result": scenario_result.result,
        }
        for scenario_result in evaluation_scenario_db.results
    ]
    return EvaluationScenario(
        id=str(evaluation_scenario_db.id),
        evaluation_id=evaluation_id,
        inputs=[
            EvaluationScenarioInput(**scenario_input)  # type: ignore
            for scenario_input in evaluation_scenario_db.inputs
        ],
        outputs=[
            EvaluationScenarioOutput(**scenario_output)  # type: ignore
            for scenario_output in evaluation_scenario_db.outputs
        ],
        correct_answers=[
            CorrectAnswer(**correct_answer)  # type: ignore
            for correct_answer in evaluation_scenario_db.correct_answers
        ],
        is_pinned=evaluation_scenario_db.is_pinned or False,  # type: ignore
        note=evaluation_scenario_db.note or "",  # type: ignore
        results=scenario_results,  # type: ignore
    )


def app_variant_db_to_pydantic(
    app_variant_db: AppVariantDB, previous_variant_name: str = None
) -> AppVariant:
    app_variant = AppVariant(
        app_id=str(app_variant_db.app.id),
        app_name=app_variant_db.app.app_name,
        project_id=str(app_variant_db.project_id),
        variant_name=app_variant_db.variant_name,
        parameters=app_variant_db.config.parameters,
        previous_variant_name=app_variant_db.previous_variant_name,
        base_name=app_variant_db.base_name,
        config_name=app_variant_db.config_name,
    )
    return app_variant


async def app_variant_db_to_output(app_variant_db: AppVariantDB) -> AppVariantResponse:
    if isinstance(app_variant_db.base_id, uuid.UUID) and isinstance(
        app_variant_db.base.deployment_id, uuid.UUID
    ):
        uri = app_variant_db.base.deployment.uri
    else:
        uri = None

    logger.info(f"uri: {uri} deployment: {str(app_variant_db.base.deployment_id)}")
    variant_response = AppVariantResponse(
        app_id=str(app_variant_db.app_id),
        app_name=str(app_variant_db.app.app_name),
        project_id=str(app_variant_db.project_id),
        variant_name=app_variant_db.variant_name,  # type: ignore
        variant_id=str(app_variant_db.id),
        parameters=app_variant_db.config_parameters,  # type: ignore
        base_name=app_variant_db.base_name,  # type: ignore
        base_id=str(app_variant_db.base_id),
        config_name=app_variant_db.config_name,  # type: ignore
        uri=uri,  # type: ignore
        revision=app_variant_db.revision,  # type: ignore
        created_at=str(app_variant_db.updated_at),
        updated_at=str(app_variant_db.created_at),
        modified_by_id=str(app_variant_db.modified_by_id),
    )
    return variant_response


async def app_variant_db_revisions_to_output(
    app_variant_revisions_db: AppVariantRevisionsDB,
) -> AppVariantRevision:
    app_variant_revisions = []
    for app_variant_revision_db in app_variant_revisions_db:
        app_variant_revisions.append(
            AppVariantRevision(
                id=str(app_variant_revision_db.id) or None,
                revision=app_variant_revision_db.revision,
                modified_by=app_variant_revision_db.modified_by.username,
                config={
                    "config_name": app_variant_revision_db.config_name,  # type: ignore
                    "parameters": app_variant_revision_db.config_parameters,  # type: ignore
                },
                created_at=str(app_variant_revision_db.created_at),
            )
        )
    return app_variant_revisions


async def app_variant_db_revision_to_output(
    app_variant_revision_db: AppVariantRevisionsDB,
) -> AppVariantRevision:
    return AppVariantRevision(
        id=str(app_variant_revision_db.id) or None,
        revision=app_variant_revision_db.revision,
        modified_by=app_variant_revision_db.modified_by.username,
        config=ConfigDB(
            **{
                "config_name": app_variant_revision_db.config_name,
                "parameters": app_variant_revision_db.config_parameters,
            }
        ),
        created_at=str(app_variant_revision_db.created_at),
    )


async def environment_db_to_output(
    environment_db: AppEnvironmentDB,
) -> EnvironmentOutput:
    deployed_app_variant_id = (
        str(environment_db.deployed_app_variant_id)
        if environment_db.deployed_app_variant_id and isinstance(environment_db.deployed_app_variant_id, uuid.UUID)  # type: ignore
        else None
    )
    if deployed_app_variant_id:
        deployed_app_variant = await db_manager.get_app_variant_instance_by_id(
            deployed_app_variant_id, str(environment_db.project_id)
        )
        deployed_variant_name = deployed_app_variant.variant_name
        revision = deployed_app_variant.revision
    else:
        deployed_variant_name = None
        revision = None

    environment_output = EnvironmentOutput(
        name=environment_db.name,
        app_id=str(environment_db.app_id),
        project_id=str(environment_db.project_id),
        deployed_app_variant_id=deployed_app_variant_id,
        deployed_variant_name=deployed_variant_name,
        deployed_app_variant_revision_id=str(
            environment_db.deployed_app_variant_revision_id
        ),
        revision=revision,
    )
    return environment_output


async def environment_db_and_revision_to_extended_output(
    environment_db: AppEnvironmentDB,
    app_environment_revisions_db: List[AppEnvironmentRevisionDB],
) -> EnvironmentOutput:
    deployed_app_variant_id = (
        str(environment_db.deployed_app_variant_id)
        if isinstance(environment_db.deployed_app_variant_id, uuid.UUID)
        else None
    )
    if deployed_app_variant_id:
        deployed_app_variant = await db_manager.get_app_variant_instance_by_id(
            deployed_app_variant_id, str(environment_db.project_id)
        )
        deployed_variant_name = deployed_app_variant.variant_name
    else:
        deployed_variant_name = None

    app_environment_revisions = []
    for app_environment_revision in app_environment_revisions_db:
        app_environment_revisions.append(
            EnvironmentRevision(
                id=str(app_environment_revision.id),
                revision=app_environment_revision.revision,
                modified_by=app_environment_revision.modified_by.username,
                deployed_app_variant_revision=str(
                    app_environment_revision.deployed_app_variant_revision_id
                ),
                deployment=str(app_environment_revision.deployment_id),
                created_at=str(app_environment_revision.created_at),
            )
        )
    environment_output_extended = EnvironmentOutputExtended(
        name=environment_db.name,
        app_id=str(environment_db.app_id),
        project_id=str(environment_db.project_id),
        deployed_app_variant_id=deployed_app_variant_id,
        deployed_variant_name=deployed_variant_name,
        deployed_app_variant_revision_id=str(
            environment_db.deployed_app_variant_revision_id
        ),
        revision=environment_db.revision,
        revisions=app_environment_revisions,
    )
    return environment_output_extended


def base_db_to_pydantic(base_db: VariantBaseDB) -> BaseOutput:
    return BaseOutput(base_id=str(base_db.id), base_name=base_db.base_name)


def app_db_to_pydantic(app_db: AppDB) -> App:
    return App(
        app_name=app_db.app_name,
        app_id=str(app_db.id),
        app_type=AppType.friendly_tag(app_db.app_type),
        updated_at=str(app_db.updated_at),
    )


def image_db_to_pydantic(image_db: ImageDB) -> ImageExtended:
    image = ImageExtended(
        docker_id=image_db.docker_id,
        project_id=str(image_db.project_id),
        tags=image_db.tags,
        id=str(image_db.id),
    )
    return image


def templates_db_to_pydantic(templates_db: List[TemplateDB]) -> List[Template]:
    return [
        Template(
            id=str(template.id),
            image=TemplateImageInfo(
                name=template.name,
                size=template.size if template.size else None,
                digest=template.digest if template.digest else None,
                title=template.title,
                description=template.description,
                last_pushed=template.last_pushed if template.last_pushed else None,
                repo_name=template.repo_name if template.repo_name else None,
                template_uri=template.template_uri if template.template_uri else None,
            ),
        )
        for template in templates_db
    ]


def testset_db_to_pydantic(test_set_db: TestSetDB) -> TestSetOutput:
    """
    Convert a TestSetDB object to a TestSetAPI object.

    Args:
        test_set_db (Dict): The TestSetDB object to be converted.

    Returns:
        TestSetAPI: The converted TestSetAPI object.
    """
    return TestSetOutput(
        name=test_set_db.name,
        csvdata=test_set_db.csvdata,
        created_at=str(test_set_db.created_at),
        updated_at=str(test_set_db.updated_at),
        id=str(test_set_db.id),
    )


def user_db_to_pydantic(user_db: UserDB) -> User:
    return User(
        id=str(user_db.id),
        uid=user_db.uid,
        username=user_db.username,
        email=user_db.email,
    ).model_dump(exclude_unset=True)


def evaluator_config_db_to_pydantic(evaluator_config: EvaluatorConfigDB):
    return EvaluatorConfig(
        id=str(evaluator_config.id),
        project_id=str(evaluator_config.project_id),
        name=evaluator_config.name,
        evaluator_key=evaluator_config.evaluator_key,
        settings_values=evaluator_config.settings_values,
        created_at=str(evaluator_config.created_at),
        updated_at=str(evaluator_config.updated_at),
    )


def get_paginated_data(
    data: List[Any], data_count: int, query: PaginationParam = Depends()
):
    return WithPagination(
        data=data, total=data_count, page=query.page, pageSize=query.pageSize
    )


def get_pagination_skip_limit(pagination: PaginationParam) -> Tuple[int, int]:
    skip = (pagination.page - 1) * pagination.pageSize
    limit = pagination.pageSize
    return skip, limit
