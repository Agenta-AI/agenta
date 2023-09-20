"""Converts db models to pydantic models
"""
from typing import List
from agenta_backend.models.db_models import (
    AppVariantDB,
    ImageDB,
    TemplateDB,
    SpanDB,
    TraceDB,
    FeedbackDB,
)
from agenta_backend.models.api.api_models import (
    AppVariant,
    ImageExtended,
    Template,
    Span,
    Trace,
    TraceInputs,
    TraceOutputs,
    SpanInputs,
    SpanOutputs,
    Feedback,
    TemplateImageInfo,
)


def app_variant_db_to_pydantic(
    app_variant_db: AppVariantDB, previous_variant_name: str = None
) -> AppVariant:
    return AppVariant(
        app_name=app_variant_db.app_name,
        variant_name=app_variant_db.variant_name,
        parameters=app_variant_db.parameters,
        previous_variant_name=app_variant_db.previous_variant_name,
    )


def image_db_to_pydantic(image_db: ImageDB) -> ImageExtended:
    return ImageExtended(
        docker_id=image_db.docker_id, tags=image_db.tags, id=str(image_db.id)
    )


def templates_db_to_pydantic(templates_db: List[TemplateDB]) -> List[Template]:
    return [
        Template(
            id=template.template_id,
            image=TemplateImageInfo(
                name=template.name,
                size=template.size,
                digest=template.digest,
                title=template.title,
                description=template.description,
                architecture=template.architecture,
                status=template.status,
                last_pushed=template.last_pushed,
                repo_name=template.repo_name,
                media_type=template.media_type,
            ),
        )
        for template in templates_db
    ]


def spans_db_to_pydantic(spans_db: List[SpanDB]) -> List[Span]:
    return [
        Span(
            span_id=str(span_db.span_id),
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


def feedback_db_to_pydantic(feedback_db: FeedbackDB) -> Feedback:
    return Feedback(
        feedback_id=str(feedback_db.feedback_id),
        feedback=feedback_db.feedback,
        trace_id=str(feedback_db.trace_id),
        score=feedback_db.score,
        created_at=feedback_db.created_at,
    ).dict(exclude_unset=True)


def trace_db_to_pydantic(trace_db: TraceDB) -> Trace:
    return Trace(
        trace_id=str(trace_db.trace_id),
        app_name=trace_db.app_name,
        variant_name=trace_db.variant_name,
        cost=trace_db.cost,
        latency=trace_db.latency,
        status=trace_db.status,
        token_consumption=trace_db.token_consumption,
        tags=trace_db.tags,
        start_time=trace_db.start_time,
        end_time=trace_db.end_time,
        spans=spans_db_to_pydantic(trace_db.spans),
    ).dict(exclude_unset=True)


def trace_outputs_to_pydantic(
    trace_id: str, trace_spans: List[SpanDB]
) -> TraceOutputs:
    return TraceOutputs(
        trace_id=trace_id,
        outputs=[
            SpanOutputs(id=str(span.id), outputs=span.outputs)
            for span in trace_spans
        ],
    )
    

def trace_inputs_to_pydantic(
    trace_id: str, trace_spans: List[SpanDB]
) -> TraceInputs:
    return TraceInputs(
        trace_id=trace_id,
        outputs=[
            SpanInputs(id=str(span.id), inputs=span.inputs)
            for span in trace_spans
        ],
    )
