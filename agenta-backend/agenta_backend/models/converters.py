"""Converts db models to pydantic models
"""

import json
import logging
from typing import List, Tuple, Any

from agenta_backend.services import db_manager
from agenta_backend.utils.common import isCloudEE
from agenta_backend.models.api.user_models import User
from agenta_backend.models.api.evaluation_model import (
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
    from agenta_backend.cloud.observability.models.db import (
        SpanDB,
        Feedback as FeedbackDB,
    )
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
    from agenta_backend.cloud.observability.models.api import (
        Span,
        Error,
        SpanStatus,
        SpanVariant,
        Trace,
        Feedback as FeedbackOutput,
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
    AggregatedResult,
    AppVariantRevisionsDB,
    EvaluationScenarioResult,
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

from fastapi import Depends
from beanie import Link, PydanticObjectId as ObjectId


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


def human_evaluation_db_to_simple_evaluation_output(
    human_evaluation_db: HumanEvaluationDB,
) -> SimpleEvaluationOutput:
    return SimpleEvaluationOutput(
        id=str(human_evaluation_db.id),
        app_id=str(human_evaluation_db.app.id),
        status=human_evaluation_db.status,
        evaluation_type=human_evaluation_db.evaluation_type,
        variant_ids=[str(variant) for variant in human_evaluation_db.variants],
    )


async def evaluation_db_to_pydantic(
    evaluation_db: EvaluationDB,
) -> Evaluation:
    variant = await db_manager.get_app_variant_instance_by_id(
        str(evaluation_db.variant)
    )
    variant_name = variant.variant_name if variant else str(evaluation_db.variant)
    variant_revision = await db_manager.get_app_variant_revision_by_id(
        str(evaluation_db.variant_revision)
    )
    revision = str(variant_revision.revision)
    aggregated_results = await aggregated_result_to_pydantic(
        evaluation_db.aggregated_results
    )
    return Evaluation(
        id=str(evaluation_db.id),
        app_id=str(evaluation_db.app.id),
        user_id=str(evaluation_db.user.id),
        user_username=evaluation_db.user.username or "",
        status=evaluation_db.status,
        variant_ids=[str(evaluation_db.variant)],
        variant_revision_ids=[str(evaluation_db.variant_revision)],
        revisions=[revision],
        variant_names=[variant_name],
        testset_id=(
            "" if type(evaluation_db.testset) is Link else str(evaluation_db.testset.id)
        ),
        testset_name=(
            ""
            if type(evaluation_db.testset) is Link
            else str(evaluation_db.testset.name)
        ),
        aggregated_results=aggregated_results,
        created_at=evaluation_db.created_at,
        updated_at=evaluation_db.updated_at,
        average_cost=evaluation_db.average_cost,
        average_latency=evaluation_db.average_latency,
    )


async def human_evaluation_db_to_pydantic(
    evaluation_db: HumanEvaluationDB,
) -> HumanEvaluation:
    variant_names = []
    for variant_id in evaluation_db.variants:
        variant = await db_manager.get_app_variant_instance_by_id(str(variant_id))
        variant_name = variant.variant_name if variant else str(variant_id)
        variant_names.append(str(variant_name))
    revisions = []
    for variant_revision_id in evaluation_db.variants_revisions:
        variant_revision = await db_manager.get_app_variant_revision_by_id(
            str(variant_revision_id)
        )
        revision = variant_revision.revision
        revisions.append(str(revision))

    return HumanEvaluation(
        id=str(evaluation_db.id),
        app_id=str(evaluation_db.app.id),
        user_id=str(evaluation_db.user.id),
        user_username=evaluation_db.user.username or "",
        status=evaluation_db.status,
        evaluation_type=evaluation_db.evaluation_type,
        variant_ids=[str(variant) for variant in evaluation_db.variants],
        variant_names=variant_names,
        testset_id=(
            "" if type(evaluation_db.testset) is Link else str(evaluation_db.testset.id)
        ),
        testset_name=(
            ""
            if type(evaluation_db.testset) is Link
            else str(evaluation_db.testset.name)
        ),
        variants_revision_ids=[
            str(variant_revision)
            for variant_revision in evaluation_db.variants_revisions
        ],
        revisions=revisions,
        created_at=evaluation_db.created_at,
        updated_at=evaluation_db.updated_at,
    )


def human_evaluation_scenario_db_to_pydantic(
    evaluation_scenario_db: HumanEvaluationScenarioDB, evaluation_id: str
) -> HumanEvaluationScenario:
    return HumanEvaluationScenario(
        id=str(evaluation_scenario_db.id),
        evaluation_id=evaluation_id,
        inputs=evaluation_scenario_db.inputs,
        outputs=evaluation_scenario_db.outputs,
        vote=evaluation_scenario_db.vote,
        score=evaluation_scenario_db.score,
        correct_answer=evaluation_scenario_db.correct_answer,
        is_pinned=evaluation_scenario_db.is_pinned or False,
        note=evaluation_scenario_db.note or "",
    )


async def aggregated_result_to_pydantic(results: List[AggregatedResult]) -> List[dict]:
    transformed_results = []
    for result in results:
        evaluator_config_db = await db_manager.fetch_evaluator_config(
            str(result.evaluator_config)
        )
        evaluator_config_dict = (
            evaluator_config_db.json() if evaluator_config_db else None
        )
        transformed_results.append(
            {
                "evaluator_config": (
                    {}
                    if evaluator_config_dict is None
                    else json.loads(evaluator_config_dict)
                ),
                "result": result.result.dict(),
            }
        )
    return transformed_results


def evaluation_scenarios_results_to_pydantic(
    results: List[EvaluationScenarioResult],
) -> List[dict]:
    return [
        {
            "evaluator_config": str(result.evaluator_config),
            "result": result.result.dict(),
        }
        for result in results
    ]


def evaluation_scenario_db_to_pydantic(
    evaluation_scenario_db: EvaluationScenarioDB, evaluation_id: str
) -> EvaluationScenario:
    return EvaluationScenario(
        id=str(evaluation_scenario_db.id),
        evaluation_id=evaluation_id,
        inputs=[
            EvaluationScenarioInput(**scenario_input.dict())
            for scenario_input in evaluation_scenario_db.inputs
        ],
        outputs=[
            EvaluationScenarioOutput(**scenario_output.dict())
            for scenario_output in evaluation_scenario_db.outputs
        ],
        correct_answer=evaluation_scenario_db.correct_answer,
        is_pinned=evaluation_scenario_db.is_pinned or False,
        note=evaluation_scenario_db.note or "",
        results=evaluation_scenarios_results_to_pydantic(
            evaluation_scenario_db.results
        ),
    )


def app_variant_db_to_pydantic(
    app_variant_db: AppVariantDB, previous_variant_name: str = None
) -> AppVariant:
    app_variant = AppVariant(
        app_id=str(app_variant_db.app.id),
        app_name=app_variant_db.app.app_name,
        variant_name=app_variant_db.variant_name,
        parameters=app_variant_db.config.parameters,
        previous_variant_name=app_variant_db.previous_variant_name,
        base_name=app_variant_db.base_name,
        config_name=app_variant_db.config_name,
    )

    if isCloudEE():
        app_variant.organization_id = str(app_variant_db.organization.id)
        app_variant.workspace_id = str(app_variant_db.workspace.id)

    return app_variant


async def app_variant_db_to_output(app_variant_db: AppVariantDB) -> AppVariantResponse:
    if app_variant_db.base.deployment:
        deployment = await db_manager.get_deployment_by_objectid(
            app_variant_db.base.deployment
        )
        uri = deployment.uri
    else:
        deployment = None
        uri = None
    logger.info(f"uri: {uri} deployment: {app_variant_db.base.deployment} {deployment}")
    variant_response = AppVariantResponse(
        app_id=str(app_variant_db.app.id),
        app_name=str(app_variant_db.app.app_name),
        variant_name=app_variant_db.variant_name,
        variant_id=str(app_variant_db.id),
        user_id=str(app_variant_db.user.id),
        parameters=app_variant_db.config.parameters,
        previous_variant_name=app_variant_db.previous_variant_name,
        base_name=app_variant_db.base_name,
        base_id=str(app_variant_db.base.id),
        config_name=app_variant_db.config_name,
        uri=uri,
        revision=app_variant_db.revision,
    )

    if isCloudEE():
        variant_response.organization_id = str(app_variant_db.organization.id)
        variant_response.workspace_id = str(app_variant_db.workspace.id)

    return variant_response


async def app_variant_db_revisions_to_output(
    app_variant_revisions_db: AppVariantRevisionsDB,
) -> AppVariantRevision:
    app_variant_revisions = []
    for app_variant_revision_db in app_variant_revisions_db:
        app_variant_revisions.append(
            AppVariantRevision(
                revision=app_variant_revision_db.revision,
                modified_by=app_variant_revision_db.modified_by.username,
                config=app_variant_revision_db.config,
                created_at=app_variant_revision_db.created_at,
            )
        )
    return app_variant_revisions


async def app_variant_db_revision_to_output(
    app_variant_revision_db: AppVariantRevisionsDB,
) -> AppVariantRevision:
    return AppVariantRevision(
        revision=app_variant_revision_db.revision,
        modified_by=app_variant_revision_db.modified_by.username,
        config=app_variant_revision_db.config,
        created_at=app_variant_revision_db.created_at,
    )


async def environment_db_to_output(
    environment_db: AppEnvironmentDB,
) -> EnvironmentOutput:
    deployed_app_variant_id = (
        str(environment_db.deployed_app_variant)
        if environment_db.deployed_app_variant
        else None
    )
    if deployed_app_variant_id:
        deployed_app_variant = await db_manager.get_app_variant_instance_by_id(
            deployed_app_variant_id
        )
        deployed_variant_name = deployed_app_variant.variant_name
        revision = deployed_app_variant.revision
    else:
        deployed_variant_name = None
        revision = None

    environment_output = EnvironmentOutput(
        name=environment_db.name,
        app_id=str(environment_db.app.id),
        deployed_app_variant_id=deployed_app_variant_id,
        deployed_variant_name=deployed_variant_name,
        deployed_app_variant_revision_id=str(
            environment_db.deployed_app_variant_revision
        ),
        revision=revision,
    )

    if isCloudEE():
        environment_output.organization_id = str(environment_db.organization.id)
        environment_output.workspace_id = str(environment_db.workspace.id)
    return environment_output


async def environment_db_and_revision_to_extended_output(
    environment_db: AppEnvironmentDB,
    app_environment_revisions_db: List[AppEnvironmentRevisionDB],
) -> EnvironmentOutput:
    deployed_app_variant_id = (
        str(environment_db.deployed_app_variant)
        if environment_db.deployed_app_variant
        else None
    )
    if deployed_app_variant_id:
        deployed_app_variant = await db_manager.get_app_variant_instance_by_id(
            deployed_app_variant_id
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
                    app_environment_revision.deployed_app_variant_revision
                ),
                deployment=str(app_environment_revision.deployment),
                created_at=app_environment_revision.created_at,
            )
        )
    environment_output_extended = EnvironmentOutputExtended(
        name=environment_db.name,
        app_id=str(environment_db.app.id),
        deployed_app_variant_id=deployed_app_variant_id,
        deployed_variant_name=deployed_variant_name,
        deployed_app_variant_revision_id=str(
            environment_db.deployed_app_variant_revision.id
        ),
        revision=environment_db.revision,
        revisions=app_environment_revisions,
    )

    if isCloudEE():
        environment_output_extended.organization_id = str(
            environment_db.organization.id
        )
        environment_output_extended.workspace_id = str(environment_db.workspace.id)
    return environment_output_extended


def base_db_to_pydantic(base_db: VariantBaseDB) -> BaseOutput:
    return BaseOutput(base_id=str(base_db.id), base_name=base_db.base_name)


def app_db_to_pydantic(app_db: AppDB) -> App:
    return App(app_name=app_db.app_name, app_id=str(app_db.id))


def image_db_to_pydantic(image_db: ImageDB) -> ImageExtended:
    image = ImageExtended(
        docker_id=image_db.docker_id,
        tags=image_db.tags,
        id=str(image_db.id),
    )

    if isCloudEE():
        image.organization_id = str(image_db.organization.id)
        image.workspace_id = str(image_db.workspace.id)

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


async def spans_to_pydantic(spans_db: List["SpanDB"]) -> List["Span"]:
    child_spans: List[Span] = []
    spans_dict: Dict[str, Span] = {}

    for span_db in spans_db:
        app_variant_db = await db_manager.fetch_app_variant_by_id(
            span_db.trace.variant_id
        )
        spans_dict[str(span_db.id)] = Span(
            id=str(span_db.id),
            name=span_db.name,
            created_at=span_db.created_at.isoformat(),
            variant=SpanVariant(
                variant_id=str(span_db.trace.variant_id),
                variant_name=app_variant_db.variant_name,
                revision=app_variant_db.revision,
            ),
            environment=span_db.environment,
            status=SpanStatus(value=span_db.status.value, error=span_db.status.error),
            metadata={
                "cost": span_db.cost,
                "latency": span_db.get_latency(),
                "usage": span_db.tokens,
            },
            user_id=span_db.user,
            parent_span_id=span_db.parent_span_id,
        )

    for span_db in spans_db:
        if span_db.parent_span_id:
            parent_span = spans_dict.get(span_db.parent_span_id)
            child_span = spans_dict[str(span_db.id)]
            if parent_span:
                if hasattr(parent_span, "children") and not parent_span.children:
                    parent_span.children = []

                parent_span.children.append(child_span)
                child_spans.append(child_span)

    top_level_spans = [span for span in spans_dict.values() if span not in child_spans]
    return [
        span.dict(exclude_unset=True, exclude_none=True) for span in top_level_spans
    ]


async def traces_to_pydantic(traces_db: List["TraceDB"]) -> List["Trace"]:
    traces: List[Trace] = []
    for trace_db in traces_db:
        app_variant_db = await db_manager.fetch_app_variant_by_id(trace_db.variant_id)

        trace_span_status = (
            SpanStatus(value=trace_db.status)
            if trace_db.status in ["INITIATED", "COMPLETED"]
            else SpanStatus(value=None, error=Error(message=trace_db.status))
        )
        trace = Trace(
            id=str(trace_db.id),
            created_at=trace_db.created_at.isoformat(),
            variant=SpanVariant(
                variant_id=str(app_variant_db.id),
                variant_name=app_variant_db.variant_name,
                revision=app_variant_db.revision,
            ),
            environment=trace_db.environment,
            status=trace_span_status,
            metadata={
                "cost": trace_db.cost,
                "latency": trace_db.get_latency(),
                "usage": {"total_tokens": trace_db.token_consumption},
            },
            user_id="",
        )
        traces.append(trace.dict(exclude_unset=True))

    return traces


def feedback_db_to_pydantic(feedback_db: "FeedbackDB") -> "FeedbackOutput":
    return FeedbackOutput(
        feedback_id=str(feedback_db.uid),
        feedback=feedback_db.feedback,
        score=feedback_db.score,
        meta=feedback_db.meta,
        created_at=feedback_db.created_at,
    ).dict(exclude_unset=True)


def user_db_to_pydantic(user_db: UserDB) -> User:
    return User(
        id=str(user_db.id),
        uid=user_db.uid,
        username=user_db.username,
        email=user_db.email,
    ).dict(exclude_unset=True)


def evaluator_config_db_to_pydantic(evaluator_config: EvaluatorConfigDB):
    return EvaluatorConfig(
        id=str(evaluator_config.id),
        name=evaluator_config.name,
        evaluator_key=evaluator_config.evaluator_key,
        settings_values=evaluator_config.settings_values,
        created_at=evaluator_config.created_at,
        updated_at=evaluator_config.updated_at,
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
