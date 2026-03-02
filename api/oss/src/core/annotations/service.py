from typing import Optional, List, Dict, Any, Union
from uuid import UUID, uuid4

from fastapi import Request
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
    Focus,
    Format,
    TracingQuery,
    Formatting,
    Condition,
    Filtering,
    OTelLink,
    LogicalOperator,
    ComparisonOperator,
    ListOperator,
    TraceType,
    SpanType,
)
from oss.src.core.evaluators.dtos import (
    SimpleEvaluatorFlags,
    SimpleEvaluatorData,
)


from oss.src.core.tracing.utils import (
    parse_into_attributes,
    parse_from_attributes,
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

from oss.src.apis.fastapi.tracing.router import TracingRouter
from oss.src.apis.fastapi.tracing.models import (
    OTelFlatSpan,
    OTelTracingRequest,
    OTelTracingResponse,
)
from oss.src.apis.fastapi.evaluators.models import SimpleEvaluatorCreate

from oss.src.core.annotations.utils import validate_data_against_schema


log = get_module_logger(__name__)


class AnnotationsService:
    def __init__(
        self,
        *,
        evaluators_service: EvaluatorsService,
        simple_evaluators_service: SimpleEvaluatorsService,
        tracing_router: TracingRouter,
    ):
        self.evaluators_service = evaluators_service
        self.simple_evaluators_service = simple_evaluators_service
        self.tracing_router = tracing_router

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

        if isinstance(links, dict):
            _links = [
                OTelLink(
                    trace_id=link.trace_id,
                    span_id=link.span_id,
                    attributes={"key": key},  # type: ignore
                )
                for key, link in links.items()
                if link.trace_id and link.span_id
            ]
        elif isinstance(links, list):
            _links = [
                OTelLink(
                    trace_id=link.trace_id,
                    span_id=link.span_id,
                    attributes={"key": "key"},  # type: ignore
                )
                for link in links
                if link.trace_id and link.span_id
            ]

        else:
            _links = None

        _flags = flags.model_dump(mode="json", exclude_none=True)

        _type = {
            "trace": "annotation",
            "span": "task",
        }

        _attributes = parse_into_attributes(
            type=_type,
            flags=_flags,
            tags=tags,
            meta=meta,
            data=data,
            references=_references,
        )

        trace_request = OTelTracingRequest(
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
            ]
        )

        request = Request(
            scope={"type": "http", "http_version": "1.1", "scheme": "http"}
        )

        request.state.organization_id = str(organization_id)
        request.state.project_id = str(project_id)
        request.state.user_id = str(user_id)

        _links_response = await self.tracing_router.create_trace(
            request=request,
            #
            trace_request=trace_request,
            sync=True,  # Synchronous for user-facing annotations
        )

        _link = (
            Link(
                trace_id=_links_response.links[0].trace_id,
                span_id=_links_response.links[0].span_id,
            )
            if _links_response.links and len(_links_response.links) > 0
            else None
        )

        return _link

    async def _fetch_annotation(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID] = None,
        #
        annotation_link: Link,
    ) -> Optional[Annotation]:
        request = Request(
            scope={"type": "http", "http_version": "1.1", "scheme": "http"}
        )

        request.state.project_id = str(project_id)
        request.state.user_id = str(user_id) if user_id else None

        if not annotation_link.trace_id:
            return None

        trace_response: OTelTracingResponse = await self.tracing_router.fetch_trace(
            request=request,
            #
            trace_id=annotation_link.trace_id,
        )

        if not trace_response or not trace_response.traces:
            return None

        traces = list(trace_response.traces.values())
        trace = traces[0] if traces else None

        if not trace or not trace.spans:
            return None

        spans = list(trace.spans.values())
        root_span = spans[0] if spans else None

        if not root_span or isinstance(root_span, list):
            return None

        (
            type,
            flags,
            tags,
            meta,
            data,
            references,
        ) = parse_from_attributes(root_span.attributes or {})

        if not data:
            return None

        _references = AnnotationReferences(
            **{
                key: Reference(
                    id=ref.get("id"),
                    slug=ref.get("slug"),
                    version=ref.get("version"),
                )
                for key, ref in (references or {}).items()
            }
        )

        _links = dict(
            **{
                str(link.attributes["key"]): Link(
                    trace_id=link.trace_id,
                    span_id=link.span_id,
                )
                for link in root_span.links or []
                if link.attributes and "key" in link.attributes
            }
        )

        _origin = (
            (
                flags.get("is_custom")
                and AnnotationOrigin.CUSTOM
                or flags.get("is_human")
                and AnnotationOrigin.HUMAN
                or AnnotationOrigin.AUTO
            )
            if flags
            else AnnotationOrigin.CUSTOM
        )

        _kind = (
            (flags.get("is_evaluation") and AnnotationKind.EVAL or AnnotationKind.ADHOC)
            if flags
            else AnnotationKind.ADHOC
        )

        _channel = (
            (
                flags.get("is_sdk")
                and AnnotationChannel.SDK
                or flags.get("is_web")
                and AnnotationChannel.WEB
                or AnnotationChannel.API
            )
            if flags
            else AnnotationChannel.API
        )

        annotation = Annotation(
            trace_id=root_span.trace_id,
            span_id=root_span.span_id,
            #
            created_at=root_span.created_at,
            updated_at=root_span.updated_at,
            deleted_at=root_span.deleted_at,
            created_by_id=root_span.created_by_id,
            updated_by_id=root_span.updated_by_id,
            deleted_by_id=root_span.deleted_by_id,
            #
            origin=_origin,
            kind=_kind,
            channel=_channel,
            #
            tags=tags,
            meta=meta,
            #
            data=data,
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

        if isinstance(links, dict):
            _links = [
                OTelLink(
                    trace_id=link.trace_id,
                    span_id=link.span_id,
                    attributes={"key": key},  # type: ignore
                )
                for key, link in links.items()
                if link.trace_id and link.span_id
            ]
        elif isinstance(links, list):
            _links = [
                OTelLink(
                    trace_id=link.trace_id,
                    span_id=link.span_id,
                    attributes={"key": "key"},  # type: ignore
                )
                for link in links
                if link.trace_id and link.span_id
            ]
        else:
            _links = None

        _flags = flags.model_dump(mode="json", exclude_none=True)

        _type = {
            "trace": "annotation",
            "span": "task",
        }

        _attributes = parse_into_attributes(
            type=_type,
            flags=_flags,
            tags=tags,
            meta=meta,
            data=data,
            references=_references,
        )

        trace_request = OTelTracingRequest(
            spans=[
                OTelFlatSpan(
                    trace_id=annotation.trace_id,
                    span_id=annotation.span_id,
                    attributes=_attributes,
                    links=_links,
                )
            ]
        )

        request = Request(
            scope={"type": "http", "http_version": "1.1", "scheme": "http"}
        )

        request.state.organization_id = str(organization_id)
        request.state.project_id = str(project_id)
        request.state.user_id = str(user_id)

        _links_response = await self.tracing_router.edit_trace(
            request=request,
            #
            trace_id=annotation.trace_id,
            #
            trace_request=trace_request,
            sync=True,  # Synchronous for user-facing annotations
        )

        _link = (
            Link(
                trace_id=_links_response.links[0].trace_id,
                span_id=_links_response.links[0].span_id,
            )
            if _links_response.links and len(_links_response.links) > 0
            else None
        )

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

        request = Request(
            scope={"type": "http", "http_version": "1.1", "scheme": "http"}
        )

        request.state.project_id = str(project_id)
        request.state.user_id = str(user_id)

        link_response = await self.tracing_router.delete_trace(
            request=request,
            #
            trace_id=annotation_link.trace_id,
        )

        link = link_response.links[0] if link_response.links else None

        if not link or not link.trace_id or not link.span_id:
            return None

        annotation_link = Link(
            trace_id=link.trace_id,
            span_id=link.span_id,
        )

        return annotation_link

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
        formatting = Formatting(
            focus=Focus.TRACE,
            format=Format.AGENTA,
        )

        filtering = Filtering()

        conditions: List[Union[Condition, Filtering]] = [
            Condition(
                field="attributes",
                key="ag.type.trace",
                value="annotation",
                operator=ComparisonOperator.IS,
            )
        ]

        trace_ids = (
            [annotation_link.trace_id for annotation_link in annotation_links]
            if annotation_links
            else None
        )

        # span_ids = (
        #     [annotation_link.span_id for annotation_link in annotation_links]
        #     if annotation_links
        #     else None
        # )

        if trace_ids:
            conditions.append(
                Condition(
                    field="trace_id",
                    value=trace_ids,
                    operator=ListOperator.IN,
                )
            )

        # if span_ids:
        #     conditions.append(
        #         Condition(
        #             field="span_id",
        #             value=span_ids,
        #             operator=ListOperator.IN,
        #         )
        #     )

        if flags:
            for key, value in flags.model_dump(mode="json", exclude_none=True).items():
                conditions.append(
                    Condition(
                        field="attributes",
                        key=f"ag.flags.{key}",
                        value=value,
                        operator=ComparisonOperator.IS,
                    )
                )

        if tags:
            for key, value in tags.items():
                conditions.append(
                    Condition(
                        field="attributes",
                        key=f"ag.tags.{key}",
                        value=value,  # type:ignore
                        operator=ComparisonOperator.IS,
                    )
                )

        if meta:
            for key, value in meta.items():
                conditions.append(
                    Condition(
                        field="attributes",
                        key=f"ag.meta.{key}",
                        value=value,  # type:ignore
                        operator=ComparisonOperator.IS,
                    )
                )

        if references:
            for _, reference in references.model_dump(mode="json").items():
                if reference:
                    ref_id = str(reference.get("id")) if reference.get("id") else None
                    ref_slug = (
                        str(reference.get("slug")) if reference.get("slug") else None
                    )
                    conditions.append(
                        Condition(
                            field="references",
                            value=[
                                {"id": ref_id, "slug": ref_slug},
                            ],
                            operator=ListOperator.IN,
                        )
                    )

        if links:
            if isinstance(links, dict):
                for _, link in links.items():
                    if link:
                        conditions.append(
                            Condition(
                                field="links",
                                value=[
                                    {
                                        "trace_id": link.trace_id,
                                        "span_id": link.span_id,
                                    },
                                ],
                                operator=ListOperator.IN,
                            )
                        )
            elif isinstance(links, list):
                _conditions = []
                for link in links:
                    if link:
                        _conditions.append(
                            Condition(
                                field="links",
                                value=[
                                    {
                                        "trace_id": link.trace_id,
                                        "span_id": link.span_id,
                                    },
                                ],
                                operator=ListOperator.IN,
                            )
                        )
                if _conditions:
                    conditions.append(
                        Filtering(
                            operator=LogicalOperator.OR,
                            conditions=_conditions,
                        )
                    )

        if conditions:
            filtering = Filtering(
                operator=LogicalOperator.AND,
                conditions=conditions,
            )

        query = TracingQuery(
            formatting=formatting,
            filtering=filtering,
            windowing=windowing,
        )

        request = Request(
            scope={"type": "http", "http_version": "1.1", "scheme": "http"}
        )

        request.state.project_id = str(project_id)
        request.state.user_id = str(user_id) if user_id else None

        spans_response: OTelTracingResponse = await self.tracing_router.query_spans(
            request=request,
            #
            query=query,
        )

        if not spans_response or not spans_response.traces:
            return []

        traces = list(spans_response.traces.values())

        annotations = []

        for trace in traces:
            if not trace or not trace.spans:
                continue

            spans = list(trace.spans.values())
            root_span = spans[0] if spans else None

            if not root_span or isinstance(root_span, list):
                continue

            (
                __type,
                __flags,
                __tags,
                __meta,
                __data,
                __references,
            ) = parse_from_attributes(root_span.attributes or {})

            if not __data:
                continue

            _references = AnnotationReferences(
                **{
                    key: Reference(
                        id=ref.get("id"),
                        slug=ref.get("slug"),
                        version=ref.get("version"),
                    )
                    for key, ref in (__references or {}).items()
                }
            )

            _links = dict(
                **{
                    str(link.attributes["key"]): Link(
                        trace_id=link.trace_id,
                        span_id=link.span_id,
                    )
                    for link in root_span.links or []
                    if link.attributes and "key" in link.attributes
                }
            )

            _origin = (
                (
                    __flags.get("is_custom")
                    and AnnotationOrigin.CUSTOM
                    or __flags.get("is_human")
                    and AnnotationOrigin.HUMAN
                    or AnnotationOrigin.AUTO
                )
                if __flags
                else AnnotationOrigin.CUSTOM
            )

            _kind = (
                (
                    __flags.get("is_evaluation")
                    and AnnotationKind.EVAL
                    or AnnotationKind.ADHOC
                )
                if __flags
                else AnnotationKind.ADHOC
            )

            _channel = (
                (
                    __flags.get("is_sdk")
                    and AnnotationChannel.SDK
                    or __flags.get("is_web")
                    and AnnotationChannel.WEB
                    or AnnotationChannel.API
                )
                if __flags
                else AnnotationChannel.API
            )

            annotation = Annotation(
                trace_id=root_span.trace_id,
                span_id=root_span.span_id,
                #
                created_at=root_span.created_at,
                updated_at=root_span.updated_at,
                deleted_at=root_span.deleted_at,
                created_by_id=root_span.created_by_id,
                updated_by_id=root_span.updated_by_id,
                deleted_by_id=root_span.deleted_by_id,
                #
                origin=_origin,
                kind=_kind,
                channel=_channel,
                #
                tags=__tags,
                meta=__meta,
                #
                data=__data,
                #
                references=_references,
                links=_links,
            )

            annotations.append(annotation)

        return annotations
