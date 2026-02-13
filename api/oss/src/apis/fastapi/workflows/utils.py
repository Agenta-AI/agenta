from typing import Optional, Literal, List
from uuid import UUID
from datetime import datetime

from fastapi import Query

from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import (
    Windowing,
    Reference,
)
from oss.src.core.workflows.dtos import (
    WorkflowQueryFlags,
    #
    WorkflowQuery,
    WorkflowVariantQuery,
    WorkflowRevisionQuery,
)

from oss.src.apis.fastapi.shared.utils import (
    parse_metadata,
)
from oss.src.apis.fastapi.workflows.models import (
    WorkflowQueryRequest,
    WorkflowVariantQueryRequest,
    WorkflowRevisionQueryRequest,
    WorkflowRevisionRetrieveRequest,
)


log = get_module_logger(__name__)


def parse_workflow_query_request_from_params(
    workflow_id: Optional[UUID] = Query(None),
    workflow_ids: Optional[List[UUID]] = Query(None),
    workflow_slug: Optional[str] = Query(None),
    workflow_slugs: Optional[List[str]] = Query(None),
    #
    name: Optional[str] = Query(None),
    description: Optional[str] = Query(None),
    #
    flags: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    #
    include_archived: Optional[bool] = Query(None),
    #
    next: Optional[UUID] = Query(None),  # pylint disable=redefined-builtin
    newest: Optional[datetime] = Query(None),
    oldest: Optional[datetime] = Query(None),
    limit: Optional[int] = Query(None),
    order: Optional[Literal["ascending", "descending"]] = Query(None),
) -> WorkflowQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    __flags = WorkflowQueryFlags(**_flags) if _flags else None  # type: ignore

    workflow = (
        WorkflowQuery(
            name=name,
            description=description,
            #
            flags=__flags,
            meta=_meta,
            tags=_tags,
        )
        if __flags or _meta or _tags
        else None
    )

    workflow_refs = (
        (
            [
                Reference(
                    id=workflow_id,
                    slug=workflow_slug,
                )
            ]
            if workflow_id or workflow_slug
            else []
        )
        + (
            [
                Reference(
                    id=workflow_id,
                    slug=workflow_slug,
                )
                for workflow_id, workflow_slug in zip(
                    workflow_ids,
                    workflow_slugs,
                )
            ]
            if workflow_ids and workflow_slugs
            else []
        )
    ) or None

    windowing = (
        Windowing(
            next=next,
            newest=newest,
            oldest=oldest,
            limit=limit,
            order=order,
        )
        if next or newest or oldest or limit or order
        else None
    )

    return parse_workflow_query_request_from_body(
        workflow=workflow,
        #
        workflow_refs=workflow_refs,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_workflow_query_request_from_body(
    workflow: Optional[WorkflowQuery] = None,
    #
    workflow_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> WorkflowQueryRequest:
    workflow_query_request = None

    try:
        workflow_query_request = WorkflowQueryRequest(
            workflow=workflow,
            #
            workflow_refs=workflow_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )
    except Exception:  # pylint: disable=broad-except
        workflow_query_request = WorkflowQueryRequest()

    return workflow_query_request


def merge_workflow_query_requests(
    query_request_params: Optional[WorkflowQueryRequest] = None,
    query_request_body: Optional[WorkflowQueryRequest] = None,
) -> WorkflowQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return WorkflowQueryRequest(
            workflow=query_request_body.workflow or query_request_params.workflow,
            #
            workflow_refs=query_request_body.workflow_refs
            or query_request_params.workflow_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return WorkflowQueryRequest()


def parse_workflow_variant_query_request_from_params(
    workflow_id: Optional[UUID] = Query(None),
    workflow_ids: Optional[List[UUID]] = Query(None),
    workflow_slug: Optional[str] = Query(None),
    workflow_slugs: Optional[List[str]] = Query(None),
    #
    workflow_variant_id: Optional[UUID] = Query(None),
    workflow_variant_ids: Optional[List[UUID]] = Query(None),
    workflow_variant_slug: Optional[str] = Query(None),
    workflow_variant_slugs: Optional[List[str]] = Query(None),
    #
    name: Optional[str] = Query(None),
    description: Optional[str] = Query(None),
    #
    flags: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    #
    include_archived: Optional[bool] = Query(None),
    #
    next: Optional[UUID] = Query(None),  # pylint disable=redefined-builtin
    newest: Optional[datetime] = Query(None),
    oldest: Optional[datetime] = Query(None),
    limit: Optional[int] = Query(None),
    order: Optional[Literal["ascending", "descending"]] = Query(None),
) -> WorkflowVariantQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    __flags = WorkflowQueryFlags(**_flags) if _flags else None  # type: ignore

    workflow_variant = (
        WorkflowVariantQuery(
            name=name,
            description=description,
            #
            flags=__flags,
            meta=_meta,
            tags=_tags,
        )
        if __flags or _meta or _tags
        else None
    )

    workflow_refs = (
        (
            [
                Reference(
                    id=workflow_id,
                    slug=workflow_slug,
                )
            ]
            if workflow_id or workflow_slug
            else []
        )
        + (
            [
                Reference(
                    id=workflow_id,
                    slug=workflow_slug,
                )
                for workflow_id, workflow_slug in zip(
                    workflow_ids,
                    workflow_slugs,
                )
            ]
            if workflow_ids and workflow_slugs
            else []
        )
    ) or None

    workflow_variant_refs = (
        (
            [
                Reference(
                    id=workflow_variant_id,
                    slug=workflow_variant_slug,
                )
            ]
            if workflow_variant_id or workflow_variant_slug
            else []
        )
        + (
            [
                Reference(
                    id=workflow_variant_id,
                    slug=workflow_variant_slug,
                )
                for workflow_variant_id, workflow_variant_slug in zip(
                    workflow_variant_ids,
                    workflow_variant_slugs,
                )
            ]
            if workflow_variant_ids and workflow_variant_slugs
            else []
        )
    ) or None

    windowing = (
        Windowing(
            next=next,
            newest=newest,
            oldest=oldest,
            limit=limit,
            order=order,
        )
        if next or newest or oldest or limit or order
        else None
    )

    return parse_workflow_variant_query_request_from_body(
        workflow_variant=workflow_variant,
        #
        workflow_refs=workflow_refs or None,
        workflow_variant_refs=workflow_variant_refs or None,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_workflow_variant_query_request_from_body(
    workflow_variant: Optional[WorkflowVariantQuery] = None,
    #
    workflow_refs: Optional[List[Reference]] = None,
    workflow_variant_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> WorkflowVariantQueryRequest:
    workflow_variant_query_request = None

    try:
        workflow_variant_query_request = WorkflowVariantQueryRequest(
            workflow_variant=workflow_variant,
            #
            workflow_refs=workflow_refs,
            workflow_variant_refs=workflow_variant_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )
    except Exception:  # pylint: disable=broad-except
        workflow_variant_query_request = WorkflowVariantQueryRequest()

    return workflow_variant_query_request


def merge_workflow_variant_query_requests(
    query_request_params: Optional[WorkflowVariantQueryRequest] = None,
    query_request_body: Optional[WorkflowVariantQueryRequest] = None,
) -> WorkflowVariantQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return WorkflowVariantQueryRequest(
            workflow_variant=query_request_body.workflow_variant
            or query_request_params.workflow_variant,
            #
            workflow_refs=query_request_body.workflow_refs
            or query_request_params.workflow_refs,
            workflow_variant_refs=query_request_body.workflow_variant_refs
            or query_request_params.workflow_variant_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return WorkflowVariantQueryRequest()


def parse_workflow_revision_query_request_from_params(
    workflow_id: Optional[UUID] = Query(None),
    workflow_ids: Optional[List[UUID]] = Query(None),
    workflow_slug: Optional[str] = Query(None),
    workflow_slugs: Optional[List[str]] = Query(None),
    #
    workflow_variant_id: Optional[UUID] = Query(None),
    workflow_variant_ids: Optional[List[UUID]] = Query(None),
    workflow_variant_slug: Optional[str] = Query(None),
    workflow_variant_slugs: Optional[List[str]] = Query(None),
    #
    workflow_revision_id: Optional[UUID] = Query(None),
    workflow_revision_ids: Optional[List[UUID]] = Query(None),
    workflow_revision_slug: Optional[str] = Query(None),
    workflow_revision_slugs: Optional[List[str]] = Query(None),
    workflow_revision_version: Optional[str] = Query(None),
    workflow_revision_versions: Optional[List[str]] = Query(None),
    #
    name: Optional[str] = Query(None),
    description: Optional[str] = Query(None),
    #
    flags: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    #
    include_archived: Optional[bool] = Query(None),
    #
    next: Optional[UUID] = Query(None),  # pylint disable=redefined-builtin
    newest: Optional[datetime] = Query(None),
    oldest: Optional[datetime] = Query(None),
    limit: Optional[int] = Query(None),
    order: Optional[Literal["ascending", "descending"]] = Query(None),
) -> WorkflowRevisionQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    __flags = WorkflowQueryFlags(**_flags) if _flags else None  # type: ignore

    workflow_revision = (
        WorkflowRevisionQuery(
            name=name,
            description=description,
            #
            flags=__flags,
            meta=_meta,
            tags=_tags,
        )
        if __flags or _meta or _tags
        else None
    )

    workflow_refs = (
        [
            Reference(
                id=workflow_id,
                slug=workflow_slug,
            )
        ]
        if workflow_id or workflow_slug
        else []
    ) + (
        [
            Reference(
                id=workflow_id,
                slug=workflow_slug,
            )
            for workflow_id, workflow_slug in zip(
                workflow_ids,
                workflow_slugs,
            )
        ]
        if workflow_ids and workflow_slugs
        else []
    )

    workflow_variant_refs = (
        [
            Reference(
                id=workflow_variant_id,
                slug=workflow_variant_slug,
            )
        ]
        if workflow_variant_id or workflow_variant_slug
        else []
    ) + (
        [
            Reference(
                id=workflow_variant_id,
                slug=workflow_variant_slug,
            )
            for workflow_variant_id, workflow_variant_slug in zip(
                workflow_variant_ids,
                workflow_variant_slugs,
            )
        ]
        if workflow_variant_ids and workflow_variant_slugs
        else []
    )

    workflow_revision_refs = (
        [
            Reference(
                id=workflow_revision_id,
                slug=workflow_revision_slug,
                version=workflow_revision_version,
            )
        ]
        if workflow_revision_id or workflow_revision_slug or workflow_revision_version
        else []
    ) + (
        [
            Reference(
                id=workflow_revision_id,
                slug=workflow_revision_slug,
                version=workflow_revision_version,
            )
            for workflow_revision_id, workflow_revision_slug, workflow_revision_version in zip(
                workflow_revision_ids,
                workflow_revision_slugs,
                workflow_revision_versions,
            )
        ]
        if workflow_revision_ids
        and workflow_revision_slugs
        and workflow_revision_versions
        else []
    )

    windowing = (
        Windowing(
            next=next,
            newest=newest,
            oldest=oldest,
            limit=limit,
            order=order,
        )
        if next or newest or oldest or limit or order
        else None
    )

    return parse_workflow_revision_query_request_from_body(
        workflow_revision=workflow_revision,
        #
        workflow_refs=workflow_refs,
        workflow_variant_refs=workflow_variant_refs,
        workflow_revision_refs=workflow_revision_refs,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_workflow_revision_query_request_from_body(
    workflow_revision: Optional[WorkflowRevisionQuery] = None,
    #
    workflow_refs: Optional[List[Reference]] = None,
    workflow_variant_refs: Optional[List[Reference]] = None,
    workflow_revision_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> WorkflowRevisionQueryRequest:
    workflow_revision_query_request = None

    try:
        workflow_revision_query_request = WorkflowRevisionQueryRequest(
            workflow_revision=workflow_revision,
            #
            workflow_refs=workflow_refs,
            workflow_variant_refs=workflow_variant_refs,
            workflow_revision_refs=workflow_revision_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

    except Exception as e:  # pylint: disable=broad-except
        log.warn(e)

        workflow_revision_query_request = WorkflowRevisionQueryRequest()

    return workflow_revision_query_request


def merge_workflow_revision_query_requests(
    query_request_params: Optional[WorkflowRevisionQueryRequest] = None,
    query_request_body: Optional[WorkflowRevisionQueryRequest] = None,
) -> WorkflowRevisionQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return WorkflowRevisionQueryRequest(
            workflow_revision=query_request_body.workflow_revision
            or query_request_params.workflow_revision,
            #
            workflow_refs=query_request_body.workflow_refs
            or query_request_params.workflow_refs,
            workflow_variant_refs=query_request_body.workflow_variant_refs
            or query_request_params.workflow_variant_refs,
            workflow_revision_refs=query_request_body.workflow_revision_refs
            or query_request_params.workflow_revision_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return WorkflowRevisionQueryRequest()


def parse_workflow_revision_retrieve_request_from_params(
    workflow_id: Optional[UUID] = Query(None),
    workflow_slug: Optional[str] = Query(None),
    #
    workflow_variant_id: Optional[UUID] = Query(None),
    workflow_variant_slug: Optional[str] = Query(None),
    #
    workflow_revision_id: Optional[UUID] = Query(None),
    workflow_revision_slug: Optional[str] = Query(None),
    workflow_revision_version: Optional[str] = Query(None),
):
    workflow_ref = (
        Reference(
            id=workflow_id,
            slug=workflow_slug,
        )
        if workflow_id or workflow_slug
        else None
    )

    workflow_variant_ref = (
        Reference(
            id=workflow_variant_id,
            slug=workflow_variant_slug,
        )
        if workflow_variant_id or workflow_variant_slug
        else None
    )

    workflow_revision_ref = (
        Reference(
            id=workflow_revision_id,
            slug=workflow_revision_slug,
            version=workflow_revision_version,
        )
        if workflow_revision_id or workflow_revision_slug or workflow_revision_version
        else None
    )

    return parse_workflow_revision_retrieve_request_from_body(
        workflow_ref=workflow_ref,
        workflow_variant_ref=workflow_variant_ref,
        workflow_revision_ref=workflow_revision_ref,
    )


def parse_workflow_revision_retrieve_request_from_body(
    workflow_ref: Optional[Reference] = None,
    workflow_variant_ref: Optional[Reference] = None,
    workflow_revision_ref: Optional[Reference] = None,
) -> WorkflowRevisionRetrieveRequest:
    return WorkflowRevisionRetrieveRequest(
        workflow_ref=workflow_ref,
        workflow_variant_ref=workflow_variant_ref,
        workflow_revision_ref=workflow_revision_ref,
    )
