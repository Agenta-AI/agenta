from typing import Optional, Literal, List
from uuid import UUID
from datetime import datetime

from fastapi import Query

from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import (
    Windowing,
    Reference,
)
from oss.src.core.applications.dtos import (
    ApplicationQueryFlags,
    #
    ApplicationQuery,
    ApplicationVariantQuery,
    ApplicationRevisionQuery,
)

from oss.src.apis.fastapi.shared.utils import (
    parse_metadata,
)
from oss.src.apis.fastapi.applications.models import (
    ApplicationQueryRequest,
    ApplicationVariantQueryRequest,
    ApplicationRevisionQueryRequest,
    ApplicationRevisionRetrieveRequest,
)


log = get_module_logger(__name__)


# APPLICATION QUERY ------------------------------------------------------------


def parse_application_query_request_from_params(
    application_id: Optional[UUID] = Query(None),
    application_ids: Optional[List[UUID]] = Query(None),
    application_slug: Optional[str] = Query(None),
    application_slugs: Optional[List[str]] = Query(None),
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
) -> ApplicationQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    __flags = ApplicationQueryFlags(**_flags) if _flags else None

    application = (
        ApplicationQuery(
            name=name,
            description=description,
            #
            flags=__flags,
            meta=_meta,
            tags=_tags,
        )
        if name or description or __flags or _meta or _tags
        else None
    )

    application_refs = (
        (
            [
                Reference(
                    id=application_id,
                    slug=application_slug,
                )
            ]
            if application_id or application_slug
            else []
        )
        + (
            [
                Reference(
                    id=application_id,
                    slug=application_slug,
                )
                for application_id, application_slug in zip(
                    application_ids,
                    application_slugs,
                )
            ]
            if application_ids and application_slugs
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

    return parse_application_query_request_from_body(
        application=application,
        #
        application_refs=application_refs,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_application_query_request_from_body(
    application: Optional[ApplicationQuery] = None,
    #
    application_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> ApplicationQueryRequest:
    application_query_request = None

    try:
        application_query_request = ApplicationQueryRequest(
            application=application,
            #
            application_refs=application_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )
    except Exception:  # pylint: disable=broad-except
        application_query_request = ApplicationQueryRequest()

    return application_query_request


def merge_application_query_requests(
    query_request_params: Optional[ApplicationQueryRequest] = None,
    query_request_body: Optional[ApplicationQueryRequest] = None,
) -> ApplicationQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return ApplicationQueryRequest(
            application=query_request_body.application
            or query_request_params.application,
            #
            application_refs=query_request_body.application_refs
            or query_request_params.application_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return ApplicationQueryRequest()


# APPLICATION VARIANT QUERY ----------------------------------------------------


def parse_application_variant_query_request_from_params(
    application_id: Optional[UUID] = Query(None),
    application_ids: Optional[List[UUID]] = Query(None),
    application_slug: Optional[str] = Query(None),
    application_slugs: Optional[List[str]] = Query(None),
    #
    application_variant_id: Optional[UUID] = Query(None),
    application_variant_ids: Optional[List[UUID]] = Query(None),
    application_variant_slug: Optional[str] = Query(None),
    application_variant_slugs: Optional[List[str]] = Query(None),
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
) -> ApplicationVariantQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    __flags = ApplicationQueryFlags(**_flags) if _flags else None

    application_variant = (
        ApplicationVariantQuery(
            name=name,
            description=description,
            #
            flags=__flags,
            meta=_meta,
            tags=_tags,
        )
        if name or description or __flags or _meta or _tags
        else None
    )

    application_refs = (
        (
            [
                Reference(
                    id=application_id,
                    slug=application_slug,
                )
            ]
            if application_id or application_slug
            else []
        )
        + (
            [
                Reference(
                    id=application_id,
                    slug=application_slug,
                )
                for application_id, application_slug in zip(
                    application_ids,
                    application_slugs,
                )
            ]
            if application_ids and application_slugs
            else []
        )
    ) or None

    application_variant_refs = (
        (
            [
                Reference(
                    id=application_variant_id,
                    slug=application_variant_slug,
                )
            ]
            if application_variant_id or application_variant_slug
            else []
        )
        + (
            [
                Reference(
                    id=application_variant_id,
                    slug=application_variant_slug,
                )
                for application_variant_id, application_variant_slug in zip(
                    application_variant_ids,
                    application_variant_slugs,
                )
            ]
            if application_variant_ids and application_variant_slugs
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

    return parse_application_variant_query_request_from_body(
        application_variant=application_variant,
        #
        application_refs=application_refs or None,
        application_variant_refs=application_variant_refs or None,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_application_variant_query_request_from_body(
    application_variant: Optional[ApplicationVariantQuery] = None,
    #
    application_refs: Optional[List[Reference]] = None,
    application_variant_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> ApplicationVariantQueryRequest:
    application_variant_query_request = None

    try:
        application_variant_query_request = ApplicationVariantQueryRequest(
            application_variant=application_variant,
            #
            application_refs=application_refs,
            application_variant_refs=application_variant_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )
    except Exception:  # pylint: disable=broad-except
        application_variant_query_request = ApplicationVariantQueryRequest()

    return application_variant_query_request


def merge_application_variant_query_requests(
    query_request_params: Optional[ApplicationVariantQueryRequest] = None,
    query_request_body: Optional[ApplicationVariantQueryRequest] = None,
) -> ApplicationVariantQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return ApplicationVariantQueryRequest(
            application_variant=query_request_body.application_variant
            or query_request_params.application_variant,
            #
            application_refs=query_request_body.application_refs
            or query_request_params.application_refs,
            application_variant_refs=query_request_body.application_variant_refs
            or query_request_params.application_variant_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return ApplicationVariantQueryRequest()


# APPLICATION REVISION QUERY ---------------------------------------------------


def parse_application_revision_query_request_from_params(
    application_id: Optional[UUID] = Query(None),
    application_ids: Optional[List[UUID]] = Query(None),
    application_slug: Optional[str] = Query(None),
    application_slugs: Optional[List[str]] = Query(None),
    #
    application_variant_id: Optional[UUID] = Query(None),
    application_variant_ids: Optional[List[UUID]] = Query(None),
    application_variant_slug: Optional[str] = Query(None),
    application_variant_slugs: Optional[List[str]] = Query(None),
    #
    application_revision_id: Optional[UUID] = Query(None),
    application_revision_ids: Optional[List[UUID]] = Query(None),
    application_revision_slug: Optional[str] = Query(None),
    application_revision_slugs: Optional[List[str]] = Query(None),
    application_revision_version: Optional[str] = Query(None),
    application_revision_versions: Optional[List[str]] = Query(None),
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
) -> ApplicationRevisionQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    __flags = ApplicationQueryFlags(**_flags) if _flags else None

    application_revision = (
        ApplicationRevisionQuery(
            name=name,
            description=description,
            #
            flags=__flags,
            meta=_meta,
            tags=_tags,
        )
        if name or description or __flags or _meta or _tags
        else None
    )

    application_refs = (
        [
            Reference(
                id=application_id,
                slug=application_slug,
            )
        ]
        if application_id or application_slug
        else []
    ) + (
        [
            Reference(
                id=application_id,
                slug=application_slug,
            )
            for application_id, application_slug in zip(
                application_ids,
                application_slugs,
            )
        ]
        if application_ids and application_slugs
        else []
    )

    application_variant_refs = (
        [
            Reference(
                id=application_variant_id,
                slug=application_variant_slug,
            )
        ]
        if application_variant_id or application_variant_slug
        else []
    ) + (
        [
            Reference(
                id=application_variant_id,
                slug=application_variant_slug,
            )
            for application_variant_id, application_variant_slug in zip(
                application_variant_ids,
                application_variant_slugs,
            )
        ]
        if application_variant_ids and application_variant_slugs
        else []
    )

    application_revision_refs = (
        [
            Reference(
                id=application_revision_id,
                slug=application_revision_slug,
                version=application_revision_version,
            )
        ]
        if application_revision_id
        or application_revision_slug
        or application_revision_version
        else []
    ) + (
        [
            Reference(
                id=application_revision_id,
                slug=application_revision_slug,
                version=application_revision_version,
            )
            for application_revision_id, application_revision_slug, application_revision_version in zip(
                application_revision_ids,
                application_revision_slugs,
                application_revision_versions,
            )
        ]
        if application_revision_ids
        and application_revision_slugs
        and application_revision_versions
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

    return parse_application_revision_query_request_from_body(
        application_revision=application_revision,
        #
        application_refs=application_refs,
        application_variant_refs=application_variant_refs,
        application_revision_refs=application_revision_refs,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_application_revision_query_request_from_body(
    application_revision: Optional[ApplicationRevisionQuery] = None,
    #
    application_refs: Optional[List[Reference]] = None,
    application_variant_refs: Optional[List[Reference]] = None,
    application_revision_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> ApplicationRevisionQueryRequest:
    application_revision_query_request = None

    try:
        application_revision_query_request = ApplicationRevisionQueryRequest(
            application_revision=application_revision,
            #
            application_refs=application_refs,
            application_variant_refs=application_variant_refs,
            application_revision_refs=application_revision_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

    except Exception as e:  # pylint: disable=broad-except
        log.warn(e)

        application_revision_query_request = ApplicationRevisionQueryRequest()

    return application_revision_query_request


def merge_application_revision_query_requests(
    query_request_params: Optional[ApplicationRevisionQueryRequest] = None,
    query_request_body: Optional[ApplicationRevisionQueryRequest] = None,
) -> ApplicationRevisionQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return ApplicationRevisionQueryRequest(
            application_revision=query_request_body.application_revision
            or query_request_params.application_revision,
            #
            application_refs=query_request_body.application_refs
            or query_request_params.application_refs,
            application_variant_refs=query_request_body.application_variant_refs
            or query_request_params.application_variant_refs,
            application_revision_refs=query_request_body.application_revision_refs
            or query_request_params.application_revision_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return ApplicationRevisionQueryRequest()


# APPLICATION REVISION RETRIEVE ------------------------------------------------


def parse_application_revision_retrieve_request_from_params(
    application_id: Optional[UUID] = Query(None),
    application_slug: Optional[str] = Query(None),
    #
    application_variant_id: Optional[UUID] = Query(None),
    application_variant_slug: Optional[str] = Query(None),
    #
    application_revision_id: Optional[UUID] = Query(None),
    application_revision_slug: Optional[str] = Query(None),
    application_revision_version: Optional[str] = Query(None),
):
    application_ref = (
        Reference(
            id=application_id,
            slug=application_slug,
        )
        if application_id or application_slug
        else None
    )

    application_variant_ref = (
        Reference(
            id=application_variant_id,
            slug=application_variant_slug,
        )
        if application_variant_id or application_variant_slug
        else None
    )

    application_revision_ref = (
        Reference(
            id=application_revision_id,
            slug=application_revision_slug,
            version=application_revision_version,
        )
        if application_revision_id
        or application_revision_slug
        or application_revision_version
        else None
    )

    return parse_application_revision_retrieve_request_from_body(
        application_ref=application_ref,
        application_variant_ref=application_variant_ref,
        application_revision_ref=application_revision_ref,
    )


def parse_application_revision_retrieve_request_from_body(
    application_ref: Optional[Reference] = None,
    application_variant_ref: Optional[Reference] = None,
    application_revision_ref: Optional[Reference] = None,
) -> ApplicationRevisionRetrieveRequest:
    return ApplicationRevisionRetrieveRequest(
        application_ref=application_ref,
        application_variant_ref=application_variant_ref,
        application_revision_ref=application_revision_ref,
    )
