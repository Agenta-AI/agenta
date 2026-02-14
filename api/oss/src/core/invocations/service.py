from typing import Optional, List, Union
from uuid import UUID, uuid4

from fastapi import Request

from oss.src.utils.logging import get_module_logger

from oss.src.core.applications.services import (
    ApplicationsService,
    SimpleApplicationsService,
)

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
from oss.src.core.applications.dtos import (
    SimpleApplicationFlags,
    SimpleApplicationCreate,
)


from oss.src.core.tracing.utils import (
    parse_into_attributes,
    parse_from_attributes,
)
from oss.src.core.invocations.types import (
    InvocationOrigin,
    InvocationKind,
    InvocationChannel,
    InvocationReferences,
    InvocationLinks,
    InvocationFlags,
    #
    Invocation,
    InvocationCreate,
    InvocationEdit,
    InvocationQuery,
)

from oss.src.apis.fastapi.tracing.router import TracingRouter
from oss.src.apis.fastapi.tracing.models import (
    OTelFlatSpan,
    OTelTracingRequest,
    OTelTracingResponse,
)


log = get_module_logger(__name__)


class InvocationsService:
    def __init__(
        self,
        *,
        applications_service: ApplicationsService,
        simple_applications_service: SimpleApplicationsService,
        tracing_router: TracingRouter,
    ):
        self.applications_service = applications_service
        self.simple_applications_service = simple_applications_service
        self.tracing_router = tracing_router

    async def create(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        user_id: UUID,
        #
        invocation_create: InvocationCreate,
    ) -> Optional[Invocation]:
        application_slug = (
            invocation_create.references.application.slug
            if invocation_create.references.application
            else None
        ) or uuid4().hex[-12:]

        application_flags = SimpleApplicationFlags()

        simple_application = None

        application_revision = await self.applications_service.fetch_application_revision(
            project_id=project_id,
            #
            application_ref=invocation_create.references.application,
            application_variant_ref=invocation_create.references.application_variant,
            application_revision_ref=invocation_create.references.application_revision,
        )

        if not application_revision:
            simple_application_create = SimpleApplicationCreate(
                slug=application_slug,
                #
                name=application_slug,
                #
                flags=application_flags,
            )

            simple_application = await self.simple_applications_service.create(
                project_id=project_id,
                user_id=user_id,
                #
                simple_application_create=simple_application_create,
            )

            if simple_application:
                application_revision = (
                    await self.applications_service.fetch_application_revision(
                        project_id=project_id,
                        #
                        application_ref=Reference(id=simple_application.id),
                    )
                )

        if not application_revision or not application_revision.data:
            return None

        if application_revision:
            invocation_create.references.application = Reference(
                id=application_revision.application_id,
                slug=(
                    invocation_create.references.application.slug
                    if invocation_create.references.application
                    else None
                ),
            )

            invocation_create.references.application_variant = Reference(
                id=application_revision.application_variant_id,
                slug=(
                    invocation_create.references.application_variant.slug
                    if invocation_create.references.application_variant
                    else None
                ),
            )

            invocation_create.references.application_revision = Reference(
                id=application_revision.id,
                slug=application_revision.slug,
                version=application_revision.version,
            )

        invocation_flags = InvocationFlags(
            is_sdk=invocation_create.channel == InvocationChannel.SDK,
            is_web=invocation_create.channel == InvocationChannel.WEB,
            is_evaluation=invocation_create.kind == InvocationKind.EVAL,
        )

        invocation_references = InvocationReferences(
            **invocation_create.references.model_dump(),
        )

        invocation_link = await self._create_invocation(
            organization_id=organization_id,
            project_id=project_id,
            user_id=user_id,
            #
            name=simple_application.name if simple_application else application_slug,
            #
            flags=invocation_flags,
            tags=invocation_create.tags,
            meta=invocation_create.meta,
            #
            data=invocation_create.data,
            #
            references=invocation_references,
            links=invocation_create.links,
        )

        if invocation_link is None:
            return None

        invocation = await self._fetch_invocation(
            project_id=project_id,
            user_id=user_id,
            #
            invocation_link=invocation_link,
        )

        return invocation

    async def fetch(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID] = None,
        #
        trace_id: str,
        span_id: Optional[str] = None,
    ):
        invocation_link = Link(
            trace_id=trace_id,
            span_id=span_id,
        )

        invocation: Optional[Invocation] = await self._fetch_invocation(
            project_id=project_id,
            user_id=user_id,
            #
            invocation_link=invocation_link,
        )
        return invocation

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
        invocation_edit: InvocationEdit,
    ):
        invocation_link = Link(
            trace_id=trace_id,
            span_id=span_id,
        )

        invocation: Optional[Invocation] = await self._fetch_invocation(
            project_id=project_id,
            user_id=user_id,
            #
            invocation_link=invocation_link,
        )

        if invocation is None:
            return None

        application_slug = (
            invocation.references.application.slug
            if invocation.references.application
            else None
        ) or uuid4().hex

        application_flags = SimpleApplicationFlags()

        application_revision = (
            await self.applications_service.fetch_application_revision(
                project_id=project_id,
                #
                application_ref=invocation.references.application,
                application_variant_ref=invocation.references.application_variant,
                application_revision_ref=invocation.references.application_revision,
            )
        )

        if not application_revision:
            simple_application_create = SimpleApplicationCreate(
                slug=application_slug,
                #
                name=application_slug,
                #
                flags=application_flags,
            )

            simple_application = await self.simple_applications_service.create(
                project_id=project_id,
                user_id=user_id,
                #
                simple_application_create=simple_application_create,
            )

            if simple_application:
                application_revision = (
                    await self.applications_service.fetch_application_revision(
                        project_id=project_id,
                        #
                        application_ref=Reference(id=simple_application.id),
                    )
                )

        if not application_revision or not application_revision.data:
            return None

        if application_revision:
            invocation.references.application = Reference(
                id=application_revision.application_id,
                slug=(
                    invocation.references.application.slug
                    if invocation.references.application
                    else None
                ),
            )

            invocation.references.application_variant = Reference(
                id=application_revision.application_variant_id,
                slug=(
                    invocation.references.application_variant.slug
                    if invocation.references.application_variant
                    else None
                ),
            )

            invocation.references.application_revision = Reference(
                id=application_revision.id,
                slug=application_revision.slug,
                version=application_revision.version,
            )

        invocation_flags = InvocationFlags(
            is_sdk=invocation.channel == InvocationChannel.SDK,
            is_web=invocation.channel == InvocationChannel.WEB,
            is_evaluation=invocation.kind == InvocationKind.EVAL,
        )

        invocation_references = InvocationReferences(
            **invocation.references.model_dump(),
        )

        invocation_link = await self._edit_invocation(
            organization_id=organization_id,
            project_id=project_id,
            user_id=user_id,
            #
            invocation=invocation,
            #
            flags=invocation_flags,
            tags=invocation_edit.tags,
            meta=invocation_edit.meta,
            #
            data=invocation_edit.data,
            #
            references=invocation_references,
            links=invocation.links,
        )

        if invocation_link is None:
            return None

        invocation = await self._fetch_invocation(
            project_id=project_id,
            user_id=user_id,
            #
            invocation_link=invocation_link,
        )

        return invocation

    async def delete(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        trace_id: str,
        span_id: Optional[str] = None,
    ):
        invocation_link = Link(
            trace_id=trace_id,
            span_id=span_id,
        )

        invocation_link = await self._delete_invocation(
            project_id=project_id,
            user_id=user_id,
            #
            invocation_link=invocation_link,
        )

        return invocation_link

    async def query(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID] = None,
        #
        invocation_query: Optional[InvocationQuery] = None,
        #
        invocation_links: Optional[List[Link]] = None,
        #
        windowing: Optional[Windowing] = None,
    ):
        invocation = invocation_query if invocation_query else None
        invocation_flags = InvocationFlags(is_evaluator=True)

        if invocation:
            if invocation.channel:
                invocation_flags.is_sdk = invocation.channel == InvocationChannel.SDK
                invocation_flags.is_web = invocation.channel == InvocationChannel.WEB

            if invocation.kind:
                invocation_flags.is_evaluation = invocation.kind == InvocationKind.EVAL

        invocation_tags = invocation.tags if invocation else None
        invocation_meta = invocation.meta if invocation else None

        invocation_references = (
            InvocationReferences(
                **invocation.references.model_dump(),
            )
            if invocation and invocation.references
            else None
        )

        _invocation_links = invocation.links if invocation else None

        invocations = await self._query_invocation(
            project_id=project_id,
            user_id=user_id,
            #
            flags=invocation_flags,
            tags=invocation_tags,
            meta=invocation_meta,
            #
            references=invocation_references,
            links=_invocation_links,
            #
            invocation_links=invocation_links,
            #
            windowing=windowing,
        )
        return invocations

    # -------- Internal Functions -------------------------------------------------------------------

    async def _create_invocation(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        user_id: UUID,
        #
        name: Optional[str],
        #
        flags: InvocationFlags,
        tags: Optional[Tags] = None,
        meta: Optional[Meta] = None,
        #
        data: Data,
        #
        references: InvocationReferences,
        links: Optional[InvocationLinks],
    ) -> Optional[Link]:
        trace_id = uuid4().hex
        trace_type = TraceType.INVOCATION

        span_id = uuid4().hex[16:]
        span_type = SpanType.TASK
        span_name = name or references.application.slug or "invocation"

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
            "trace": "invocation",
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
            sync=True,  # Synchronous for user-facing invocations
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

    async def _fetch_invocation(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID] = None,
        #
        invocation_link: Link,
    ) -> Optional[Invocation]:
        request = Request(
            scope={"type": "http", "http_version": "1.1", "scheme": "http"}
        )

        request.state.project_id = str(project_id)
        request.state.user_id = str(user_id) if user_id else None

        if not invocation_link.trace_id:
            return None

        trace_response: OTelTracingResponse = await self.tracing_router.fetch_trace(
            request=request,
            #
            trace_id=invocation_link.trace_id,
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

        _references = InvocationReferences(
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

        _origin = InvocationOrigin.CUSTOM

        _kind = (
            (flags.get("is_evaluation") and InvocationKind.EVAL or InvocationKind.ADHOC)
            if flags
            else InvocationKind.ADHOC
        )

        _channel = (
            (
                flags.get("is_sdk")
                and InvocationChannel.SDK
                or flags.get("is_web")
                and InvocationChannel.WEB
                or InvocationChannel.API
            )
            if flags
            else InvocationChannel.API
        )

        invocation = Invocation(
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

        return invocation

    async def _edit_invocation(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        user_id: UUID,
        #
        invocation: Invocation,
        #
        flags: InvocationFlags,
        tags: Optional[Tags] = None,
        meta: Optional[Meta] = None,
        #
        data: Data,
        #
        references: InvocationReferences,
        links: InvocationLinks,
    ) -> Optional[Link]:
        if not invocation.trace_id or not invocation.span_id:
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
            "trace": "invocation",
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
                    trace_id=invocation.trace_id,
                    span_id=invocation.span_id,
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
            trace_id=invocation.trace_id,
            #
            trace_request=trace_request,
            sync=True,  # Synchronous for user-facing invocations
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

    async def _delete_invocation(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        invocation_link: Link,
    ) -> Optional[Link]:
        if not invocation_link.trace_id:
            return None

        request = Request(
            scope={"type": "http", "http_version": "1.1", "scheme": "http"}
        )

        request.state.project_id = str(project_id)
        request.state.user_id = str(user_id)

        link_response = await self.tracing_router.delete_trace(
            request=request,
            #
            trace_id=invocation_link.trace_id,
        )

        link = link_response.links[0] if link_response.links else None

        if not link or not link.trace_id or not link.span_id:
            return None

        invocation_link = Link(
            trace_id=link.trace_id,
            span_id=link.span_id,
        )

        return invocation_link

    async def _query_invocation(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID] = None,
        #
        flags: Optional[InvocationFlags] = None,
        tags: Optional[Tags] = None,
        meta: Optional[Meta] = None,
        #
        references: Optional[InvocationReferences] = None,
        links: Optional[InvocationLinks] = None,
        #
        invocation_links: Optional[List[Link]] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Invocation]:
        formatting = Formatting(
            focus=Focus.TRACE,
            format=Format.AGENTA,
        )

        filtering = Filtering()

        conditions: List[Union[Condition, Filtering]] = [
            Condition(
                field="attributes",
                key="ag.type.trace",
                value="invocation",
                operator=ComparisonOperator.IS,
            )
        ]

        trace_ids = (
            [invocation_link.trace_id for invocation_link in invocation_links]
            if invocation_links
            else None
        )

        # span_ids = (
        #     [invocation_link.span_id for invocation_link in invocation_links]
        #     if invocation_links
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

        invocations = []

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

            _references = InvocationReferences(
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

            _origin = InvocationOrigin.CUSTOM

            _kind = (
                (
                    __flags.get("is_evaluation")
                    and InvocationKind.EVAL
                    or InvocationKind.ADHOC
                )
                if __flags
                else InvocationKind.ADHOC
            )

            _channel = (
                (
                    __flags.get("is_sdk")
                    and InvocationChannel.SDK
                    or __flags.get("is_web")
                    and InvocationChannel.WEB
                    or InvocationChannel.API
                )
                if __flags
                else InvocationChannel.API
            )

            invocation = Invocation(
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

            invocations.append(invocation)

        return invocations
