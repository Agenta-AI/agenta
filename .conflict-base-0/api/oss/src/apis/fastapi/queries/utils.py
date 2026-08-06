from typing import Optional, Literal, List
from uuid import UUID
from datetime import datetime

from fastapi import Query

from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import (
    Windowing,
    Reference,
)
from oss.src.core.queries.dtos import (
    # QueryFlags,
    #
    QueryQuery,
    QueryVariantQuery,
    QueryRevisionQuery,
)

from oss.src.apis.fastapi.shared.utils import (
    parse_metadata,
)
from oss.src.apis.fastapi.queries.models import (
    QueryQueryRequest,
    QueryVariantQueryRequest,
    QueryRevisionQueryRequest,
    QueryRevisionRetrieveRequest,
)


log = get_module_logger(__name__)


def parse_query_query_request_from_params(
    query_id: Optional[UUID] = Query(None),
    query_ids: Optional[List[UUID]] = Query(None),
    query_slug: Optional[str] = Query(None),
    query_slugs: Optional[List[str]] = Query(None),
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
) -> QueryQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    __flags = _flags  # QueryFlags(**_flags) if _flags else None

    query = (
        QueryQuery(
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

    query_refs = (
        (
            [
                Reference(
                    id=query_id,
                    slug=query_slug,
                )
            ]
            if query_id or query_slug
            else []
        )
        + (
            [
                Reference(
                    id=query_id,
                    slug=query_slug,
                )
                for query_id, query_slug in zip(
                    query_ids,
                    query_slugs,
                )
            ]
            if query_ids and query_slugs
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

    return parse_query_query_request_from_body(
        query=query,
        #
        query_refs=query_refs,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_query_query_request_from_body(
    query: Optional[QueryQuery] = None,
    #
    query_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> QueryQueryRequest:
    query_query_request = None

    try:
        query_query_request = QueryQueryRequest(
            query=query,
            #
            query_refs=query_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )
    except Exception:  # pylint: disable=broad-except
        query_query_request = QueryQueryRequest()

    return query_query_request


def merge_query_query_requests(
    query_request_params: Optional[QueryQueryRequest] = None,
    query_request_body: Optional[QueryQueryRequest] = None,
) -> QueryQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return QueryQueryRequest(
            query=query_request_body.query or query_request_params.query,
            #
            query_refs=query_request_body.query_refs or query_request_params.query_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return QueryQueryRequest()


def parse_query_variant_query_request_from_params(
    query_id: Optional[UUID] = Query(None),
    query_ids: Optional[List[UUID]] = Query(None),
    query_slug: Optional[str] = Query(None),
    query_slugs: Optional[List[str]] = Query(None),
    #
    query_variant_id: Optional[UUID] = Query(None),
    query_variant_ids: Optional[List[UUID]] = Query(None),
    query_variant_slug: Optional[str] = Query(None),
    query_variant_slugs: Optional[List[str]] = Query(None),
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
) -> QueryVariantQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    __flags = _flags  # QueryFlags(**_flags) if _flags else None

    query_variant = (
        QueryVariantQuery(
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

    query_refs = (
        (
            [
                Reference(
                    id=query_id,
                    slug=query_slug,
                )
            ]
            if query_id or query_slug
            else []
        )
        + (
            [
                Reference(
                    id=query_id,
                    slug=query_slug,
                )
                for query_id, query_slug in zip(
                    query_ids,
                    query_slugs,
                )
            ]
            if query_ids and query_slugs
            else []
        )
    ) or None

    query_variant_refs = (
        (
            [
                Reference(
                    id=query_variant_id,
                    slug=query_variant_slug,
                )
            ]
            if query_variant_id or query_variant_slug
            else []
        )
        + (
            [
                Reference(
                    id=query_variant_id,
                    slug=query_variant_slug,
                )
                for query_variant_id, query_variant_slug in zip(
                    query_variant_ids,
                    query_variant_slugs,
                )
            ]
            if query_variant_ids and query_variant_slugs
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

    return parse_query_variant_query_request_from_body(
        query_variant=query_variant,
        #
        query_refs=query_refs or None,
        query_variant_refs=query_variant_refs or None,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_query_variant_query_request_from_body(
    query_variant: Optional[QueryVariantQuery] = None,
    #
    query_refs: Optional[List[Reference]] = None,
    query_variant_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> QueryVariantQueryRequest:
    query_variant_query_request = None

    try:
        query_variant_query_request = QueryVariantQueryRequest(
            query_variant=query_variant,
            #
            query_refs=query_refs,
            query_variant_refs=query_variant_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )
    except Exception:  # pylint: disable=broad-except
        query_variant_query_request = QueryVariantQueryRequest()

    return query_variant_query_request


def merge_query_variant_query_requests(
    query_request_params: Optional[QueryVariantQueryRequest] = None,
    query_request_body: Optional[QueryVariantQueryRequest] = None,
) -> QueryVariantQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return QueryVariantQueryRequest(
            query_variant=query_request_body.query_variant
            or query_request_params.query_variant,
            #
            query_refs=query_request_body.query_refs or query_request_params.query_refs,
            query_variant_refs=query_request_body.query_variant_refs
            or query_request_params.query_variant_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return QueryVariantQueryRequest()


def parse_query_revision_query_request_from_params(
    query_id: Optional[UUID] = Query(None),
    query_ids: Optional[List[UUID]] = Query(None),
    query_slug: Optional[str] = Query(None),
    query_slugs: Optional[List[str]] = Query(None),
    #
    query_variant_id: Optional[UUID] = Query(None),
    query_variant_ids: Optional[List[UUID]] = Query(None),
    query_variant_slug: Optional[str] = Query(None),
    query_variant_slugs: Optional[List[str]] = Query(None),
    #
    query_revision_id: Optional[UUID] = Query(None),
    query_revision_ids: Optional[List[UUID]] = Query(None),
    query_revision_slug: Optional[str] = Query(None),
    query_revision_slugs: Optional[List[str]] = Query(None),
    query_revision_version: Optional[str] = Query(None),
    query_revision_versions: Optional[List[str]] = Query(None),
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
) -> QueryRevisionQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    __flags = _flags  # QueryFlags(**_flags) if _flags else None

    query_revision = (
        QueryRevisionQuery(
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

    query_refs = (
        [
            Reference(
                id=query_id,
                slug=query_slug,
            )
        ]
        if query_id or query_slug
        else []
    ) + (
        [
            Reference(
                id=query_id,
                slug=query_slug,
            )
            for query_id, query_slug in zip(
                query_ids,
                query_slugs,
            )
        ]
        if query_ids and query_slugs
        else []
    )

    query_variant_refs = (
        [
            Reference(
                id=query_variant_id,
                slug=query_variant_slug,
            )
        ]
        if query_variant_id or query_variant_slug
        else []
    ) + (
        [
            Reference(
                id=query_variant_id,
                slug=query_variant_slug,
            )
            for query_variant_id, query_variant_slug in zip(
                query_variant_ids,
                query_variant_slugs,
            )
        ]
        if query_variant_ids and query_variant_slugs
        else []
    )

    query_revision_refs = (
        [
            Reference(
                id=query_revision_id,
                slug=query_revision_slug,
                version=query_revision_version,
            )
        ]
        if query_revision_id or query_revision_slug or query_revision_version
        else []
    ) + (
        [
            Reference(
                id=query_revision_id,
                slug=query_revision_slug,
                version=query_revision_version,
            )
            for query_revision_id, query_revision_slug, query_revision_version in zip(
                query_revision_ids,
                query_revision_slugs,
                query_revision_versions,
            )
        ]
        if query_revision_ids and query_revision_slugs and query_revision_versions
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

    return parse_query_revision_query_request_from_body(
        query_revision=query_revision,
        #
        query_refs=query_refs,
        query_variant_refs=query_variant_refs,
        query_revision_refs=query_revision_refs,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_query_revision_query_request_from_body(
    query_revision: Optional[QueryRevisionQuery] = None,
    #
    query_refs: Optional[List[Reference]] = None,
    query_variant_refs: Optional[List[Reference]] = None,
    query_revision_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> QueryRevisionQueryRequest:
    query_revision_query_request = None

    try:
        query_revision_query_request = QueryRevisionQueryRequest(
            query_revision=query_revision,
            #
            query_refs=query_refs,
            query_variant_refs=query_variant_refs,
            query_revision_refs=query_revision_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

    except Exception as e:  # pylint: disable=broad-except
        log.warn(e)

        query_revision_query_request = QueryRevisionQueryRequest()

    return query_revision_query_request


def merge_query_revision_query_requests(
    query_request_params: Optional[QueryRevisionQueryRequest] = None,
    query_request_body: Optional[QueryRevisionQueryRequest] = None,
) -> QueryRevisionQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return QueryRevisionQueryRequest(
            query_revision=query_request_body.query_revision
            or query_request_params.query_revision,
            #
            query_refs=query_request_body.query_refs or query_request_params.query_refs,
            query_variant_refs=query_request_body.query_variant_refs
            or query_request_params.query_variant_refs,
            query_revision_refs=query_request_body.query_revision_refs
            or query_request_params.query_revision_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return QueryRevisionQueryRequest()


def parse_query_revision_retrieve_request_from_params(
    query_id: Optional[UUID] = Query(None),
    query_slug: Optional[str] = Query(None),
    #
    query_variant_id: Optional[UUID] = Query(None),
    query_variant_slug: Optional[str] = Query(None),
    #
    query_revision_id: Optional[UUID] = Query(None),
    query_revision_slug: Optional[str] = Query(None),
    query_revision_version: Optional[str] = Query(None),
):
    query_ref = (
        Reference(
            id=query_id,
            slug=query_slug,
        )
        if query_id or query_slug
        else None
    )

    query_variant_ref = (
        Reference(
            id=query_variant_id,
            slug=query_variant_slug,
        )
        if query_variant_id or query_variant_slug
        else None
    )

    query_revision_ref = (
        Reference(
            id=query_revision_id,
            slug=query_revision_slug,
            version=query_revision_version,
        )
        if query_revision_id or query_revision_slug or query_revision_version
        else None
    )

    return parse_query_revision_retrieve_request_from_body(
        query_ref=query_ref,
        query_variant_ref=query_variant_ref,
        query_revision_ref=query_revision_ref,
    )


def parse_query_revision_retrieve_request_from_body(
    query_ref: Optional[Reference] = None,
    query_variant_ref: Optional[Reference] = None,
    query_revision_ref: Optional[Reference] = None,
) -> QueryRevisionRetrieveRequest:
    return QueryRevisionRetrieveRequest(
        query_ref=query_ref,
        query_variant_ref=query_variant_ref,
        query_revision_ref=query_revision_ref,
    )
