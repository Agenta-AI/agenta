from typing import Optional, Literal, List
from uuid import UUID
from datetime import datetime

from fastapi import Query

from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import (
    Windowing,
    Reference,
)
from oss.src.core.environments.dtos import (
    EnvironmentQuery,
    EnvironmentVariantQuery,
    EnvironmentRevisionQuery,
)

from oss.src.apis.fastapi.shared.utils import (
    parse_metadata,
)
from oss.src.apis.fastapi.environments.models import (
    EnvironmentQueryRequest,
    EnvironmentVariantQueryRequest,
    EnvironmentRevisionQueryRequest,
    EnvironmentRevisionRetrieveRequest,
)


log = get_module_logger(__name__)


def parse_environment_query_request_from_params(
    environment_id: Optional[UUID] = Query(None),
    environment_ids: Optional[List[UUID]] = Query(None),
    environment_slug: Optional[str] = Query(None),
    environment_slugs: Optional[List[str]] = Query(None),
    #
    name: Optional[str] = Query(None),
    description: Optional[str] = Query(None),
    #
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
) -> EnvironmentQueryRequest:
    _flags, _tags, _meta = parse_metadata(None, tags, meta)

    environment = (
        EnvironmentQuery(
            name=name,
            description=description,
            #
            meta=_meta,
            tags=_tags,
        )
        if name or description or _meta or _tags
        else None
    )

    environment_refs = (
        (
            [
                Reference(
                    id=environment_id,
                    slug=environment_slug,
                )
            ]
            if environment_id or environment_slug
            else []
        )
        + (
            [
                Reference(
                    id=environment_id,
                    slug=environment_slug,
                )
                for environment_id, environment_slug in zip(
                    environment_ids,
                    environment_slugs,
                )
            ]
            if environment_ids and environment_slugs
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

    return parse_environment_query_request_from_body(
        environment=environment,
        #
        environment_refs=environment_refs,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_environment_query_request_from_body(
    environment: Optional[EnvironmentQuery] = None,
    #
    environment_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> EnvironmentQueryRequest:
    environment_query_request = None

    try:
        environment_query_request = EnvironmentQueryRequest(
            environment=environment,
            #
            environment_refs=environment_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )
    except Exception:  # pylint: disable=broad-except
        environment_query_request = EnvironmentQueryRequest()

    return environment_query_request


def merge_environment_query_requests(
    query_request_params: Optional[EnvironmentQueryRequest] = None,
    query_request_body: Optional[EnvironmentQueryRequest] = None,
) -> EnvironmentQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return EnvironmentQueryRequest(
            environment=query_request_body.environment
            or query_request_params.environment,
            #
            environment_refs=query_request_body.environment_refs
            or query_request_params.environment_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return EnvironmentQueryRequest()


def parse_environment_variant_query_request_from_params(
    environment_id: Optional[UUID] = Query(None),
    environment_ids: Optional[List[UUID]] = Query(None),
    environment_slug: Optional[str] = Query(None),
    environment_slugs: Optional[List[str]] = Query(None),
    #
    environment_variant_id: Optional[UUID] = Query(None),
    environment_variant_ids: Optional[List[UUID]] = Query(None),
    environment_variant_slug: Optional[str] = Query(None),
    environment_variant_slugs: Optional[List[str]] = Query(None),
    #
    name: Optional[str] = Query(None),
    description: Optional[str] = Query(None),
    #
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
) -> EnvironmentVariantQueryRequest:
    _flags, _tags, _meta = parse_metadata(None, tags, meta)

    environment_variant = (
        EnvironmentVariantQuery(
            name=name,
            description=description,
            #
            meta=_meta,
            tags=_tags,
        )
        if name or description or _meta or _tags
        else None
    )

    environment_refs = (
        (
            [
                Reference(
                    id=environment_id,
                    slug=environment_slug,
                )
            ]
            if environment_id or environment_slug
            else []
        )
        + (
            [
                Reference(
                    id=environment_id,
                    slug=environment_slug,
                )
                for environment_id, environment_slug in zip(
                    environment_ids,
                    environment_slugs,
                )
            ]
            if environment_ids and environment_slugs
            else []
        )
    ) or None

    environment_variant_refs = (
        (
            [
                Reference(
                    id=environment_variant_id,
                    slug=environment_variant_slug,
                )
            ]
            if environment_variant_id or environment_variant_slug
            else []
        )
        + (
            [
                Reference(
                    id=environment_variant_id,
                    slug=environment_variant_slug,
                )
                for environment_variant_id, environment_variant_slug in zip(
                    environment_variant_ids,
                    environment_variant_slugs,
                )
            ]
            if environment_variant_ids and environment_variant_slugs
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

    return parse_environment_variant_query_request_from_body(
        environment_variant=environment_variant,
        #
        environment_refs=environment_refs or None,
        environment_variant_refs=environment_variant_refs or None,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_environment_variant_query_request_from_body(
    environment_variant: Optional[EnvironmentVariantQuery] = None,
    #
    environment_refs: Optional[List[Reference]] = None,
    environment_variant_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> EnvironmentVariantQueryRequest:
    environment_variant_query_request = None

    try:
        environment_variant_query_request = EnvironmentVariantQueryRequest(
            environment_variant=environment_variant,
            #
            environment_refs=environment_refs,
            environment_variant_refs=environment_variant_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )
    except Exception:  # pylint: disable=broad-except
        environment_variant_query_request = EnvironmentVariantQueryRequest()

    return environment_variant_query_request


def merge_environment_variant_query_requests(
    query_request_params: Optional[EnvironmentVariantQueryRequest] = None,
    query_request_body: Optional[EnvironmentVariantQueryRequest] = None,
) -> EnvironmentVariantQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return EnvironmentVariantQueryRequest(
            environment_variant=query_request_body.environment_variant
            or query_request_params.environment_variant,
            #
            environment_refs=query_request_body.environment_refs
            or query_request_params.environment_refs,
            environment_variant_refs=query_request_body.environment_variant_refs
            or query_request_params.environment_variant_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return EnvironmentVariantQueryRequest()


def parse_environment_revision_query_request_from_params(
    environment_id: Optional[UUID] = Query(None),
    environment_ids: Optional[List[UUID]] = Query(None),
    environment_slug: Optional[str] = Query(None),
    environment_slugs: Optional[List[str]] = Query(None),
    #
    environment_variant_id: Optional[UUID] = Query(None),
    environment_variant_ids: Optional[List[UUID]] = Query(None),
    environment_variant_slug: Optional[str] = Query(None),
    environment_variant_slugs: Optional[List[str]] = Query(None),
    #
    environment_revision_id: Optional[UUID] = Query(None),
    environment_revision_ids: Optional[List[UUID]] = Query(None),
    environment_revision_slug: Optional[str] = Query(None),
    environment_revision_slugs: Optional[List[str]] = Query(None),
    environment_revision_version: Optional[str] = Query(None),
    environment_revision_versions: Optional[List[str]] = Query(None),
    #
    name: Optional[str] = Query(None),
    description: Optional[str] = Query(None),
    #
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
) -> EnvironmentRevisionQueryRequest:
    _flags, _tags, _meta = parse_metadata(None, tags, meta)

    environment_revision = (
        EnvironmentRevisionQuery(
            name=name,
            description=description,
            #
            meta=_meta,
            tags=_tags,
        )
        if name or description or _meta or _tags
        else None
    )

    environment_refs = (
        [
            Reference(
                id=environment_id,
                slug=environment_slug,
            )
        ]
        if environment_id or environment_slug
        else []
    ) + (
        [
            Reference(
                id=environment_id,
                slug=environment_slug,
            )
            for environment_id, environment_slug in zip(
                environment_ids,
                environment_slugs,
            )
        ]
        if environment_ids and environment_slugs
        else []
    )

    environment_variant_refs = (
        [
            Reference(
                id=environment_variant_id,
                slug=environment_variant_slug,
            )
        ]
        if environment_variant_id or environment_variant_slug
        else []
    ) + (
        [
            Reference(
                id=environment_variant_id,
                slug=environment_variant_slug,
            )
            for environment_variant_id, environment_variant_slug in zip(
                environment_variant_ids,
                environment_variant_slugs,
            )
        ]
        if environment_variant_ids and environment_variant_slugs
        else []
    )

    environment_revision_refs = (
        [
            Reference(
                id=environment_revision_id,
                slug=environment_revision_slug,
                version=environment_revision_version,
            )
        ]
        if environment_revision_id
        or environment_revision_slug
        or environment_revision_version
        else []
    ) + (
        [
            Reference(
                id=environment_revision_id,
                slug=environment_revision_slug,
                version=environment_revision_version,
            )
            for environment_revision_id, environment_revision_slug, environment_revision_version in zip(
                environment_revision_ids,
                environment_revision_slugs,
                environment_revision_versions,
            )
        ]
        if environment_revision_ids
        and environment_revision_slugs
        and environment_revision_versions
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

    return parse_environment_revision_query_request_from_body(
        environment_revision=environment_revision,
        #
        environment_refs=environment_refs,
        environment_variant_refs=environment_variant_refs,
        environment_revision_refs=environment_revision_refs,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_environment_revision_query_request_from_body(
    environment_revision: Optional[EnvironmentRevisionQuery] = None,
    #
    environment_refs: Optional[List[Reference]] = None,
    environment_variant_refs: Optional[List[Reference]] = None,
    environment_revision_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> EnvironmentRevisionQueryRequest:
    environment_revision_query_request = None

    try:
        environment_revision_query_request = EnvironmentRevisionQueryRequest(
            environment_revision=environment_revision,
            #
            environment_refs=environment_refs,
            environment_variant_refs=environment_variant_refs,
            environment_revision_refs=environment_revision_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

    except Exception as e:  # pylint: disable=broad-except
        log.warn(e)

        environment_revision_query_request = EnvironmentRevisionQueryRequest()

    return environment_revision_query_request


def merge_environment_revision_query_requests(
    query_request_params: Optional[EnvironmentRevisionQueryRequest] = None,
    query_request_body: Optional[EnvironmentRevisionQueryRequest] = None,
) -> EnvironmentRevisionQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return EnvironmentRevisionQueryRequest(
            environment_revision=query_request_body.environment_revision
            or query_request_params.environment_revision,
            #
            environment_refs=query_request_body.environment_refs
            or query_request_params.environment_refs,
            environment_variant_refs=query_request_body.environment_variant_refs
            or query_request_params.environment_variant_refs,
            environment_revision_refs=query_request_body.environment_revision_refs
            or query_request_params.environment_revision_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return EnvironmentRevisionQueryRequest()


def parse_environment_revision_retrieve_request_from_params(
    environment_id: Optional[UUID] = Query(None),
    environment_slug: Optional[str] = Query(None),
    #
    environment_variant_id: Optional[UUID] = Query(None),
    environment_variant_slug: Optional[str] = Query(None),
    #
    environment_revision_id: Optional[UUID] = Query(None),
    environment_revision_slug: Optional[str] = Query(None),
    environment_revision_version: Optional[str] = Query(None),
):
    environment_ref = (
        Reference(
            id=environment_id,
            slug=environment_slug,
        )
        if environment_id or environment_slug
        else None
    )

    environment_variant_ref = (
        Reference(
            id=environment_variant_id,
            slug=environment_variant_slug,
        )
        if environment_variant_id or environment_variant_slug
        else None
    )

    environment_revision_ref = (
        Reference(
            id=environment_revision_id,
            slug=environment_revision_slug,
            version=environment_revision_version,
        )
        if environment_revision_id
        or environment_revision_slug
        or environment_revision_version
        else None
    )

    return parse_environment_revision_retrieve_request_from_body(
        environment_ref=environment_ref,
        environment_variant_ref=environment_variant_ref,
        environment_revision_ref=environment_revision_ref,
    )


def parse_environment_revision_retrieve_request_from_body(
    environment_ref: Optional[Reference] = None,
    environment_variant_ref: Optional[Reference] = None,
    environment_revision_ref: Optional[Reference] = None,
) -> EnvironmentRevisionRetrieveRequest:
    return EnvironmentRevisionRetrieveRequest(
        environment_ref=environment_ref,
        environment_variant_ref=environment_variant_ref,
        environment_revision_ref=environment_revision_ref,
    )
