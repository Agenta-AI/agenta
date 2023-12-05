"""Converts db models to pydantic models
"""
from typing import List
from agenta_backend.services import db_manager
from agenta_backend.models.api.user_models import User
from agenta_backend.models.db_models import (
    AppVariantDB,
    ImageDB,
    TemplateDB,
    AppDB,
    AppEnvironmentDB,
    TestSetDB,
    SpanDB,
    TraceDB,
    Feedback as FeedbackDB,
    EvaluationDB,
    EvaluationScenarioDB,
    VariantBaseDB,
    UserDB,
)
from agenta_backend.models.api.api_models import (
    AppVariant,
    ImageExtended,
    Template,
    TemplateImageInfo,
    AppVariantOutput,
    App,
    EnvironmentOutput,
    TestSetOutput,
    BaseOutput,
)
from agenta_backend.models.api.observability_models import (
    Span,
    Trace,
    Feedback as FeedbackOutput,
)
from agenta_backend.models.api.evaluation_model import (
    SimpleEvaluationOutput,
    EvaluationScenario,
    Evaluation,
)

import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


def evaluation_db_to_simple_evaluation_output(
    evaluation_db: EvaluationDB,
) -> SimpleEvaluationOutput:
    return SimpleEvaluationOutput(
        id=str(evaluation_db.id),
        app_id=str(evaluation_db.app.id),
        status=evaluation_db.status,
        evaluation_type=evaluation_db.evaluation_type,
        variant_ids=[str(variant) for variant in evaluation_db.variants],
    )


async def evaluation_db_to_pydantic(
    evaluation_db: EvaluationDB,
) -> Evaluation:
    variant_names = []
    for variant_id in evaluation_db.variants:
        variant = await db_manager.get_app_variant_instance_by_id(str(variant_id))
        variant_name = variant.variant_name if variant else str(variant_id)
        variant_names.append(str(variant_name))

    return Evaluation(
        id=str(evaluation_db.id),
        app_id=str(evaluation_db.app.id),
        user_id=str(evaluation_db.user.id),
        user_username=evaluation_db.user.username or "",
        status=evaluation_db.status,
        evaluation_type=evaluation_db.evaluation_type,
        evaluation_type_settings=evaluation_db.evaluation_type_settings,
        variant_ids=[str(variant) for variant in evaluation_db.variants],
        variant_names=variant_names,
        testset_id=str(evaluation_db.testset.id),
        testset_name=evaluation_db.testset.name,
        created_at=evaluation_db.created_at,
        updated_at=evaluation_db.updated_at,
    )


def evaluation_scenario_db_to_pydantic(
    evaluation_scenario_db: EvaluationScenarioDB,
) -> EvaluationScenario:
    return EvaluationScenario(
        id=str(evaluation_scenario_db.id),
        evaluation_id=str(evaluation_scenario_db.evaluation.id),
        inputs=evaluation_scenario_db.inputs,
        outputs=evaluation_scenario_db.outputs,
        vote=evaluation_scenario_db.vote,
        score=evaluation_scenario_db.score,
        correct_answer=evaluation_scenario_db.correct_answer,
        is_pinned=evaluation_scenario_db.is_pinned or False,
        note=evaluation_scenario_db.note or "",
    )


def app_variant_db_to_pydantic(
    app_variant_db: AppVariantDB, previous_variant_name: str = None
) -> AppVariant:
    return AppVariant(
        app_id=str(app_variant_db.app.id),
        app_name=app_variant_db.app.app_name,
        variant_name=app_variant_db.variant_name,
        parameters=app_variant_db.config.parameters,
        previous_variant_name=app_variant_db.previous_variant_name,
        organization_id=str(app_variant_db.organization.id),
        base_name=app_variant_db.base_name,
        config_name=app_variant_db.config_name,
    )


async def app_variant_db_to_output(app_variant_db: AppVariantDB) -> AppVariantOutput:
    if app_variant_db.base.deployment:
        deployment = await db_manager.get_deployment_by_objectid(
            app_variant_db.base.deployment
        )
        uri = deployment.uri
    else:
        deployment = None
        uri = None
    logger.info(f"uri: {uri} deployment: {app_variant_db.base.deployment} {deployment}")
    return AppVariantOutput(
        app_id=str(app_variant_db.app.id),
        app_name=str(app_variant_db.app.app_name),
        variant_name=app_variant_db.variant_name,
        variant_id=str(app_variant_db.id),
        user_id=str(app_variant_db.user.id),
        organization_id=str(app_variant_db.organization.id),
        parameters=app_variant_db.config.parameters,
        previous_variant_name=app_variant_db.previous_variant_name,
        base_name=app_variant_db.base_name,
        base_id=str(app_variant_db.base.id),
        config_name=app_variant_db.config_name,
        config_id=str(app_variant_db.config.id),
        uri=uri,
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
        deployed_variant_name = (
            await db_manager.get_app_variant_instance_by_id(deployed_app_variant_id)
        ).variant_name
    else:
        deployed_variant_name = None
    return EnvironmentOutput(
        name=environment_db.name,
        app_id=str(environment_db.app.id),
        deployed_app_variant_id=deployed_app_variant_id,
        deployed_variant_name=deployed_variant_name,
    )


def base_db_to_pydantic(base_db: VariantBaseDB) -> BaseOutput:
    return BaseOutput(base_id=str(base_db.id), base_name=base_db.base_name)


def app_db_to_pydantic(app_db: AppDB) -> App:
    return App(app_name=app_db.app_name, app_id=str(app_db.id))


def image_db_to_pydantic(image_db: ImageDB) -> ImageExtended:
    return ImageExtended(
        organization_id=str(image_db.organization.id),
        docker_id=image_db.docker_id,
        tags=image_db.tags,
        id=str(image_db.id),
    )


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


def spans_db_to_pydantic(spans_db: List[SpanDB]) -> List[Span]:
    return [
        Span(
            span_id=str(span_db.id),
            parent_span_id=str(span_db.parent_span_id),
            meta=span_db.meta,
            event_name=span_db.event_name,
            event_type=span_db.event_type,
            start_time=span_db.start_time,
            duration=span_db.duration,
            status=span_db.status,
            end_time=span_db.end_time,
            inputs=span_db.inputs,
            outputs=span_db.outputs,
            prompt_template=span_db.prompt_template,
            tokens_input=span_db.tokens_input,
            tokens_output=span_db.tokens_output,
            token_total=span_db.token_total,
            cost=span_db.cost,
            tags=span_db.tags,
        ).dict(exclude_unset=True)
        for span_db in spans_db
    ]


def feedback_db_to_pydantic(feedback_db: FeedbackDB) -> FeedbackOutput:
    return FeedbackOutput(
        feedback_id=str(feedback_db.uid),
        feedback=feedback_db.feedback,
        score=feedback_db.score,
        meta=feedback_db.meta,
        created_at=feedback_db.created_at,
    ).dict(exclude_unset=True)


def trace_db_to_pydantic(trace_db: TraceDB) -> Trace:
    feedbacks = trace_db.feedbacks
    if feedbacks is None:
        result = []
    else:
        result = [
            feedback_db_to_pydantic(feedback)
            for feedback in feedbacks
            if feedback is not None
        ]

    return Trace(
        trace_id=str(trace_db.id),
        app_id=trace_db.app_id,
        variant_id=trace_db.variant_id,
        cost=trace_db.cost,
        latency=trace_db.latency,
        status=trace_db.status,
        token_consumption=trace_db.token_consumption,
        tags=trace_db.tags,
        start_time=trace_db.start_time,
        end_time=trace_db.end_time,
        feedbacks=result,
        spans=[str(span) for span in trace_db.spans],
    ).dict(exclude_unset=True)


def user_db_to_pydantic(user_db: UserDB) -> User:
    return User(
        id=str(user_db.id),
        uid=user_db.uid,
        username=user_db.username,
        email=user_db.email,
    ).dict(exclude_unset=True)
