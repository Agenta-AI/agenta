from typing import Optional, List
from uuid import uuid4, UUID

from genson import SchemaBuilder

from fastapi import APIRouter, Request, status, HTTPException, Response

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache

from oss.src.core.shared.dtos import Reference, Meta
from oss.src.core.tracing.dtos import Link, Focus, Format, Query, Formatting, Filtering
from oss.src.core.workflows.dtos import WorkflowFlags, WorkflowData
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.tracing.service import TracingService
from oss.src.apis.fastapi.tracing.router import TracingRouter

from oss.src.apis.fastapi.tracing.models import (
    OTelFlatSpan,
    OTelTracingRequest,
    OTelTracingResponse,
)

from oss.src.core.workflows.dtos import (
    WorkflowArtifact,
    WorkflowVariant,
    WorkflowRevision,
)

from oss.src.apis.fastapi.evaluators.models import Evaluator
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
    AnnotationKind,
    AnnotationSource,
    AnnotationData,
    AnnotationMeta,
    AnnotationReference,
    AnnotationReferences,
    AnnotationLink,
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
    VERSION = "1.0.0"

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
            operation_id="query_annotations",
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
        annotation_request: AnnotationCreateRequest,
    ) -> AnnotationResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ANNOTATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        project_id = UUID(request.state.project_id)
        user_id = UUID(request.state.user_id)

        evaluator_flags = WorkflowFlags(
            is_evaluator=True,
            is_custom=annotation_request.annotation.kind == AnnotationKind.CUSTOM,
            is_human=annotation_request.annotation.kind == AnnotationKind.HUMAN,
        )

        evaluator: Optional[Evaluator] = await self._fetch_evaluator(
            project_id=project_id,
            #
            evaluator_slug=annotation_request.annotation.references.evaluator.slug,
        )

        if evaluator is None:
            builder = SchemaBuilder()
            builder.add_object(annotation_request.annotation.data)
            evaluator_format = builder.to_schema()  # pylint: disable=redefined-builtin

            evaluator: Optional[Evaluator] = await self._create_evaluator(
                project_id=project_id,
                user_id=user_id,
                #
                evaluator_slug=annotation_request.annotation.references.evaluator.slug,
                #
                evaluator_flags=evaluator_flags,
                evaluator_meta=annotation_request.annotation.meta,
                evaluator_format=evaluator_format,
            )

        if evaluator is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create evaluator. Please try again or contact support.",
            )

        validate_data_against_schema(
            annotation_request.annotation.data,
            evaluator.data.service.get("format", {}),
        )

        annotation_request.annotation.references.evaluator = Reference(
            id=evaluator.id,
            slug=evaluator.slug,
        )

        annotation_flags = AnnotationFlags(
            is_evaluator=True,
            is_custom=evaluator_flags.is_custom,
            is_human=evaluator_flags.is_human,
            is_sdk=annotation_request.annotation.source == AnnotationSource.SDK,
            is_web=annotation_request.annotation.source == AnnotationSource.WEB,
        )

        annotation_link: Optional[Link] = await self._create_annotation(
            request=request,
            annotation_data=annotation_request.annotation.data,
            annotation_meta=annotation_request.annotation.meta,
            annotation_references=annotation_request.annotation.references,
            annotation_links=annotation_request.annotation.links,
            annotation_flags=annotation_flags,
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

        annotation_link = AnnotationLink(
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

        annotation_link = AnnotationLink(
            trace_id=trace_id,
            span_id=span_id,
        )

        annotation: Optional[Annotation] = await self._fetch_annotation(
            request=request,
            annotation_link=annotation_link,
        )

        if annotation is None:
            return Response(status_code=status.HTTP_404_NOT_FOUND)

        annotation_link = AnnotationLink(
            trace_id=annotation.trace_id,
            span_id=annotation.span_id,
        )

        annotation_flags = AnnotationFlags(
            is_evaluator=True,
            is_custom=annotation.kind == AnnotationKind.CUSTOM,
            is_human=annotation.kind == AnnotationKind.HUMAN,
            is_sdk=annotation.source == AnnotationSource.SDK,
            is_web=annotation.source == AnnotationSource.WEB,
        )

        annotation_link: Optional[Link] = await self._edit_annotation(
            request=request,
            annotation_link=annotation_link,
            annotation_data=annotation_request.annotation.data,
            annotation_meta=annotation_request.annotation.meta,
            annotation_references=annotation.references,
            annotation_links=annotation.links,
            annotation_flags=annotation_flags,
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
                permission=Permission.DELETE_ANNOTATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        annotation_link = AnnotationLink(
            trace_id=trace_id,
            span_id=span_id,
        )

        annotation: Optional[Annotation] = await self._delete_annotation(
            request=request,
            annotation_link=annotation_link,
        )

        if annotation is None:
            return Response(status_code=status.HTTP_204_NO_CONTENT)

        annotation_link_response = AnnotationLinkResponse(
            annotation=annotation_link,
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

        annotations = []

        if query_request is None or query_request.annotation is None:
            annotations = await self._query_annotation(
                request=request,
            )

        else:
            annotation_flags = AnnotationFlags(
                is_evaluator=True,
                is_custom=query_request.annotation.kind == AnnotationKind.CUSTOM,
                is_human=query_request.annotation.kind == AnnotationKind.HUMAN,
                is_sdk=query_request.annotation.source == AnnotationSource.SDK,
                is_web=query_request.annotation.source == AnnotationSource.WEB,
            )

            annotations = await self._query_annotation(
                request=request,
                trace_id=query_request.annotation.trace_id,
                span_id=query_request.annotation.span_id,
                flags=annotation_flags,
                meta=query_request.annotation.meta,
                references=query_request.annotation.references,
                links=query_request.annotation.links,
            )

        annotations_response = AnnotationsResponse(
            count=len(annotations),
            annotations=annotations,
        )

        return annotations_response

    # - EVALUATORS -------------------------------------------------------------

    @intercept_exceptions()
    async def _create_evaluator(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        evaluator_slug: str,
        evaluator_format: dict,
        evaluator_flags: Optional[WorkflowFlags] = None,
        evaluator_meta: Optional[Meta] = None,
    ) -> Optional[Evaluator]:
        workflow_revision_data = WorkflowData(
            service=dict(
                agenta="v0.1.0",
                format=evaluator_format,
            )
        )

        workflow_artifact: Optional[WorkflowArtifact] = (
            await self.workflows_service.create_artifact(
                project_id=project_id,
                user_id=user_id,
                #
                artifact_slug=evaluator_slug,
                #
                artifact_flags=evaluator_flags,
                artifact_meta=evaluator_meta,
            )
        )

        if workflow_artifact is None:
            return None

        workflow_variant_slug = uuid4().hex

        workflow_variant: Optional[WorkflowVariant] = (
            await self.workflows_service.create_variant(
                project_id=project_id,
                user_id=user_id,
                #
                artifact_id=workflow_artifact.id,
                #
                variant_slug=workflow_variant_slug,
                #
                variant_flags=evaluator_flags,
                variant_meta=evaluator_meta,
            )
        )

        if workflow_variant is None:
            return None

        workflow_revision_slug = uuid4().hex

        workflow_revision: Optional[WorkflowRevision] = (
            await self.workflows_service.create_revision(
                project_id=project_id,
                user_id=user_id,
                #
                artifact_id=workflow_artifact.id,
                variant_id=workflow_variant.id,
                #
                revision_slug=workflow_revision_slug,
                #
                revision_flags=evaluator_flags,
                revision_meta=evaluator_meta,
            )
        )

        if workflow_revision is None:
            return None

        workflow_revision_slug = uuid4().hex

        workflow_revision: Optional[WorkflowRevision] = (
            await self.workflows_service.commit_revision(
                project_id=project_id,
                user_id=user_id,
                #
                variant_id=workflow_variant.id,
                #
                revision_slug=workflow_revision_slug,
                #
                revision_flags=evaluator_flags,
                revision_meta=evaluator_meta,
                revision_data=workflow_revision_data,
            )
        )

        if workflow_revision is None:
            # do something
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create evaluator. Please try again or contact support.",
            )

        evaluator = Evaluator(
            id=workflow_artifact.id,
            slug=workflow_artifact.slug,
            #
            created_at=workflow_artifact.created_at,
            updated_at=workflow_artifact.updated_at,
            deleted_at=workflow_artifact.deleted_at,
            created_by_id=workflow_artifact.created_by_id,
            updated_by_id=workflow_artifact.updated_by_id,
            deleted_by_id=workflow_artifact.deleted_by_id,
            #
            meta=workflow_artifact.meta,
            name=workflow_artifact.name,
            description=workflow_artifact.description,
            data=workflow_revision.data,
        )

        return evaluator

    @intercept_exceptions()
    async def _fetch_evaluator(
        self,
        *,
        project_id: UUID,
        evaluator_slug: str,  # Added evaluator_slug parameter
    ) -> Optional[Evaluator]:
        workflow_artifact_ref = Reference(
            slug=evaluator_slug,
        )

        workflow_artifact: Optional[WorkflowArtifact] = (
            await self.workflows_service.fetch_artifact(
                project_id=project_id,
                #
                artifact_ref=workflow_artifact_ref,
            )
        )

        if workflow_artifact is None:
            return None

        workflow_artifact_ref = Reference(
            id=workflow_artifact.id,
        )

        workflow_variant: Optional[WorkflowVariant] = (
            await self.workflows_service.fetch_variant(
                project_id=project_id,
                #
                artifact_ref=workflow_artifact_ref,
            )
        )

        if workflow_variant is None:
            return None

        workflow_variant_ref = Reference(
            id=workflow_variant.id,
        )

        workflow_revision: Optional[WorkflowRevision] = (
            await self.workflows_service.fetch_revision(
                project_id=project_id,
                #
                variant_ref=workflow_variant_ref,
            )
        )

        if workflow_revision is None:
            return None

        evaluator = Evaluator(
            id=workflow_artifact.id,
            slug=workflow_artifact.slug,
            #
            created_at=workflow_artifact.created_at,
            updated_at=workflow_artifact.updated_at,
            deleted_at=workflow_artifact.deleted_at,
            created_by_id=workflow_artifact.created_by_id,
            updated_by_id=workflow_artifact.updated_by_id,
            deleted_by_id=workflow_artifact.deleted_by_id,
            #
            meta=workflow_artifact.meta,
            name=workflow_artifact.name,
            description=workflow_artifact.description,
            data=workflow_revision.data,
        )

        return evaluator

    # - ANNOTATIONS ------------------------------------------------------------

    @intercept_exceptions()
    async def _create_annotation(
        self,
        *,
        request: Request,
        annotation_data: AnnotationData,
        annotation_meta: Optional[AnnotationMeta] = None,
        annotation_references: AnnotationReferences,
        annotation_links: AnnotationLinks,
        annotation_flags: AnnotationFlags,
    ) -> Optional[Link]:
        trace_id = uuid4().hex
        span_id = uuid4().hex[16:]

        _references = [
            Reference(
                id=reference.get("id"),
                slug=reference.get("slug"),
                version=reference.get("version"),
                attributes={key: True, "key": key},
            ).model_dump()
            for key, reference in annotation_references.model_dump().items()
            if reference
        ]

        _links = [
            Link(
                trace_id=link.trace_id,
                span_id=link.span_id,
                attributes={key: True, "key": key},
            ).model_dump()
            for key, link in annotation_links.items()
        ]

        _flags = annotation_flags.model_dump(exclude_none=True)

        _attributes = parse_into_attributes(
            data=annotation_data,
            meta=annotation_meta,
            references=_references,
            flags=_flags,
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

        _links_response = await self.tracing_router.add_trace(
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
            data,
            meta,
            references,
            flags,
        ) = parse_from_attributes(root_span.attributes)

        _references = (
            {
                reference.get("attributes").get("key"): AnnotationReference(
                    id=reference.get("id"),
                    slug=reference.get("slug"),
                    version=reference.get("version"),
                )
                for reference in references
                if reference.get("attributes")
                and reference.get("attributes").get("key")
            }
            if references and isinstance(references, list)
            else None
        )

        _links = (
            {
                link.attributes.get("key"): AnnotationLink(
                    trace_id=link.trace_id,
                    span_id=link.span_id,
                )
                for link in root_span.links
                if link.attributes.get("key")
            }
            if root_span.links and isinstance(root_span.links, list)
            else None
        )

        _kind = (
            flags.get("is_custom")
            and AnnotationKind.CUSTOM
            or flags.get("is_human")
            and AnnotationKind.HUMAN
            or AnnotationKind.AUTO
        )

        _source = (
            flags.get("is_sdk")
            and AnnotationSource.SDK
            or flags.get("is_web")
            and AnnotationSource.WEB
            or AnnotationSource.API
        )

        annotation = Annotation(
            trace_id=root_span.trace_id,
            span_id=root_span.span_id,
            created_at=root_span.created_at,
            updated_at=root_span.updated_at,
            deleted_at=root_span.deleted_at,
            created_by_id=root_span.created_by_id,
            updated_by_id=root_span.updated_by_id,
            deleted_by_id=root_span.deleted_by_id,
            kind=_kind,
            source=_source,
            data=data,
            meta=meta,
            references=_references,
            links=_links,
        )

        return annotation

    @intercept_exceptions()
    async def _edit_annotation(
        self,
        *,
        request: Request,
        annotation_link: Link,
        annotation_data: AnnotationData,
        annotation_meta: Optional[AnnotationMeta] = None,
        annotation_references: AnnotationReferences,
        annotation_links: AnnotationLinks,
        annotation_flags: AnnotationFlags,
    ) -> Optional[Annotation]:
        annotation: Optional[Annotation] = await self._fetch_annotation(
            request=request,
            annotation_link=annotation_link,
        )

        if annotation is None:
            return None

        _references = [
            Reference(
                id=reference.get("id"),
                slug=reference.get("slug"),
                version=reference.get("version"),
                attributes={key: True, "key": key},
            ).model_dump()
            for key, reference in annotation_references.model_dump().items()
            if reference
        ]

        _links = [
            Link(
                trace_id=link.trace_id,
                span_id=link.span_id,
                attributes={key: True, "key": key},
            ).model_dump()
            for key, link in annotation_links.items()
        ]

        _flags = annotation_flags.model_dump(exclude_none=True)

        _attributes = parse_into_attributes(
            data=annotation_data,
            meta=annotation_meta,
            references=_references,
            flags=_flags,
        )

        trace_request = OTelTracingRequest(
            spans=[
                OTelFlatSpan(
                    trace_id=annotation_link.trace_id,
                    span_id=annotation_link.span_id,
                    attributes=_attributes,
                    links=_links,
                )
            ]
        )

        _links_response = await self.tracing_router.edit_trace(
            request=request,
            trace_request=trace_request,
        )

        return _links_response.links[0] if _links_response.links else None

    @intercept_exceptions()
    async def _delete_annotation(
        self,
        *,
        request: Request,
        annotation_link: Link,
    ) -> Optional[Annotation]:
        annotation: Optional[Annotation] = await self._fetch_annotation(
            request=request,
            annotation_link=annotation_link,
        )

        if annotation is None:
            return None

        link_response = await self.tracing_router.remove_trace(
            request=request,
            trace_id=annotation_link.trace_id,
        )

        annotation_link = link_response.links[0] if link_response.links else None

        if annotation_link is None:
            return None

        return annotation

    @intercept_exceptions()
    async def _query_annotation(
        self,
        *,
        request: Request,
        trace_id: Optional[str] = None,
        span_id: Optional[str] = None,
        flags: Optional[AnnotationFlags] = None,
        meta: Optional[AnnotationMeta] = None,
        references: Optional[AnnotationReferences] = None,
        links: Optional[AnnotationLinks] = None,
        # flags: Optional[WorkflowFlags] = None,
    ) -> List[Annotation]:
        formatting = Formatting(
            focus=Focus.TRACE,
            format=Format.AGENTA,
        )

        filtering = Filtering()

        conditions = [
            # {
            #     "field": "attributes",
            #     "key": "ag.type.trace",
            #     "value": "ANNOTATION",
            #     "operator": "is",
            # }
        ]

        if trace_id:
            conditions.append(
                {
                    "field": "trace_id",
                    "value": trace_id,
                    "operator": "is",
                }
            )

        if span_id:
            conditions.append(
                {
                    "field": "span_id",
                    "value": span_id,
                    "operator": "is",
                }
            )

        if flags:
            for key, value in flags.model_dump(exclude_none=True).items():
                conditions.append(
                    {
                        "field": "attributes",
                        "key": f"agenta.flags.{key}",
                        "value": value,
                        "operator": "is",
                    }
                )

        if meta:
            for key, value in meta.items():
                conditions.append(
                    {
                        "field": "attributes",
                        "key": f"agenta.meta.{key}",
                        "value": value,
                        "operator": "is",
                    }
                )

        if references:
            for _, reference in references.model_dump().items():
                if reference:
                    ref_id = str(reference.get("id")) if reference.get("id") else None
                    ref_slug = (
                        str(reference.get("slug")) if reference.get("slug") else None
                    )
                    ref_version = (
                        str(reference.get("version"))
                        if reference.get("version")
                        else None
                    )

                    conditions.append(
                        {
                            "field": "references",
                            "value": [
                                {
                                    "id": ref_id,
                                    "slug": ref_slug,
                                    "version": ref_version,
                                }
                            ],
                            "operator": "in",
                        }
                    )

        if links:
            for _, link in links.items():
                if link:
                    conditions.append(
                        {
                            "field": "links",
                            "value": [
                                {
                                    "trace_id": link.trace_id,
                                    "span_id": link.span_id,
                                }
                            ],
                            "operator": "in",
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
                data,
                meta,
                references,
                flags,
            ) = parse_from_attributes(root_span.attributes)

            _references = (
                {
                    reference.get("attributes").get("key"): AnnotationReference(
                        id=reference.get("id"),
                        slug=reference.get("slug"),
                        version=reference.get("version"),
                    )
                    for reference in references
                    if reference.get("attributes")
                    and reference.get("attributes").get("key")
                }
                if references and isinstance(references, list)
                else None
            )

            _links = (
                {
                    link.attributes.get("key"): AnnotationLink(
                        trace_id=link.trace_id,
                        span_id=link.span_id,
                    )
                    for link in root_span.links
                    if link.attributes.get("key")
                }
                if root_span.links and isinstance(root_span.links, list)
                else None
            )

            _kind = (
                flags.get("is_custom")
                and AnnotationKind.CUSTOM
                or flags.get("is_human")
                and AnnotationKind.HUMAN
                or AnnotationKind.AUTO
            )

            _source = (
                flags.get("is_sdk")
                and AnnotationSource.SDK
                or flags.get("is_web")
                and AnnotationSource.WEB
                or AnnotationSource.API
            )

            annotation = Annotation(
                trace_id=root_span.trace_id,
                span_id=root_span.span_id,
                created_at=root_span.created_at,
                updated_at=root_span.updated_at,
                deleted_at=root_span.deleted_at,
                created_by_id=root_span.created_by_id,
                updated_by_id=root_span.updated_by_id,
                deleted_by_id=root_span.deleted_by_id,
                kind=_kind,
                source=_source,
                data=data,
                meta=meta,
                references=_references,
                links=_links,
            )

            annotations.append(annotation)

        return annotations
