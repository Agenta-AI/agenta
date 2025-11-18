from typing import Callable, Dict, Optional, Any
from uuid import uuid4, UUID

from definitions import (
    Status,
    WorkflowServiceData,
    ApplicationRevision,
    ApplicationServiceRequest,
    ApplicationServiceResponse,
    EvaluatorRevision,
    EvaluatorServiceRequest,
    EvaluatorServiceResponse,
    SuccessStatus,
    HandlerNotFoundStatus,
    ErrorStatus,
    RevisionDataNotFoundStatus,
    RequestDataNotFoundStatus,
    Link,
)

from client import authed_api


client = authed_api()


REGISTRY: Dict[str, Dict[str, Dict[str, Dict[str, Callable]]]] = dict(
    user=dict(
        custom=dict(),
    ),
)


def register_handler(fn: Callable) -> str:
    global REGISTRY

    key = f"{fn.__module__}.{fn.__name__}"

    if not REGISTRY["user"]["custom"].get(key):
        REGISTRY["user"]["custom"][key] = dict()

    REGISTRY["user"]["custom"][key]["latest"] = fn

    uri = f"user:custom:{key}:latest"

    return uri


def retrieve_handler(uri: Optional[str] = None) -> Optional[Callable]:
    if not uri:
        return None

    parts = uri.split(":")

    return REGISTRY[parts[0]][parts[1]].get(parts[2], {}).get(parts[3], None)


async def invoke_application(
    *,
    request: ApplicationServiceRequest,
    revision: ApplicationRevision,
) -> ApplicationServiceResponse:
    try:
        if not revision.data:
            return ApplicationServiceResponse(
                status=RevisionDataNotFoundStatus(),
            )

        if not request.data:
            return ApplicationServiceResponse(
                status=RequestDataNotFoundStatus(),
            )

        handler = retrieve_handler(revision.data.uri)

        if not handler:
            return ApplicationServiceResponse(
                status=HandlerNotFoundStatus(
                    uri=revision.data.uri,
                ),
            )

        outputs = await handler(
            revision=revision,
            request=request,
            #
            parameters=revision.data.parameters,
            inputs=request.data.inputs,
            #
            trace_parameters=request.data.trace_parameters,
            trace_inputs=request.data.trace_inputs,
            trace_outputs=request.data.trace_outputs,
            #
            trace=request.data.trace,
            tree=request.data.tree,
        )

        data = dict(
            parameters=revision.data.parameters,
            inputs=request.data.inputs,
            outputs=outputs,
        )

        references = (
            {
                k: ref.model_dump(
                    mode="json",
                )
                for k, ref in request.references.items()
            }
            if request.references
            else None
        )

        links = (
            {
                k: ref.model_dump(
                    mode="json",
                )
                for k, ref in request.links.items()
            }
            if request.links
            else None
        )

        link = None

        try:
            link = await _invocations_create(
                tags=request.tags,
                meta=request.meta,
                #
                data=data,
                #
                references=references,
                links=links,
            )
        except Exception as ex:
            print(ex)

        response = ApplicationServiceResponse(
            status=SuccessStatus(message=""),
            data=WorkflowServiceData(
                outputs=outputs,
            ),
            trace_id=link.trace_id if link else None,
            links=({revision.slug or uuid4().hex: link} if link else {}),
        )

        return response

    except ErrorStatus as error:
        return ApplicationServiceResponse(
            status=Status(
                code=error.code,
                type=error.type,
                message=error.message,
                stacktrace=error.stacktrace,
            ),
        )

    except Exception as ex:
        return ApplicationServiceResponse(
            status=Status(
                code=500,
                message=str(ex),
            ),
        )


async def invoke_evaluator(
    *,
    request: EvaluatorServiceRequest,
    revision: EvaluatorRevision,
) -> EvaluatorServiceResponse:
    try:
        if not revision.data:
            return EvaluatorServiceResponse(
                status=RevisionDataNotFoundStatus(),
            )

        if not request.data:
            return EvaluatorServiceResponse(
                status=RequestDataNotFoundStatus(),
            )

        handler = retrieve_handler(revision.data.uri)

        if not handler:
            return EvaluatorServiceResponse(
                status=HandlerNotFoundStatus(
                    uri=revision.data.uri,
                ),
            )

        outputs = await handler(
            revision=revision,
            request=request,
            #
            parameters=revision.data.parameters,
            inputs=request.data.inputs,
            #
            trace_parameters=request.data.trace_parameters,
            trace_inputs=request.data.trace_inputs,
            trace_outputs=request.data.trace_outputs,
            #
            trace=request.data.trace,
            tree=request.data.tree,
        )

        data = dict(
            parameters=revision.data.parameters,
            inputs=request.data.inputs,
            outputs=outputs,
        )

        references = (
            {
                k: ref.model_dump(
                    mode="json",
                )
                for k, ref in request.references.items()
            }
            if request.references
            else None
        )

        links = (
            {
                k: ref.model_dump(
                    mode="json",
                )
                for k, ref in request.links.items()
            }
            if request.links
            else None
        )

        link = None

        try:
            link = await _annotations_create(
                tags=request.tags,
                meta=request.meta,
                #
                data=data,
                #
                references=references,
                links=links,
            )
        except Exception as ex:
            print(ex)

        response = EvaluatorServiceResponse(
            status=SuccessStatus(message=""),
            data=WorkflowServiceData(
                outputs=outputs,
            ),
            trace_id=link.trace_id if link else None,
            links=({revision.slug or uuid4().hex: link} if link else {}),
        )

        return response

    except ErrorStatus as error:
        return EvaluatorServiceResponse(
            status=Status(
                code=error.code,
                type=error.type,
                message=error.message,
                stacktrace=error.stacktrace,
            ),
        )

    except Exception as ex:
        return EvaluatorServiceResponse(
            status=Status(
                code=500,
                message=str(ex),
            ),
        )


async def _invocations_create(
    tags: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
    data: Optional[Dict[str, Any]] = None,
    references: Optional[Dict[str, Any]] = None,
    links: Optional[Dict[str, Any]] = None,
) -> Optional[Link]:
    response = client(
        method="POST",
        endpoint=f"/preview/invocations/",
        json=dict(
            invocation=dict(
                origin="custom",
                kind="eval",
                channel="api",
                data=data,
                tags=tags,
                meta=meta,
                references=references,
                links=links,
            )
        ),
    )

    try:
        response.raise_for_status()
    except:
        print(response.text)
        raise

    response = response.json()

    trace_id = response.get("invocation", {}).get("trace_id", None)
    span_id = response.get("invocation", {}).get("span_id", None)

    link = (
        Link(
            trace_id=trace_id,
            span_id=span_id,
        )
        if trace_id and span_id
        else None
    )

    return link


async def _annotations_create(
    tags: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
    data: Optional[Dict[str, Any]] = None,
    references: Optional[Dict[str, Any]] = None,
    links: Optional[Dict[str, Any]] = None,
) -> Optional[Link]:
    response = client(
        method="POST",
        endpoint=f"/preview/annotations/",
        json=dict(
            annotation=dict(
                origin="custom",
                kind="eval",
                channel="api",
                data=data,
                tags=tags,
                meta=meta,
                references=references,
                links=links,
            )
        ),
    )

    try:
        response.raise_for_status()
    except:
        print(response.text)
        raise

    response = response.json()

    trace_id = response.get("annotation", {}).get("trace_id", None)
    span_id = response.get("annotation", {}).get("span_id", None)

    link = (
        Link(
            trace_id=trace_id,
            span_id=span_id,
        )
        if trace_id and span_id
        else None
    )

    return link
