from typing import Optional
from json import loads
from uuid import UUID
from datetime import datetime

from fastapi import Query

from oss.src.utils.logging import get_module_logger
from oss.src.core.shared.dtos import Reference, Meta, Flags, Windowing
from oss.src.core.workflows.dtos import (
    WorkflowFlags,
    #
    WorkflowQuery,
    WorkflowVariantQuery,
    WorkflowRevisionQuery,
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
    flags: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    #
    include_archived: Optional[bool] = Query(None),
    #
    next: Optional[UUID] = Query(None),  # pylint disable=redefined-builtin
    start: Optional[datetime] = Query(None),
    stop: Optional[datetime] = Query(None),
    limit: Optional[int] = Query(None),
) -> WorkflowQueryRequest:
    if flags:
        try:
            flags = WorkflowFlags(**loads(flags)) if flags else WorkflowFlags()

        except Exception:  # pylint: disable=broad-except
            flags = None

            log.warn("Failed to parse flags (%s)", flags)

    if tags:
        try:
            tags = loads(tags)
        except Exception:  # pylint: disable=broad-except
            tags = None

            log.warn("Failed to parse tags (%s)", tags)

    if meta:
        try:
            meta = loads(meta)
        except Exception:  # pylint: disable=broad-except
            meta = None

            log.warn(f"Failed to parse meta ({meta})")

    return parse_workflow_query_request_from_body(
        workflow_id=workflow_id,
        flags=flags,
        tags=tags,
        meta=meta,
        #
        include_archived=include_archived,
        #
        next=next,
        start=start,
        stop=stop,
        limit=limit,
    )


def parse_workflow_query_request_from_body(
    workflow_id: Optional[UUID] = None,
    flags: Optional[WorkflowFlags] = None,
    tags: Optional[dict] = None,
    meta: Optional[Meta] = None,
    #
    include_archived: Optional[bool] = None,
    #
    next: Optional[UUID] = None,  # pylint disable=redefined-builtin
    start: Optional[datetime] = None,
    stop: Optional[datetime] = None,
    limit: Optional[int] = None,
    order: Optional[str] = None,
) -> WorkflowQueryRequest:
    workflow_query_request = None

    try:
        workflow_query_request = WorkflowQueryRequest(
            workflow=(
                WorkflowQuery(
                    workflow_id=workflow_id,
                    #
                    flags=flags,
                    meta=meta,
                    tags=tags,
                )
                if workflow_id or flags or meta or tags
                else None
            ),
            #
            include_archived=include_archived,
            #
            windowing=(
                Windowing(
                    next=next,
                    start=start,
                    stop=stop,
                    limit=limit,
                    order=order,
                )
                if next or start or stop or limit
                else None
            ),
        )
    except Exception as e:  # pylint: disable=broad-except
        log.warn("Error parsing workflow query request: %s", e)

        workflow_query_request = None

    return workflow_query_request


def merge_workflow_query_requests(
    query_request_params: Optional[WorkflowQueryRequest] = None,
    query_request_body: Optional[WorkflowQueryRequest] = None,
) -> WorkflowQueryRequest:
    if query_request_body is None:
        return query_request_params

    if query_request_params is None:
        return query_request_body

    return WorkflowQueryRequest(
        workflow=query_request_body.workflow or query_request_params.workflow,
        #
        include_archived=query_request_body.include_archived
        or query_request_params.include_archived,
        #
        windowing=query_request_body.windowing or query_request_params.windowing,
    )


def parse_workflow_variant_query_request_from_params(
    workflow_id: Optional[UUID] = Query(None),
    workflow_variant_id: Optional[UUID] = Query(None),
    flags: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    #
    include_archived: Optional[bool] = Query(None),
    #
    next: Optional[UUID] = Query(None),  # pylint disable=redefined-builtin
    start: Optional[datetime] = Query(None),
    stop: Optional[datetime] = Query(None),
    limit: Optional[int] = Query(None),
) -> WorkflowVariantQueryRequest:
    if flags:
        try:
            flags = WorkflowFlags(**loads(flags)) if flags else WorkflowFlags()

        except Exception:  # pylint: disable=broad-except
            flags = None

            log.warn("Failed to parse flags (%s)", flags)

    if tags:
        try:
            tags = loads(tags)
        except Exception:  # pylint: disable=broad-except
            tags = None

            log.warn("Failed to parse tags (%s)", tags)

    if meta:
        try:
            meta = loads(meta)
        except Exception:  # pylint: disable=broad-except
            meta = None

            log.warn(f"Failed to parse meta ({meta})")

    return parse_workflow_variant_query_request_from_body(
        workflow_id=workflow_id,
        workflow_variant_id=workflow_variant_id,
        flags=flags,
        tags=tags,
        meta=meta,
        #
        include_archived=include_archived,
        #
        next=next,
        start=start,
        stop=stop,
        limit=limit,
    )


def parse_workflow_variant_query_request_from_body(
    workflow_id: Optional[UUID] = None,
    workflow_variant_id: Optional[UUID] = None,
    flags: Optional[WorkflowFlags] = None,
    tags: Optional[dict] = None,
    meta: Optional[Meta] = None,
    #
    include_archived: Optional[bool] = None,
    #
    next: Optional[UUID] = None,  # pylint disable=redefined-builtin
    start: Optional[datetime] = None,
    stop: Optional[datetime] = None,
    limit: Optional[int] = None,
    order: Optional[str] = None,
) -> WorkflowVariantQueryRequest:
    workflow_variant_query_request = None

    try:
        workflow_variant_query_request = WorkflowVariantQueryRequest(
            workflow_variant=(
                WorkflowVariantQuery(
                    workflow_id=workflow_id,
                    workflow_variant_id=workflow_variant_id,
                    flags=flags,
                    meta=meta,
                    tags=tags,
                )
                if workflow_id or workflow_variant_id or flags or meta or tags
                else None
            ),
            #
            include_archived=include_archived,
            #
            windowing=(
                Windowing(
                    next=next,
                    start=start,
                    stop=stop,
                    limit=limit,
                    order=order,
                )
                if next or start or stop or limit
                else None
            ),
        )
    except Exception as e:  # pylint: disable=broad-except
        log.warn("Error parsing workflow variant body request: %s", e)

        workflow_variant_query_request = None

    return workflow_variant_query_request


def merge_workflow_variant_query_requests(
    query_request_params: Optional[WorkflowVariantQueryRequest] = None,
    query_request_body: Optional[WorkflowVariantQueryRequest] = None,
) -> WorkflowVariantQueryRequest:
    if query_request_body is None:
        return query_request_params

    if query_request_params is None:
        return query_request_body

    return WorkflowVariantQueryRequest(
        workflow_variant=query_request_body.workflow_variant
        or query_request_params.workflow_variant,
        #
        include_archived=query_request_body.include_archived
        or query_request_params.include_archived,
        #
        windowing=query_request_body.windowing or query_request_params.windowing,
    )


def parse_workflow_revision_query_request_from_params(
    workflow_id: Optional[UUID] = Query(None),
    workflow_variant_id: Optional[UUID] = Query(None),
    workflow_revision_id: Optional[UUID] = Query(None),
    flags: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    #
    include_archived: Optional[bool] = Query(None),
    #
    next: Optional[UUID] = Query(None),  # pylint disable=redefined-builtin
    start: Optional[datetime] = Query(None),
    stop: Optional[datetime] = Query(None),
    limit: Optional[int] = Query(None),
) -> WorkflowRevisionQueryRequest:
    if flags:
        try:
            flags = WorkflowFlags(**loads(flags)) if flags else WorkflowFlags()

        except Exception:  # pylint: disable=broad-except
            flags = None

            log.warn("Failed to parse flags (%s)", flags)

    if tags:
        try:
            tags = loads(tags)
        except Exception:
            tags = None

            log.warn("Failed to parse tags (%s)", tags)

    if meta:
        try:
            meta = loads(meta)
        except Exception:
            meta = None

            log.warn(f"Failed to parse meta ({meta})")

    return parse_workflow_revision_query_request_from_body(
        workflow_id=workflow_id,
        workflow_variant_id=workflow_variant_id,
        workflow_revision_id=workflow_revision_id,
        flags=flags,
        tags=tags,
        meta=meta,
        #
        include_archived=include_archived,
        #
        next=next,
        start=start,
        stop=stop,
        limit=limit,
    )


def parse_workflow_revision_query_request_from_body(
    workflow_id: Optional[UUID] = None,
    workflow_variant_id: Optional[UUID] = None,
    workflow_revision_id: Optional[UUID] = None,
    flags: Optional[WorkflowFlags] = None,
    tags: Optional[dict] = None,
    meta: Optional[Meta] = None,
    #
    include_archived: Optional[bool] = None,
    #
    next: Optional[UUID] = None,  # pylint disable=redefined-builtin
    start: Optional[datetime] = None,
    stop: Optional[datetime] = None,
    limit: Optional[int] = None,
    order: Optional[str] = None,
) -> WorkflowRevisionQueryRequest:
    workflow_revision_query_request = None

    try:
        workflow_revision_query_request = WorkflowRevisionQueryRequest(
            workflow_revision=(
                WorkflowRevisionQuery(
                    workflow_id=workflow_id,
                    workflow_variant_id=workflow_variant_id,
                    workflow_revision_id=workflow_revision_id,
                    flags=flags,
                    meta=meta,
                    tags=tags,
                )
                if workflow_id
                or workflow_variant_id
                or workflow_revision_id
                or flags
                or meta
                or tags
                else None
            ),
            #
            include_archived=include_archived,
            #
            windowing=(
                Windowing(
                    next=next,
                    start=start,
                    stop=stop,
                    limit=limit,
                    order=order,
                )
                if next or start or stop or limit
                else None
            ),
        )

    except Exception as e:  # pylint: disable=broad-except
        log.warn(e)

        workflow_revision_query_request = None

    return workflow_revision_query_request


def merge_workflow_revision_query_requests(
    query_request_param: Optional[WorkflowRevisionQueryRequest] = None,
    query_request_body: Optional[WorkflowRevisionQueryRequest] = None,
) -> WorkflowRevisionQueryRequest:
    if query_request_body is None:
        return query_request_param

    if query_request_param is None:
        return query_request_body

    return WorkflowRevisionQueryRequest(
        workflow_revision=query_request_body.workflow_revision
        or query_request_param.workflow_revision,
        #
        include_archived=query_request_body.include_archived
        or query_request_param.include_archived,
        #
        windowing=query_request_body.windowing or query_request_param.windowing,
    )


def parse_workflow_revision_retrieve_request_from_params(
    workflow_variant_id: Optional[UUID] = Query(None),
    workflow_variant_slug: Optional[str] = Query(None),
    #
    workflow_revision_id: Optional[UUID] = Query(None),
    workflow_revision_slug: Optional[str] = Query(None),
    workflow_revision_version: Optional[str] = Query(None),
):
    return parse_workflow_revision_retrieve_request_from_body(
        workflow_variant_id=workflow_variant_id,
        workflow_variant_slug=workflow_variant_slug,
        #
        workflow_revision_id=workflow_revision_id,
        workflow_revision_slug=workflow_revision_slug,
        workflow_revision_version=workflow_revision_version,
    )


def parse_workflow_revision_retrieve_request_from_body(
    workflow_variant_id: Optional[UUID] = None,
    workflow_variant_slug: Optional[str] = None,
    #
    workflow_revision_id: Optional[UUID] = None,
    workflow_revision_slug: Optional[str] = None,
    workflow_revision_version: Optional[str] = None,
) -> Optional[WorkflowRevisionRetrieveRequest]:
    return (
        WorkflowRevisionRetrieveRequest(
            workflow_variant_ref=(
                Reference(
                    id=workflow_variant_id,
                    slug=workflow_variant_slug,
                )
                if workflow_variant_id or workflow_variant_slug
                else None
            ),
            #
            workflow_revision_ref=(
                Reference(
                    id=workflow_revision_id,
                    slug=workflow_revision_slug,
                    version=workflow_revision_version,
                )
                if workflow_revision_id
                or workflow_revision_slug
                or workflow_revision_version
                else None
            ),
        )
        if (
            workflow_variant_id
            or workflow_variant_slug
            or workflow_revision_id
            or workflow_revision_slug
            or workflow_revision_version
        )
        else None
    )
