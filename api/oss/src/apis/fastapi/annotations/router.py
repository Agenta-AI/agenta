from typing import Optional, List
from uuid import uuid4

from genson import SchemaBuilder

from fastapi import APIRouter, Request, status, HTTPException, Response

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache

from oss.src.core.shared.dtos import Flags, Tags, Meta, Data, Reference, Link, Windowing
from oss.src.core.tracing.dtos import OTelLink, OTelReference
from oss.src.core.tracing.dtos import Focus, Format, Query, Formatting, Filtering
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.tracing.service import TracingService
from oss.src.apis.fastapi.tracing.router import TracingRouter
from oss.src.apis.fastapi.evaluators.router import SimpleEvaluatorsRouter

from oss.src.apis.fastapi.tracing.models import (
    OTelFlatSpan,
    OTelTracingRequest,
    OTelTracingResponse,
)

from oss.src.apis.fastapi.evaluators.models import (
    SimpleEvaluatorFlags,
    SimpleEvaluatorCreate,
    SimpleEvaluatorCreateRequest,
    SimpleEvaluatorQueryRequest,
)
from oss.src.apis.fastapi.annotations.models import Annotation

from oss.src.apis.fastapi.annotations.utils import (
    validate_data_against_schema,
    parse_into_attributes,
    parse_from_attributes,
)

from oss.src.apis.fastapi.annotations.models import (
    AnnotationCreateRequest,
    AnnotationEditRequest,
    AnnotationResponse,
    AnnotationsResponse,
    AnnotationQueryRequest,
    AnnotationLinkResponse,
    Annotation,
    AnnotationOrigin,
    AnnotationKind,
    AnnotationChannel,
    AnnotationReferences,
    AnnotationLinks,
)

from oss.src.apis.fastapi.annotations.utils import (
    AnnotationFlags,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)


class AnnotationsRouter:
    VERSION = "v1"

    def __init__(
        self,
        *,
        tracing_service: TracingService,
        workflows_service: WorkflowsService,
    ):
        self.tracing_service = tracing_service
        self.workflows_service = workflows_service

        # Needed until we clean up the router/service     # FIX ME / REMOVE ME #
        self.tracing_router = TracingRouter(
            tracing_service=self.tracing_service,
        )

        self.evaluators_router = SimpleEvaluatorsRouter(
            workflows_service=self.workflows_service
        )

        self.router = APIRouter()

        # POST /api/v1/annotations/
        self.router.add_api_route(
            "/",
            self.create_annotation,
            methods=["POST"],
            operation_id="create_annotation",
            status_code=status.HTTP_200_OK,
            response_model=AnnotationResponse,
            response_model_exclude_none=True,
        )

        # GET /api/v1/annotations/{trace_id}/{span_id}
        self.router.add_api_route(
            "/{trace_id}/{span_id}",
            self.fetch_annotation,
            methods=["GET"],
            operation_id="fetch_annotation",
            status_code=status.HTTP_200_OK,
            response_model=AnnotationResponse,
            response_model_exclude_none=True,
        )
        # PUT /api/v1/annotations/{trace_id}/{span_id}
        self.router.add_api_route(
            "/{trace_id}/{span_id}",
            self.edit_annotation,
            methods=["PATCH"],
            operation_id="edit_annotation",
            status_code=status.HTTP_200_OK,
            response_model=AnnotationResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/v1/annotations/{trace_id}/{span_id}
        self.router.add_api_route(
            "/{trace_id}/{span_id}",
            self.delete_annotation,
            methods=["DELETE"],
            operation_id="delete_annotation",
            status_code=status.HTTP_200_OK,
            response_model=AnnotationLinkResponse,
            response_model_exclude_none=True,
        )

        # GET /api/v1/annotations/?...
        self.router.add_api_route(
            "/",
            self.query_annotations,
            methods=["GET"],
            operation_id="list_annotations",
            status_code=status.HTTP_200_OK,
            response_model=AnnotationResponse,
            response_model_exclude_none=True,
        )

        # POST /api/v1/annotations/query                  # FIX ME / REMOVE ME #
        self.router.add_api_route(
            "/query",
            self.query_annotations,
            methods=["POST"],
            operation_id="query_annotations",
            status_code=status.HTTP_200_OK,
            response_model=AnnotationsResponse,
            response_model_exclude_none=True,
        )

    @intercept_exceptions()
    async def create_annotation(
        self,
        *,
        request: Request,
        annotation_create_request: AnnotationCreateRequest,
    ) -> AnnotationResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ANNOTATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        annotation_origin = annotation_create_request.annotation.origin

        evaluator_flags = SimpleEvaluatorFlags(
            is_evaluator=True,
            is_custom=annotation_origin == AnnotationOrigin.CUSTOM,
            is_human=annotation_origin == AnnotationOrigin.HUMAN,
        )

        evaluator = None

        if annotation_create_request.annotation.references.evaluator.slug:
            simple_evaluator_query_request = SimpleEvaluatorQueryRequest(
                evaluator_refs=[
                    Reference(
                        slug=annotation_create_request.annotation.references.evaluator.slug
                    )
                ]
            )

            simple_evaluator_response = (
                await self.evaluators_router.query_simple_evaluators(
                    request=request,
                    simple_evaluator_query_request=simple_evaluator_query_request,
                )
            )

            if simple_evaluator_response.count > 0:
                evaluator = simple_evaluator_response.evaluators[0]

        if evaluator is None:
            builder = SchemaBuilder()
            builder.add_object(annotation_create_request.annotation.data)
            evaluator_format = builder.to_schema()  # pylint: disable=redefined-builtin

            evaluator_slug = (
                annotation_create_request.annotation.references.evaluator.slug
                or uuid4().hex
            )

            evaluator_data = dict(
                service=dict(
                    agenta="v0.1.0",
                    format=evaluator_format,
                )
            )

            simple_evaluator_create_request = SimpleEvaluatorCreateRequest(
                evaluator=SimpleEvaluatorCreate(
                    slug=evaluator_slug,
                    #
                    name=evaluator_slug,  # yes
                    # description =
                    #
                    flags=evaluator_flags,
                    tags=annotation_create_request.annotation.tags,
                    meta=annotation_create_request.annotation.meta,
                    #
                    data=evaluator_data,
                )
            )

            simple_evaluator_create_response = (
                await self.evaluators_router.create_simple_evaluator(
                    request=request,
                    simple_evaluator_create_request=simple_evaluator_create_request,
                )
            )

            if simple_evaluator_create_response.count > 0:
                evaluator = simple_evaluator_create_response.evaluator

        if evaluator is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create evaluator. Please try again or contact support.",
            )

        validate_data_against_schema(
            annotation_create_request.annotation.data,
            evaluator.data.service.get("format", {}),
        )

        annotation_create_request.annotation.references.evaluator = Reference(
            id=evaluator.id,
            slug=evaluator.slug,
        )

        kind = annotation_create_request.annotation.kind
        channel = annotation_create_request.annotation.channel

        annotation_flags = AnnotationFlags(
            is_evaluator=True,
            is_custom=evaluator_flags.is_custom,
            is_human=evaluator_flags.is_human,
            is_sdk=channel == AnnotationChannel.SDK,
            is_web=channel == AnnotationChannel.WEB,
            is_evaluation=kind == AnnotationKind.EVAL,
        )

        annotation_link: Optional[Link] = await self._create_annotation(
            request=request,
            #
            flags=annotation_flags,
            tags=annotation_create_request.annotation.tags,
            meta=annotation_create_request.annotation.meta,
            #
            data=annotation_create_request.annotation.data,
            #
            references=annotation_create_request.annotation.references,
            links=annotation_create_request.annotation.links,
        )

        if annotation_link is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create annotation. Please try again or contact support.",
            )

        annotation: Optional[Annotation] = await self._fetch_annotation(
            request=request,
            annotation_link=annotation_link,
        )

        if annotation is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to fetch annotation. Please try again or contact support.",
            )

        annotation_response = AnnotationResponse(
            count=1,
            annotation=annotation,
        )

        return annotation_response

    @intercept_exceptions()
    @suppress_exceptions(default=AnnotationResponse())
    async def fetch_annotation(
        self,
        *,
        request: Request,
        trace_id: str,
        span_id: str,
    ) -> AnnotationResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_ANNOTATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        annotation_link = Link(
            trace_id=trace_id,
            span_id=span_id,
        )

        annotation: Optional[Annotation] = await self._fetch_annotation(
            request=request,
            annotation_link=annotation_link,
        )

        if annotation is None:
            return Response(status_code=status.HTTP_404_NOT_FOUND)

        annotation_response = AnnotationResponse(
            count=1,
            annotation=annotation,
        )

        return annotation_response

    @intercept_exceptions()
    async def edit_annotation(
        self,
        *,
        request: Request,
        trace_id: str,
        span_id: str,
        annotation_request: AnnotationEditRequest,
    ) -> AnnotationResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ANNOTATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        annotation_link = Link(
            trace_id=trace_id,
            span_id=span_id,
        )

        annotation: Optional[Annotation] = await self._fetch_annotation(
            request=request,
            annotation_link=annotation_link,
        )

        if annotation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Failed to fetch annotation. Please try again or contact support.",
            )

        annotation_flags = AnnotationFlags(
            is_evaluator=True,
            is_custom=annotation.origin == AnnotationOrigin.CUSTOM,
            is_human=annotation.origin == AnnotationOrigin.HUMAN,
            is_sdk=annotation.channel == AnnotationChannel.SDK,
            is_web=annotation.channel == AnnotationChannel.WEB,
            is_evaluation=annotation.kind == AnnotationKind.EVAL,
        )

        annotation_link: Optional[Link] = await self._edit_annotation(
            request=request,
            #
            annotation=annotation,
            #
            flags=annotation_flags,
            tags=annotation_request.annotation.tags,
            meta=annotation_request.annotation.meta,
            #
            data=annotation_request.annotation.data,
            #
            references=annotation.references,
            links=annotation.links,
        )

        if annotation_link is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create annotation. Please try again or contact support.",
            )

        annotation: Optional[Annotation] = await self._fetch_annotation(
            request=request,
            annotation_link=annotation_link,
        )

        if annotation is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to fetch annotation. Please try again or contact support.",
            )

        annotation_response = AnnotationResponse(
            count=1,
            annotation=annotation,
        )

        return annotation_response

    @intercept_exceptions()
    async def delete_annotation(
        self,
        *,
        request: Request,
        trace_id: str,
        span_id: str,
    ) -> AnnotationLinkResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ANNOTATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        annotation_link = Link(
            trace_id=trace_id,
            span_id=span_id,
        )

        annotation_link: Optional[Link] = await self._delete_annotation(
            request=request,
            annotation_link=annotation_link,
        )

        annotation_link_response = AnnotationLinkResponse(
            count=1 if annotation_link else 0,
            annotation_link=annotation_link,
        )

        return annotation_link_response

    @intercept_exceptions()
    @suppress_exceptions(default=AnnotationsResponse())
    async def query_annotations(
        self,
        *,
        request: Request,
        query_request: Optional[AnnotationQueryRequest] = None,
    ) -> AnnotationResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_ANNOTATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        annotation = query_request.annotation if query_request else None
        annotation_flags = AnnotationFlags(is_evaluator=True)

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

        annotations = await self._query_annotation(
            request=request,
            #
            flags=annotation_flags,
            tags=annotation.tags if annotation else None,
            meta=annotation.meta if annotation else None,
            #
            references=annotation.references if annotation else None,
            links=annotation.links if annotation else None,
            #
            annotation_links=query_request.annotation_links if query_request else None,
            #
            windowing=query_request.windowing if query_request else None,
        )

        annotations_response = AnnotationsResponse(
            count=len(annotations),
            annotations=annotations,
        )

        return annotations_response

    # - ANNOTATIONS ------------------------------------------------------------

    @intercept_exceptions()
    async def _create_annotation(
        self,
        *,
        request: Request,
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
        span_id = uuid4().hex[16:]

        _references = references.model_dump(mode="json", exclude_none=True)

        _links = [
            OTelLink(
                trace_id=link.trace_id,
                span_id=link.span_id,
                attributes={"key": key},
            ).model_dump(mode="json")
            for key, link in links.items()
        ]

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
                    span_id=span_id,
                    attributes=_attributes,
                    links=_links,
                )
            ]
        )

        _links_response = await self.tracing_router.create_trace(
            request=request,
            trace_request=trace_request,
        )

        return _links_response.links[0] if _links_response.links else None

    @intercept_exceptions()
    async def _fetch_annotation(
        self,
        *,
        request: Request,
        annotation_link: Link,
    ) -> Optional[Annotation]:
        trace_response: OTelTracingResponse = await self.tracing_router.fetch_trace(
            request=request,
            trace_id=annotation_link.trace_id,
        )

        if trace_response.count == 0:
            return None

        traces = list(trace_response.traces.values())
        trace = traces[0] if traces else None

        spans = list(trace.spans.values())
        root_span = spans[0] if spans else None

        (
            type,
            flags,
            tags,
            meta,
            data,
            references,
        ) = parse_from_attributes(root_span.attributes)

        _references = AnnotationReferences(**references)

        _links = (
            {
                link.attributes.get("key"): Link(
                    trace_id=link.trace_id,
                    span_id=link.span_id,
                )
                for link in root_span.links
                if link.attributes.get("key")
            }
            if root_span.links and isinstance(root_span.links, list)
            else None
        )

        _origin = (
            flags.get("is_custom")
            and AnnotationOrigin.CUSTOM
            or flags.get("is_human")
            and AnnotationOrigin.HUMAN
            or AnnotationOrigin.AUTO
        )

        _kind = (
            flags.get("is_evaluation") and AnnotationKind.EVAL or AnnotationKind.ADHOC
        )

        _channel = (
            flags.get("is_sdk")
            and AnnotationChannel.SDK
            or flags.get("is_web")
            and AnnotationChannel.WEB
            or AnnotationChannel.API
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
            flags=flags,
            tags=tags,
            meta=meta,
            #
            data=data,
            #
            references=_references,
            links=_links,
        )

        return annotation

    @intercept_exceptions()
    async def _edit_annotation(
        self,
        *,
        request: Request,
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
    ) -> Optional[Annotation]:
        _references = references.model_dump(mode="json", exclude_none=True)

        _links = [
            OTelLink(
                trace_id=link.trace_id,
                span_id=link.span_id,
                attributes={"key": key},
            ).model_dump(mode="json")
            for key, link in links.items()
        ]

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

        _links_response = await self.tracing_router.edit_trace(
            request=request,
            trace_id=annotation.trace_id,
            trace_request=trace_request,
        )

        return _links_response.links[0] if _links_response.links else None

    @intercept_exceptions()
    async def _delete_annotation(
        self,
        *,
        request: Request,
        annotation_link: Link,
    ) -> Optional[Link]:
        link_response = await self.tracing_router.delete_trace(
            request=request,
            trace_id=annotation_link.trace_id,
        )

        if link_response.count == 0:
            return None

        link = link_response.links[0] if link_response.links else None

        annotation_link = Link(
            trace_id=link.trace_id,
            span_id=link.span_id,
        )

        return annotation_link

    @intercept_exceptions()
    async def _query_annotation(
        self,
        *,
        request: Request,
        #
        flags: Optional[AnnotationFlags] = None,
        tags: Optional[Tags] = None,
        meta: Optional[Meta] = None,
        #
        references: Optional[AnnotationReferences] = None,
        links: Optional[AnnotationLinks | List[Link]] = None,
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

        conditions = [
            {
                "field": "attributes",
                "key": "ag.type.trace",
                "value": "annotation",
                "operator": "is",
            }
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
                {
                    "field": "trace_id",
                    "value": trace_ids,
                    "operator": "in",
                }
            )

        # if span_ids:
        #     conditions.append(
        #         {
        #             "field": "span_id",
        #             "value": span_ids,
        #             "operator": "in",
        #         }
        #     )

        if flags:
            for key, value in flags.model_dump(mode="json", exclude_none=True).items():
                conditions.append(
                    {
                        "field": "attributes",
                        "key": f"ag.flags.{key}",
                        "value": value,
                        "operator": "is",
                    }
                )

        if tags:
            for key, value in tags.items():
                conditions.append(
                    {
                        "field": "attributes",
                        "key": f"ag.tags.{key}",
                        "value": value,
                        "operator": "is",
                    }
                )

        if meta:
            for key, value in meta.items():
                conditions.append(
                    {
                        "field": "attributes",
                        "key": f"ag.meta.{key}",
                        "value": value,
                        "operator": "is",
                    }
                )

        if references:
            for _, reference in references.model_dump(mode="json").items():
                if reference:
                    ref_id = str(reference.get("id")) if reference.get("id") else None
                    ref_slug = (
                        str(reference.get("slug")) if reference.get("slug") else None
                    )
                    conditions.append(
                        {
                            "field": "references",
                            "value": [
                                {"id": ref_id, "slug": ref_slug},
                            ],
                            "operator": "in",
                        }
                    )

        if links:
            if isinstance(links, dict):
                for _, link in links.items():
                    if link:
                        conditions.append(
                            {
                                "field": "links",
                                "value": [
                                    {
                                        "trace_id": link.trace_id,
                                        "span_id": link.span_id,
                                    },
                                ],
                                "operator": "in",
                            }
                        )
            elif isinstance(links, list):
                _conditions = []
                for link in links:
                    link: Link
                    if link:
                        _conditions.append(
                            {
                                "field": "links",
                                "value": [
                                    {
                                        "trace_id": link.trace_id,
                                        "span_id": link.span_id,
                                    },
                                ],
                                "operator": "in",
                            }
                        )
                if _conditions:
                    conditions.append(
                        {
                            "operator": "or",
                            "conditions": _conditions,
                        }
                    )

        if conditions:
            filtering = Filtering(
                operator="and",
                conditions=conditions,
            )

        query = Query(
            formatting=formatting,
            filtering=filtering,
            windowing=windowing,
        )

        spans_response: OTelTracingResponse = await self.tracing_router.query_spans(
            request=request,
            query=query,
        )

        traces = list(spans_response.traces.values())

        annotations = []

        for trace in traces:
            spans = list(trace.spans.values())

            root_span = spans[0] if spans else None

            (
                type,
                flags,
                tags,
                meta,
                data,
                references,
            ) = parse_from_attributes(root_span.attributes)

            _references = AnnotationReferences(**references)

            _links = (
                {
                    link.attributes.get("key"): Link(
                        trace_id=link.trace_id,
                        span_id=link.span_id,
                    )
                    for link in root_span.links
                    if link.attributes.get("key")
                }
                if root_span.links and isinstance(root_span.links, list)
                else None
            )

            _origin = (
                flags.get("is_custom")
                and AnnotationOrigin.CUSTOM
                or flags.get("is_human")
                and AnnotationOrigin.HUMAN
                or AnnotationOrigin.AUTO
            )

            _kind = (
                flags.get("is_evaluation")
                and AnnotationKind.EVAL
                or AnnotationKind.ADHOC
            )

            _channel = (
                flags.get("is_sdk")
                and AnnotationChannel.SDK
                or flags.get("is_web")
                and AnnotationChannel.WEB
                or AnnotationChannel.API
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
                flags=flags,
                tags=tags,
                meta=meta,
                data=data,
                #
                references=_references,
                links=_links,
            )

            annotations.append(annotation)

        return annotations
