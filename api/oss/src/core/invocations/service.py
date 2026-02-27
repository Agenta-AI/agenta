from typing import Optional, List
from uuid import UUID, uuid4

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
    OTelFlatSpan,
    TraceType,
    SpanType,
)
from oss.src.core.tracing.service import TracingService
from oss.src.core.applications.dtos import (
    SimpleApplicationFlags,
    SimpleApplicationCreate,
)


from oss.src.core.tracing.utils.simple_traces import (
    build_otel_links,
    build_simple_trace_attributes,
    build_simple_trace_query,
    first_link,
    parse_simple_trace,
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

log = get_module_logger(__name__)


class InvocationsService:
    def __init__(
        self,
        *,
        applications_service: ApplicationsService,
        simple_applications_service: SimpleApplicationsService,
        tracing_service: TracingService,
    ):
        self.applications_service = applications_service
        self.simple_applications_service = simple_applications_service
        self.tracing_service = tracing_service

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

        _links = build_otel_links(links)

        _flags = flags.model_dump(mode="json", exclude_none=True)

        _attributes = build_simple_trace_attributes(
            trace_kind="invocation",
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
            sync=True,  # Synchronous for user-facing invocations
        )

        _link = first_link(links)

        return _link

    async def _fetch_invocation(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID] = None,
        #
        invocation_link: Link,
    ) -> Optional[Invocation]:
        if not invocation_link.trace_id:
            return None

        trace = await self.tracing_service.fetch_trace(
            project_id=project_id,
            trace_id=invocation_link.trace_id,
        )

        parsed_trace = parse_simple_trace(trace)
        if parsed_trace is None:
            return None

        _references = InvocationReferences(
            **parsed_trace.references,
        )

        _links = parsed_trace.links

        _origin = InvocationOrigin.CUSTOM

        _kind = (
            (
                parsed_trace.flags.get("is_evaluation")
                and InvocationKind.EVAL
                or InvocationKind.ADHOC
            )
            if parsed_trace.flags
            else InvocationKind.ADHOC
        )

        _channel = (
            (
                parsed_trace.flags.get("is_sdk")
                and InvocationChannel.SDK
                or parsed_trace.flags.get("is_web")
                and InvocationChannel.WEB
                or InvocationChannel.API
            )
            if parsed_trace.flags
            else InvocationChannel.API
        )

        invocation = Invocation(
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

        _links = build_otel_links(links)

        _flags = flags.model_dump(mode="json", exclude_none=True)

        _attributes = build_simple_trace_attributes(
            trace_kind="invocation",
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
                    trace_id=invocation.trace_id,
                    span_id=invocation.span_id,
                    attributes=_attributes,
                    links=_links,
                )
            ],
            sync=True,  # Synchronous for user-facing invocations
        )

        _link = first_link(links)

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

        links = await self.tracing_service.delete_trace(
            project_id=project_id,
            trace_id=invocation_link.trace_id,
        )

        return first_link(links)

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
        query = build_simple_trace_query(
            trace_kind="invocation",
            flags=flags.model_dump(mode="json", exclude_none=True) if flags else None,
            tags=tags,
            meta=meta,
            references=references.model_dump(mode="json") if references else None,
            links=links,
            trace_links=invocation_links,
            windowing=windowing,
        )

        traces = await self.tracing_service.query_traces(
            project_id=project_id,
            query=query,
        )

        if not traces:
            return []

        invocations = []

        for trace in traces:
            parsed_trace = parse_simple_trace(trace)
            if parsed_trace is None:
                continue

            _references = InvocationReferences(
                **parsed_trace.references,
            )

            _links = parsed_trace.links

            _origin = InvocationOrigin.CUSTOM

            _kind = (
                (
                    parsed_trace.flags.get("is_evaluation")
                    and InvocationKind.EVAL
                    or InvocationKind.ADHOC
                )
                if parsed_trace.flags
                else InvocationKind.ADHOC
            )

            _channel = (
                (
                    parsed_trace.flags.get("is_sdk")
                    and InvocationChannel.SDK
                    or parsed_trace.flags.get("is_web")
                    and InvocationChannel.WEB
                    or InvocationChannel.API
                )
                if parsed_trace.flags
                else InvocationChannel.API
            )

            invocation = Invocation(
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

            invocations.append(invocation)

        return invocations
