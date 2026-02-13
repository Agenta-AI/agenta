from typing import Optional, Literal, List
from uuid import UUID
from datetime import datetime

from fastapi import Query

from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import (
    Windowing,
    Reference,
)
from oss.src.core.evaluators.dtos import (
    EvaluatorQueryFlags,
    #
    EvaluatorQuery,
    EvaluatorVariantQuery,
    EvaluatorRevisionQuery,
)

from oss.src.apis.fastapi.shared.utils import (
    parse_metadata,
)
from oss.src.apis.fastapi.evaluators.models import (
    EvaluatorQueryRequest,
    EvaluatorVariantQueryRequest,
    EvaluatorRevisionQueryRequest,
    EvaluatorRevisionRetrieveRequest,
)


log = get_module_logger(__name__)


def parse_evaluator_query_request_from_params(
    evaluator_id: Optional[UUID] = Query(None),
    evaluator_ids: Optional[List[UUID]] = Query(None),
    evaluator_slug: Optional[str] = Query(None),
    evaluator_slugs: Optional[List[str]] = Query(None),
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
) -> EvaluatorQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    __flags = EvaluatorQueryFlags(**_flags) if _flags else None

    evaluator = (
        EvaluatorQuery(
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

    evaluator_refs = (
        (
            [
                Reference(
                    id=evaluator_id,
                    slug=evaluator_slug,
                )
            ]
            if evaluator_id or evaluator_slug
            else []
        )
        + (
            [
                Reference(
                    id=evaluator_id,
                    slug=evaluator_slug,
                )
                for evaluator_id, evaluator_slug in zip(
                    evaluator_ids,
                    evaluator_slugs,
                )
            ]
            if evaluator_ids and evaluator_slugs
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

    return parse_evaluator_query_request_from_body(
        evaluator=evaluator,
        #
        evaluator_refs=evaluator_refs,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_evaluator_query_request_from_body(
    evaluator: Optional[EvaluatorQuery] = None,
    #
    evaluator_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> EvaluatorQueryRequest:
    evaluator_query_request = None

    try:
        evaluator_query_request = EvaluatorQueryRequest(
            evaluator=evaluator,
            #
            evaluator_refs=evaluator_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )
    except Exception:  # pylint: disable=broad-except
        evaluator_query_request = EvaluatorQueryRequest()

    return evaluator_query_request


def merge_evaluator_query_requests(
    query_request_params: Optional[EvaluatorQueryRequest] = None,
    query_request_body: Optional[EvaluatorQueryRequest] = None,
) -> EvaluatorQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return EvaluatorQueryRequest(
            evaluator=query_request_body.evaluator or query_request_params.evaluator,
            #
            evaluator_refs=query_request_body.evaluator_refs
            or query_request_params.evaluator_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return EvaluatorQueryRequest()


def parse_evaluator_variant_query_request_from_params(
    evaluator_id: Optional[UUID] = Query(None),
    evaluator_ids: Optional[List[UUID]] = Query(None),
    evaluator_slug: Optional[str] = Query(None),
    evaluator_slugs: Optional[List[str]] = Query(None),
    #
    evaluator_variant_id: Optional[UUID] = Query(None),
    evaluator_variant_ids: Optional[List[UUID]] = Query(None),
    evaluator_variant_slug: Optional[str] = Query(None),
    evaluator_variant_slugs: Optional[List[str]] = Query(None),
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
) -> EvaluatorVariantQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    __flags = EvaluatorQueryFlags(**_flags) if _flags else None

    evaluator_variant = (
        EvaluatorVariantQuery(
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

    evaluator_refs = (
        (
            [
                Reference(
                    id=evaluator_id,
                    slug=evaluator_slug,
                )
            ]
            if evaluator_id or evaluator_slug
            else []
        )
        + (
            [
                Reference(
                    id=evaluator_id,
                    slug=evaluator_slug,
                )
                for evaluator_id, evaluator_slug in zip(
                    evaluator_ids,
                    evaluator_slugs,
                )
            ]
            if evaluator_ids and evaluator_slugs
            else []
        )
    ) or None

    evaluator_variant_refs = (
        (
            [
                Reference(
                    id=evaluator_variant_id,
                    slug=evaluator_variant_slug,
                )
            ]
            if evaluator_variant_id or evaluator_variant_slug
            else []
        )
        + (
            [
                Reference(
                    id=evaluator_variant_id,
                    slug=evaluator_variant_slug,
                )
                for evaluator_variant_id, evaluator_variant_slug in zip(
                    evaluator_variant_ids,
                    evaluator_variant_slugs,
                )
            ]
            if evaluator_variant_ids and evaluator_variant_slugs
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

    return parse_evaluator_variant_query_request_from_body(
        evaluator_variant=evaluator_variant,
        #
        evaluator_refs=evaluator_refs or None,
        evaluator_variant_refs=evaluator_variant_refs or None,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_evaluator_variant_query_request_from_body(
    evaluator_variant: Optional[EvaluatorVariantQuery] = None,
    #
    evaluator_refs: Optional[List[Reference]] = None,
    evaluator_variant_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> EvaluatorVariantQueryRequest:
    evaluator_variant_query_request = None

    try:
        evaluator_variant_query_request = EvaluatorVariantQueryRequest(
            evaluator_variant=evaluator_variant,
            #
            evaluator_refs=evaluator_refs,
            evaluator_variant_refs=evaluator_variant_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )
    except Exception:  # pylint: disable=broad-except
        evaluator_variant_query_request = EvaluatorVariantQueryRequest()

    return evaluator_variant_query_request


def merge_evaluator_variant_query_requests(
    query_request_params: Optional[EvaluatorVariantQueryRequest] = None,
    query_request_body: Optional[EvaluatorVariantQueryRequest] = None,
) -> EvaluatorVariantQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return EvaluatorVariantQueryRequest(
            evaluator_variant=query_request_body.evaluator_variant
            or query_request_params.evaluator_variant,
            #
            evaluator_refs=query_request_body.evaluator_refs
            or query_request_params.evaluator_refs,
            evaluator_variant_refs=query_request_body.evaluator_variant_refs
            or query_request_params.evaluator_variant_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return EvaluatorVariantQueryRequest()


def parse_evaluator_revision_query_request_from_params(
    evaluator_id: Optional[UUID] = Query(None),
    evaluator_ids: Optional[List[UUID]] = Query(None),
    evaluator_slug: Optional[str] = Query(None),
    evaluator_slugs: Optional[List[str]] = Query(None),
    #
    evaluator_variant_id: Optional[UUID] = Query(None),
    evaluator_variant_ids: Optional[List[UUID]] = Query(None),
    evaluator_variant_slug: Optional[str] = Query(None),
    evaluator_variant_slugs: Optional[List[str]] = Query(None),
    #
    evaluator_revision_id: Optional[UUID] = Query(None),
    evaluator_revision_ids: Optional[List[UUID]] = Query(None),
    evaluator_revision_slug: Optional[str] = Query(None),
    evaluator_revision_slugs: Optional[List[str]] = Query(None),
    evaluator_revision_version: Optional[str] = Query(None),
    evaluator_revision_versions: Optional[List[str]] = Query(None),
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
) -> EvaluatorRevisionQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    __flags = EvaluatorQueryFlags(**_flags) if _flags else None

    evaluator_revision = (
        EvaluatorRevisionQuery(
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

    evaluator_refs = (
        [
            Reference(
                id=evaluator_id,
                slug=evaluator_slug,
            )
        ]
        if evaluator_id or evaluator_slug
        else []
    ) + (
        [
            Reference(
                id=evaluator_id,
                slug=evaluator_slug,
            )
            for evaluator_id, evaluator_slug in zip(
                evaluator_ids,
                evaluator_slugs,
            )
        ]
        if evaluator_ids and evaluator_slugs
        else []
    )

    evaluator_variant_refs = (
        [
            Reference(
                id=evaluator_variant_id,
                slug=evaluator_variant_slug,
            )
        ]
        if evaluator_variant_id or evaluator_variant_slug
        else []
    ) + (
        [
            Reference(
                id=evaluator_variant_id,
                slug=evaluator_variant_slug,
            )
            for evaluator_variant_id, evaluator_variant_slug in zip(
                evaluator_variant_ids,
                evaluator_variant_slugs,
            )
        ]
        if evaluator_variant_ids and evaluator_variant_slugs
        else []
    )

    evaluator_revision_refs = (
        [
            Reference(
                id=evaluator_revision_id,
                slug=evaluator_revision_slug,
                version=evaluator_revision_version,
            )
        ]
        if evaluator_revision_id
        or evaluator_revision_slug
        or evaluator_revision_version
        else []
    ) + (
        [
            Reference(
                id=evaluator_revision_id,
                slug=evaluator_revision_slug,
                version=evaluator_revision_version,
            )
            for evaluator_revision_id, evaluator_revision_slug, evaluator_revision_version in zip(
                evaluator_revision_ids,
                evaluator_revision_slugs,
                evaluator_revision_versions,
            )
        ]
        if evaluator_revision_ids
        and evaluator_revision_slugs
        and evaluator_revision_versions
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

    return parse_evaluator_revision_query_request_from_body(
        evaluator_revision=evaluator_revision,
        #
        evaluator_refs=evaluator_refs,
        evaluator_variant_refs=evaluator_variant_refs,
        evaluator_revision_refs=evaluator_revision_refs,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_evaluator_revision_query_request_from_body(
    evaluator_revision: Optional[EvaluatorRevisionQuery] = None,
    #
    evaluator_refs: Optional[List[Reference]] = None,
    evaluator_variant_refs: Optional[List[Reference]] = None,
    evaluator_revision_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> EvaluatorRevisionQueryRequest:
    evaluator_revision_query_request = None

    try:
        evaluator_revision_query_request = EvaluatorRevisionQueryRequest(
            evaluator_revision=evaluator_revision,
            #
            evaluator_refs=evaluator_refs,
            evaluator_variant_refs=evaluator_variant_refs,
            evaluator_revision_refs=evaluator_revision_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

    except Exception as e:  # pylint: disable=broad-except
        log.warn(e)

        evaluator_revision_query_request = EvaluatorRevisionQueryRequest()

    return evaluator_revision_query_request


def merge_evaluator_revision_query_requests(
    query_request_params: Optional[EvaluatorRevisionQueryRequest] = None,
    query_request_body: Optional[EvaluatorRevisionQueryRequest] = None,
) -> EvaluatorRevisionQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return EvaluatorRevisionQueryRequest(
            evaluator_revision=query_request_body.evaluator_revision
            or query_request_params.evaluator_revision,
            #
            evaluator_refs=query_request_body.evaluator_refs
            or query_request_params.evaluator_refs,
            evaluator_variant_refs=query_request_body.evaluator_variant_refs
            or query_request_params.evaluator_variant_refs,
            evaluator_revision_refs=query_request_body.evaluator_revision_refs
            or query_request_params.evaluator_revision_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return EvaluatorRevisionQueryRequest()


def parse_evaluator_revision_retrieve_request_from_params(
    evaluator_id: Optional[UUID] = Query(None),
    evaluator_slug: Optional[str] = Query(None),
    #
    evaluator_variant_id: Optional[UUID] = Query(None),
    evaluator_variant_slug: Optional[str] = Query(None),
    #
    evaluator_revision_id: Optional[UUID] = Query(None),
    evaluator_revision_slug: Optional[str] = Query(None),
    evaluator_revision_version: Optional[str] = Query(None),
):
    evaluator_ref = (
        Reference(
            id=evaluator_id,
            slug=evaluator_slug,
        )
        if evaluator_id or evaluator_slug
        else None
    )

    evaluator_variant_ref = (
        Reference(
            id=evaluator_variant_id,
            slug=evaluator_variant_slug,
        )
        if evaluator_variant_id or evaluator_variant_slug
        else None
    )

    evaluator_revision_ref = (
        Reference(
            id=evaluator_revision_id,
            slug=evaluator_revision_slug,
            version=evaluator_revision_version,
        )
        if evaluator_revision_id
        or evaluator_revision_slug
        or evaluator_revision_version
        else None
    )

    return parse_evaluator_revision_retrieve_request_from_body(
        evaluator_ref=evaluator_ref,
        evaluator_variant_ref=evaluator_variant_ref,
        evaluator_revision_ref=evaluator_revision_ref,
    )


def parse_evaluator_revision_retrieve_request_from_body(
    evaluator_ref: Optional[Reference] = None,
    evaluator_variant_ref: Optional[Reference] = None,
    evaluator_revision_ref: Optional[Reference] = None,
) -> EvaluatorRevisionRetrieveRequest:
    return EvaluatorRevisionRetrieveRequest(
        evaluator_ref=evaluator_ref,
        evaluator_variant_ref=evaluator_variant_ref,
        evaluator_revision_ref=evaluator_revision_ref,
    )
