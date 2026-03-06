from typing import Optional, List, Dict, Any
from uuid import UUID, uuid4

from genson import SchemaBuilder

from oss.src.utils.logging import get_module_logger

from oss.src.core.evaluators.service import EvaluatorsService
from oss.src.core.evaluators.service import SimpleEvaluatorsService

from oss.src.core.shared.dtos import (
    Tags,
    Meta,
    Data,
    Reference,
    Link,
    Windowing,
)
from oss.src.core.tracing.dtos import (
    OTelFlatSpan,
    TraceType,
    SpanType,
)
from oss.src.core.tracing.service import TracingService
from oss.src.core.evaluators.dtos import (
    SimpleEvaluatorCreate,
    SimpleEvaluatorFlags,
    SimpleEvaluatorData,
)
from oss.src.core.tracing.utils.traces import (
    build_otel_links,
    build_simple_trace_attributes,
    build_simple_trace_query,
    first_link,
    parse_simple_trace,
)
from oss.src.core.annotations.types import (
    AnnotationOrigin,
    AnnotationKind,
    AnnotationChannel,
    AnnotationReferences,
    AnnotationLinks,
    AnnotationFlags,
    AnnotationQueryFlags,
    #
    Annotation,
    AnnotationCreate,
    AnnotationEdit,
    AnnotationQuery,
)

from oss.src.core.annotations.utils import validate_data_against_schema


log = get_module_logger(__name__)


class AnnotationsService:
    def __init__(
        self,
        *,
        evaluators_service: EvaluatorsService,
        simple_evaluators_service: SimpleEvaluatorsService,
        tracing_service: TracingService,
    ):
        self.evaluators_service = evaluators_service
        self.simple_evaluators_service = simple_evaluators_service
        self.tracing_service = tracing_service

    async def create(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        user_id: UUID,
        #
        annotation_create: AnnotationCreate,
    ) -> Optional[Annotation]:
        simple_evaluator_slug = (
            annotation_create.references.evaluator.slug
            if annotation_create.references.evaluator
            else None
        ) or uuid4().hex[-12:]

        simple_evaluator_flags = SimpleEvaluatorFlags(
            is_evaluator=True,
            is_custom=annotation_create.origin == AnnotationOrigin.CUSTOM,
            is_human=annotation_create.origin == AnnotationOrigin.HUMAN,
        )

        evaluator_revision = await self.evaluators_service.fetch_evaluator_revision(
            project_id=project_id,
            #
            evaluator_ref=annotation_create.references.evaluator,
            evaluator_variant_ref=annotation_create.references.evaluator_variant,
            evaluator_revision_ref=annotation_create.references.evaluator_revision,
        )

        if evaluator_revision is None:
            builder = SchemaBuilder()
            builder.add_object(annotation_create.data)
            evaluator_outputs_schema: Dict[str, Any] = builder.to_schema()

            simple_evaluator_data = SimpleEvaluatorData(
                schemas=dict(
                    outputs=evaluator_outputs_schema,
                ),
                service=dict(
                    agenta="v0.1.0",
                    format=evaluator_outputs_schema,
                ),
            )

            simple_evaluator_create = SimpleEvaluatorCreate(
                slug=simple_evaluator_slug,
                #
                name=simple_evaluator_slug,
                #
                flags=simple_evaluator_flags,
                #
                data=simple_evaluator_data,
            )

            simple_evaluator = await self.simple_evaluators_service.create(
                project_id=project_id,
                user_id=user_id,
                #
                simple_evaluator_create=simple_evaluator_create,
            )

            if simple_evaluator:
                evaluator_revision = (
                    await self.evaluators_service.fetch_evaluator_revision(
                        project_id=project_id,
                        #
                        evaluator_ref=Reference(id=simple_evaluator.id),
                    )
                )
        elif evaluator_revision.evaluator_id:
            simple_evaluator = await self.simple_evaluators_service.fetch(
                project_id=project_id,
                evaluator_id=evaluator_revision.evaluator_id,
            )
        else:
            simple_evaluator = None

        if not evaluator_revision or not evaluator_revision.data:
            return None

        validate_data_against_schema(
            annotation_create.data,
            (
                evaluator_revision.data.service.get("format", {})
                if evaluator_revision.data.service
                else {}
            ),
        )

        annotation_create.references.evaluator = Reference(
            id=evaluator_revision.evaluator_id,
            slug=(
                annotation_create.references.evaluator.slug
                if annotation_create.references.evaluator
                else None
            ),
        )

        annotation_create.references.evaluator_variant = Reference(
            id=evaluator_revision.evaluator_variant_id,
            slug=(
                annotation_create.references.evaluator_variant.slug
                if annotation_create.references.evaluator_variant
                else None
            ),
        )

        annotation_create.references.evaluator_revision = Reference(
            id=evaluator_revision.id,
            slug=evaluator_revision.slug,
            version=evaluator_revision.version,
        )

        annotation_flags = AnnotationFlags(
            is_evaluator=True,
            is_custom=annotation_create.origin == AnnotationOrigin.CUSTOM,
            is_human=annotation_create.origin == AnnotationOrigin.HUMAN,
            is_sdk=annotation_create.channel == AnnotationChannel.SDK,
            is_web=annotation_create.channel == AnnotationChannel.WEB,
            is_evaluation=annotation_create.kind == AnnotationKind.EVAL,
        )

        annotation_references = AnnotationReferences(
            **annotation_create.references.model_dump(),
        )

        annotation_link = await self._create_annotation(
            organization_id=organization_id,
            project_id=project_id,
            user_id=user_id,
            #
            name=simple_evaluator.name if simple_evaluator else None,
            #
            flags=annotation_flags,
            tags=annotation_create.tags,
            meta=annotation_create.meta,
            #
            data=annotation_create.data,
            #
            references=annotation_references,
            links=annotation_create.links,
        )

        if annotation_link is None:
            return None

        annotation = await self._fetch_annotation(
            project_id=project_id,
            user_id=user_id,
            #
            annotation_link=annotation_link,
        )

        return annotation

    async def fetch(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID] = None,
        #
        trace_id: str,
        span_id: Optional[str] = None,
    ):
        annotation_link = Link(
            trace_id=trace_id,
            span_id=span_id,
        )

        annotation: Optional[Annotation] = await self._fetch_annotation(
            project_id=project_id,
            user_id=user_id,
            #
            annotation_link=annotation_link,
        )
        return annotation

    async def edit(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        user_id: UUID,
        #
        trace_id: str,
        span_id: Optional[str] = None,
        #
        annotation_edit: AnnotationEdit,
    ):
        annotation_link = Link(
            trace_id=trace_id,
            span_id=span_id,
        )

        annotation: Optional[Annotation] = await self._fetch_annotation(
            project_id=project_id,
            user_id=user_id,
            #
            annotation_link=annotation_link,
        )

        if annotation is None:
            return None

        simple_evaluator_slug = (
            annotation.references.evaluator.slug
            if annotation.references.evaluator
            else None
        ) or uuid4().hex[-12:]

        simple_evaluator_flags = SimpleEvaluatorFlags(
            is_evaluator=True,
            is_custom=annotation.origin == AnnotationOrigin.CUSTOM,
            is_human=annotation.origin == AnnotationOrigin.HUMAN,
        )

        evaluator_revision = await self.evaluators_service.fetch_evaluator_revision(
            project_id=project_id,
            #
            evaluator_ref=annotation.references.evaluator,
            evaluator_variant_ref=annotation.references.evaluator_variant,
            evaluator_revision_ref=annotation.references.evaluator_revision,
        )

        if not evaluator_revision:
            builder = SchemaBuilder()
            builder.add_object(annotation_edit.data)
            evaluator_outputs_schema: Dict[str, Any] = builder.to_schema()

            simple_evaluator_data = SimpleEvaluatorData(
                schemas=dict(
                    outputs=evaluator_outputs_schema,
                ),
                service=dict(
                    agenta="v0.1.0",
                    format=evaluator_outputs_schema,
                ),
            )

            simple_evaluator_create = SimpleEvaluatorCreate(
                slug=simple_evaluator_slug,
                #
                name=simple_evaluator_slug,
                #
                flags=simple_evaluator_flags,
                #
                data=simple_evaluator_data,
            )

            simple_evaluator = await self.simple_evaluators_service.create(
                project_id=project_id,
                user_id=user_id,
                #
                simple_evaluator_create=simple_evaluator_create,
            )

            if simple_evaluator:
                evaluator_revision = (
                    await self.evaluators_service.fetch_evaluator_revision(
                        project_id=project_id,
                        #
                        evaluator_ref=Reference(id=simple_evaluator.id),
                    )
                )

        if not evaluator_revision or not evaluator_revision.data:
            return None

        validate_data_against_schema(
            annotation_edit.data,
            (
                evaluator_revision.data.service.get("format", {})
                if evaluator_revision.data.service
                else {}
            ),
        )

        if evaluator_revision:
            annotation.references.evaluator = Reference(
                id=evaluator_revision.evaluator_id,
                slug=(
                    annotation.references.evaluator.slug
                    if annotation.references.evaluator
                    else None
                ),
            )

            annotation.references.evaluator_variant = Reference(
                id=evaluator_revision.evaluator_variant_id,
                slug=(
                    annotation.references.evaluator_variant.slug
                    if annotation.references.evaluator_variant
                    else None
                ),
            )

            annotation.references.evaluator_revision = Reference(
                id=evaluator_revision.id,
                slug=evaluator_revision.slug,
                version=evaluator_revision.version,
            )

        annotation_flags = AnnotationFlags(
            is_evaluator=True,
            is_custom=annotation.origin == AnnotationOrigin.CUSTOM,
            is_human=annotation.origin == AnnotationOrigin.HUMAN,
            is_sdk=annotation.channel == AnnotationChannel.SDK,
            is_web=annotation.channel == AnnotationChannel.WEB,
            is_evaluation=annotation.kind == AnnotationKind.EVAL,
        )

        annotation_references = AnnotationReferences(
            **annotation.references.model_dump(),
        )

        annotation_link = await self._edit_annotation(
            organization_id=organization_id,
            project_id=project_id,
            user_id=user_id,
            #
            annotation=annotation,
            #
            flags=annotation_flags,
            tags=annotation_edit.tags,
            meta=annotation_edit.meta,
            #
            data=annotation_edit.data,
            #
            references=annotation_references,
            links=annotation.links,
        )

        if annotation_link is None:
            return None

        annotation = await self._fetch_annotation(
            project_id=project_id,
            user_id=user_id,
            #
            annotation_link=annotation_link,
        )

        return annotation

    async def delete(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        trace_id: str,
        span_id: Optional[str] = None,
    ):
        annotation_link = Link(
            trace_id=trace_id,
            span_id=span_id,
        )

        annotation_link = await self._delete_annotation(
            project_id=project_id,
            user_id=user_id,
            #
            annotation_link=annotation_link,
        )

        return annotation_link

    async def query(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID] = None,
        #
        annotation_query: Optional[AnnotationQuery] = None,
        #
        annotation_links: Optional[AnnotationLinks] = None,
        #
        windowing: Optional[Windowing] = None,
    ):
        annotation = annotation_query if annotation_query else None
        annotation_flags = AnnotationQueryFlags(is_evaluator=True)

        if annotation:
            if annotation.origin:
                annotation_flags.is_custom = (
                    annotation.origin == AnnotationOrigin.CUSTOM
                )
                annotation_flags.is_human = annotation.origin == AnnotationOrigin.HUMAN

            if annotation.channel:
                annotation_flags.is_sdk = annotation.channel == AnnotationChannel.SDK
                annotation_flags.is_web = annotation.channel == AnnotationChannel.WEB

            if annotation.kind:
                annotation_flags.is_evaluation = annotation.kind == AnnotationKind.EVAL

        annotation_tags = annotation.tags if annotation else None
        annotation_meta = annotation.meta if annotation else None

        annotation_references = (
            AnnotationReferences(
                **annotation.references.model_dump(),
            )
            if annotation and annotation.references
            else None
        )

        _annotation_links = annotation.links if annotation else None

        annotations = await self._query_annotation(
            project_id=project_id,
            user_id=user_id,
            #
            flags=annotation_flags,
            tags=annotation_tags,
            meta=annotation_meta,
            #
            references=annotation_references,
            links=_annotation_links,
            #
            annotation_links=annotation_links,
            #
            windowing=windowing,
        )
        return annotations

    # -------- Internal Functions -------------------------------------------------------------------

    async def _create_annotation(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        user_id: UUID,
        #
        name: Optional[str],
        #
        flags: AnnotationFlags,
        tags: Optional[Tags] = None,
        meta: Optional[Meta] = None,
        #
        data: Data,
        #
        references: AnnotationReferences,
        links: AnnotationLinks,
    ) -> Optional[Link]:
        trace_id = uuid4().hex
        trace_type = TraceType.ANNOTATION

        span_id = uuid4().hex[16:]
        span_type = SpanType.TASK
        span_name = name or references.evaluator.slug or "annotation"

        _references = references.model_dump(
            mode="json",
            exclude_none=True,
            exclude_unset=True,
        )

        _links = build_otel_links(links)

        _flags = flags.model_dump(mode="json", exclude_none=True)

        _attributes = build_simple_trace_attributes(
            trace_kind="annotation",
            flags=_flags,
            tags=tags,
            meta=meta,
            data=data,
            references=_references,
        )

        links = await self.tracing_service.create_trace(
            organization_id=organization_id,
            project_id=project_id,
            user_id=user_id,
            spans=[
                OTelFlatSpan(
                    trace_id=trace_id,
                    trace_type=trace_type,
                    span_id=span_id,
                    span_type=span_type,
                    span_name=span_name,
                    attributes=_attributes,
                    links=_links,
                )
            ],
            sync=True,  # Synchronous for user-facing annotations
        )

        _link = first_link(links)

        return _link

    async def _fetch_annotation(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID] = None,
        #
        annotation_link: Link,
    ) -> Optional[Annotation]:
        if not annotation_link.trace_id:
            return None

        trace = await self.tracing_service.fetch_trace(
            project_id=project_id,
            trace_id=annotation_link.trace_id,
        )

        parsed_trace = parse_simple_trace(trace)
        if parsed_trace is None:
            return None

        _references = AnnotationReferences(
            **parsed_trace.references,
        )

        _links = parsed_trace.links

        _origin = (
            (
                parsed_trace.flags.get("is_custom")
                and AnnotationOrigin.CUSTOM
                or parsed_trace.flags.get("is_human")
                and AnnotationOrigin.HUMAN
                or AnnotationOrigin.AUTO
            )
            if parsed_trace.flags
            else AnnotationOrigin.CUSTOM
        )

        _kind = (
            (
                parsed_trace.flags.get("is_evaluation")
                and AnnotationKind.EVAL
                or AnnotationKind.ADHOC
            )
            if parsed_trace.flags
            else AnnotationKind.ADHOC
        )

        _channel = (
            (
                parsed_trace.flags.get("is_sdk")
                and AnnotationChannel.SDK
                or parsed_trace.flags.get("is_web")
                and AnnotationChannel.WEB
                or AnnotationChannel.API
            )
            if parsed_trace.flags
            else AnnotationChannel.API
        )

        annotation = Annotation(
            trace_id=parsed_trace.span.trace_id,
            span_id=parsed_trace.span.span_id,
            #
            created_at=parsed_trace.span.created_at,
            updated_at=parsed_trace.span.updated_at,
            deleted_at=parsed_trace.span.deleted_at,
            created_by_id=parsed_trace.span.created_by_id,
            updated_by_id=parsed_trace.span.updated_by_id,
            deleted_by_id=parsed_trace.span.deleted_by_id,
            #
            origin=_origin,
            kind=_kind,
            channel=_channel,
            #
            tags=parsed_trace.tags,
            meta=parsed_trace.meta,
            #
            data=parsed_trace.data,
            #
            references=_references,
            links=_links,
        )

        return annotation

    async def _edit_annotation(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        user_id: UUID,
        #
        annotation: Annotation,
        #
        flags: AnnotationFlags,
        tags: Optional[Tags] = None,
        meta: Optional[Meta] = None,
        #
        data: Data,
        #
        references: AnnotationReferences,
        links: AnnotationLinks,
    ) -> Optional[Link]:
        if not annotation.trace_id or not annotation.span_id:
            return None

        _references = references.model_dump(
            mode="json",
            exclude_none=True,
            exclude_unset=True,
        )

        _links = build_otel_links(links)

        _flags = flags.model_dump(mode="json", exclude_none=True)

        _attributes = build_simple_trace_attributes(
            trace_kind="annotation",
            flags=_flags,
            tags=tags,
            meta=meta,
            data=data,
            references=_references,
        )

        links = await self.tracing_service.edit_trace(
            organization_id=organization_id,
            project_id=project_id,
            user_id=user_id,
            spans=[
                OTelFlatSpan(
                    trace_id=annotation.trace_id,
                    span_id=annotation.span_id,
                    attributes=_attributes,
                    links=_links,
                )
            ],
            sync=True,  # Synchronous for user-facing annotations
        )

        _link = first_link(links)

        return _link

    async def _delete_annotation(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        annotation_link: Link,
    ) -> Optional[Link]:
        if not annotation_link.trace_id:
            return None

        links = await self.tracing_service.delete_trace(
            project_id=project_id,
            trace_id=annotation_link.trace_id,
        )

        return first_link(links)

    async def _query_annotation(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID] = None,
        #
        flags: Optional[AnnotationFlags] = None,
        tags: Optional[Tags] = None,
        meta: Optional[Meta] = None,
        #
        references: Optional[AnnotationReferences] = None,
        links: Optional[AnnotationLinks] = None,
        #
        annotation_links: Optional[List[Link]] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Annotation]:
        query = build_simple_trace_query(
            trace_kind="annotation",
            flags=flags.model_dump(mode="json", exclude_none=True) if flags else None,
            tags=tags,
            meta=meta,
            references=references.model_dump(mode="json") if references else None,
            links=links,
            trace_links=annotation_links,
            windowing=windowing,
        )

        traces = await self.tracing_service.query_traces(
            project_id=project_id,
            query=query,
        )

        if not traces:
            return []

        annotations = []

        for trace in traces:
            parsed_trace = parse_simple_trace(trace)
            if parsed_trace is None:
                continue

            _references = AnnotationReferences(
                **parsed_trace.references,
            )

            _links = parsed_trace.links

            _origin = (
                (
                    parsed_trace.flags.get("is_custom")
                    and AnnotationOrigin.CUSTOM
                    or parsed_trace.flags.get("is_human")
                    and AnnotationOrigin.HUMAN
                    or AnnotationOrigin.AUTO
                )
                if parsed_trace.flags
                else AnnotationOrigin.CUSTOM
            )

            _kind = (
                (
                    parsed_trace.flags.get("is_evaluation")
                    and AnnotationKind.EVAL
                    or AnnotationKind.ADHOC
                )
                if parsed_trace.flags
                else AnnotationKind.ADHOC
            )

            _channel = (
                (
                    parsed_trace.flags.get("is_sdk")
                    and AnnotationChannel.SDK
                    or parsed_trace.flags.get("is_web")
                    and AnnotationChannel.WEB
                    or AnnotationChannel.API
                )
                if parsed_trace.flags
                else AnnotationChannel.API
            )

            annotation = Annotation(
                trace_id=parsed_trace.span.trace_id,
                span_id=parsed_trace.span.span_id,
                #
                created_at=parsed_trace.span.created_at,
                updated_at=parsed_trace.span.updated_at,
                deleted_at=parsed_trace.span.deleted_at,
                created_by_id=parsed_trace.span.created_by_id,
                updated_by_id=parsed_trace.span.updated_by_id,
                deleted_by_id=parsed_trace.span.deleted_by_id,
                #
                origin=_origin,
                kind=_kind,
                channel=_channel,
                #
                tags=parsed_trace.tags,
                meta=parsed_trace.meta,
                #
                data=parsed_trace.data,
                #
                references=_references,
                links=_links,
            )

            annotations.append(annotation)

        return annotations
