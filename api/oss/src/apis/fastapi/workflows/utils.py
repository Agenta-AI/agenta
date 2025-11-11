from typing import Optional
from json import loads

from fastapi import Query

from oss.src.utils.logging import get_module_logger
from oss.src.core.shared.dtos import Reference, Tags
from oss.src.core.workflows.dtos import WorkflowFlags, WorkflowQuery


log = get_module_logger(__name__)


def parse_workflow_query_request(
    workflow_ref: Optional[str] = Query(
        None,
        description='JSON string of ref, e.g. {"key": value}',
    ),
    workflow_flags: Optional[str] = Query(
        None, description='JSON string of flags, e.g. {"key": value}'
    ),
    workflow_meta: Optional[str] = Query(
        None, description='JSON string of meta, e.g. {"key": value}'
    ),
    include_archived: Optional[bool] = Query(None),
) -> WorkflowQuery:
    if workflow_ref:
        try:
            workflow_ref = Reference(**loads(workflow_ref))
        except Exception:  # pylint: disable=broad-except
            workflow_ref = None

            log.error("Failed to parse workflow_ref (%s)", workflow_ref)

    if workflow_flags:
        try:
            workflow_flags = WorkflowFlags(**loads(workflow_flags))
        except Exception:  # pylint: disable=broad-except
            workflow_flags = None

            log.error("Failed to parse workflow_flags (%s)", workflow_flags)

    if workflow_meta:
        try:
            workflow_meta = loads(workflow_meta)
        except Exception:  # pylint: disable=broad-except
            workflow_meta = None

            log.error(f"Failed to parse workflow_meta ({workflow_meta})")

    return parse_workflow_body_request(
        workflow_ref=workflow_ref,
        #
        workflow_flags=workflow_flags,
        workflow_meta=workflow_meta,
        #
        include_archived=include_archived,
    )


def parse_workflow_body_request(
    workflow_ref: Optional[Reference] = None,
    #
    workflow_flags: Optional[WorkflowFlags] = None,
    workflow_meta: Optional[Tags] = None,
    #
    include_archived: Optional[bool] = None,
) -> WorkflowQuery:
    _query = None

    try:
        _query = WorkflowQuery(
            workflow_ref=workflow_ref,
            #
            flags=workflow_flags,
            meta=workflow_meta,
            #
            include_archived=include_archived,
        )
    except Exception as e:  # pylint: disable=broad-except
        log.warn("Error parsing workflow body request: %s", e)

        _query = None

    return _query


def parse_variant_query_request(
    workflow_ref: Optional[str] = Query(
        None,
        description='JSON string of reference, e.g. {"key": value}',
    ),
    variant_ref: Optional[str] = Query(
        None,
        description='JSON string of reference, e.g. {"key": value}',
    ),
    variant_meta: Optional[str] = Query(
        None, description='JSON string of meta, e.g. {"key": value}'
    ),
    variant_flags: Optional[str] = Query(
        None, description='JSON string of flags, e.g. {"key": value}'
    ),
    include_archived: Optional[bool] = Query(None),
) -> WorkflowQuery:
    if workflow_ref:
        try:
            workflow_ref = Reference(**loads(workflow_ref))
        except Exception:  # pylint: disable=broad-except
            workflow_ref = None

            log.error("Failed to parse workflow_ref (%s)", workflow_ref)

    if variant_ref:
        try:
            variant_ref = Reference(**loads(variant_ref))
        except Exception:  # pylint: disable=broad-except
            variant_ref = None

            log.error("Failed to parse variant_ref (%s)", variant_ref)

    if variant_flags:
        try:
            variant_flags = WorkflowFlags(**loads(variant_flags))
        except Exception:  # pylint: disable=broad-except
            variant_flags = None

            log.error("Failed to parse variant_flags (%s)", variant_flags)

    if variant_meta:
        try:
            variant_meta = loads(variant_meta)
        except Exception:  # pylint: disable=broad-except
            variant_meta = None

            log.error(f"Failed to parse variant_meta ({variant_meta})")

    return parse_variant_body_request(
        workflow_ref=workflow_ref,
        variant_ref=variant_ref,
        #
        variant_flags=variant_flags,
        variant_meta=variant_meta,
        #
        include_archived=include_archived,
    )


def parse_variant_body_request(
    workflow_ref: Optional[Reference] = None,
    variant_ref: Optional[Reference] = None,
    #
    variant_flags: Optional[WorkflowFlags] = None,
    variant_meta: Optional[Tags] = None,
    #
    include_archived: Optional[bool] = None,
) -> WorkflowQuery:
    _query = None

    try:
        _query = WorkflowQuery(
            artifact_ref=workflow_ref,
            variant_ref=variant_ref,
            #
            flags=variant_flags,
            meta=variant_meta,
            #
            include_archived=include_archived,
        )
    except Exception as e:  # pylint: disable=broad-except
        log.warn("Error parsing variant body request: %s", e)

        _query = None

    return _query


def parse_revision_query_request(
    variant_ref: Optional[str] = Query(
        None,
        description='JSON string of ref, e.g. {"key": value}',
    ),
    revision_ref: Optional[str] = Query(
        None,
        description='JSON string of ref, e.g. {"key": value}',
    ),
    revision_meta: Optional[str] = Query(
        None, description='JSON string of meta, e.g. {"key": value}'
    ),
    revision_flags: Optional[str] = Query(
        None, description='JSON string of flags, e.g. {"key": value}'
    ),
    include_archived: Optional[bool] = Query(None),
) -> WorkflowQuery:
    if variant_ref:
        try:
            variant_ref = Reference(**loads(variant_ref))
        except Exception:  # pylint: disable=broad-except
            variant_ref = None

            log.error("Failed to parse variant_ref (%s)", variant_ref)

    if revision_ref:
        try:
            revision_ref = Reference(**loads(revision_ref))
        except Exception:  # pylint: disable=broad-except
            revision_ref = None

            log.error("Failed to parse revision_ref (%s)", revision_ref)

    if revision_flags:
        try:
            revision_flags = WorkflowFlags(**loads(revision_flags))
        except Exception:  # pylint: disable=broad-except
            revision_flags = None

            log.error("Failed to parse revision_flags (%s)", revision_flags)

    if revision_meta:
        try:
            revision_meta = loads(revision_meta)
        except Exception:  # pylint: disable=broad-except
            revision_meta = None

            log.error(f"Failed to parse revision_meta ({revision_meta})")

    return parse_revision_body_request(
        variant_ref=variant_ref,
        revision_ref=revision_ref,
        #
        revision_flags=revision_flags,
        revision_meta=revision_meta,
        #
        include_archived=include_archived,
    )


def parse_revision_body_request(
    variant_ref: Optional[Reference] = None,
    revision_ref: Optional[Reference] = None,
    #
    revision_flags: Optional[WorkflowFlags] = None,
    revision_meta: Optional[Tags] = None,
    #
    include_archived: Optional[bool] = None,
) -> WorkflowQuery:
    _query = None

    try:
        _query = WorkflowQuery(
            variant_ref=variant_ref,
            revision_ref=revision_ref,
            #
            flags=revision_flags,
            meta=revision_meta,
            #
            include_archived=include_archived,
        )
    except Exception as e:  # pylint: disable=broad-except
        log.warn(e)

        _query = None

    return _query


def merge_requests(
    query_param: Optional[WorkflowQuery] = None,
    query_body: Optional[WorkflowQuery] = None,
) -> WorkflowQuery:
    if query_body is None:
        return query_param

    if query_param is None:
        return query_body

    return WorkflowQuery(
        artifact_ref=query_body.artifact_ref or query_param.artifact_ref,
        variant_ref=query_body.variant_ref or query_param.variant_ref,
        revision_ref=query_body.revision_ref or query_param.revision_ref,
        #
        flags=query_body.flags or query_param.flags,
        meta=query_body.meta or query_param.meta,
        #
        include_archived=query_body.include_archived or query_param.include_archived,
    )
