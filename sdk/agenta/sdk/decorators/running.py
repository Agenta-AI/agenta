# /agenta/sdk/decorators/running.py

from typing import Any, Callable, Optional, Protocol, Union, Dict, cast
import httpx
from functools import update_wrapper, wraps
from inspect import signature
from uuid import UUID

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.models.workflows import (
    WorkflowRevision,
    WorkflowRevisionData,
    WorkflowRequestData,
    WorkflowInvokeRequest,
    WorkflowInspectRequest,
    WorkflowBatchResponse,
    WorkflowStreamingResponse,
    Reference,
    Link,
)
from agenta.sdk.contexts.running import RunningContext, running_context_manager
from agenta.sdk.contexts.tracing import TracingContext, tracing_context_manager
from agenta.sdk.middlewares.running.normalizer import (
    NormalizerMiddleware,
)
from agenta.sdk.middlewares.running.resolver import (
    ResolverMiddleware,
    resolve_revision,
    resolve_references,
    resolve_embeds,
    _has_embed_markers,
)
from agenta.sdk.middlewares.running.vault import (
    VaultMiddleware,
)
from agenta.sdk.decorators.tracing import auto_instrument
from agenta.sdk.engines.running.utils import (
    register_handler,
    retrieve_handler,
    retrieve_interface,
    retrieve_configuration,
    is_custom_uri,
)

import agenta as ag


log = get_module_logger(__name__)


class InvokeFn(Protocol):
    async def __call__(
        self,
        request: Union[WorkflowInvokeRequest, dict],
    ) -> Union[WorkflowBatchResponse, WorkflowStreamingResponse]: ...


class InspectFn(Protocol):
    async def __call__(self) -> WorkflowInvokeRequest: ...


class Workflow:
    def __init__(self, fn: Callable[..., Any]):
        self._fn = fn

        update_wrapper(self, fn)

        # self.invoke: InvokeFn
        # self.inspect: InspectFn
        self.workflow: workflow

    async def invoke(
        self,
        *,
        request: Union[WorkflowInvokeRequest, dict],
        #
        secrets: Optional[list] = None,
        credentials: Optional[str] = None,
        #
        **kwargs,
    ) -> Union[WorkflowBatchResponse, WorkflowStreamingResponse]: ...

    async def inspect(
        self,
        *,
        credentials: Optional[str] = None,
        #
        **kwargs,
    ) -> WorkflowInvokeRequest: ...

    def __call__(self, *args, **kwargs) -> Any:
        return self._fn(*args, **kwargs)

    def __repr__(self) -> str:
        return repr(self._fn)

    def __str__(self) -> str:
        return str(self._fn)


class workflow:
    def __init__(
        self,
        *,
        # -------------------------------------------------------------------- #
        id: Optional[UUID] = None,
        slug: Optional[str] = None,
        version: Optional[str] = None,
        # -------------------------------------------------------------------- #
        references: Optional[Dict[str, Union[Reference, Dict[str, Any]]]] = None,
        links: Optional[Dict[str, Union[Link, Dict[str, Any]]]] = None,
        #
        selector: Optional[Any] = None,
        # -------------------------------------------------------------------- #
        name: Optional[str] = None,
        description: Optional[str] = None,
        # -------------------------------------------------------------------- #
        flags: Optional[dict] = None,
        tags: Optional[dict] = None,
        meta: Optional[dict] = None,
        # -------------------------------------------------------------------- #
        uri: Optional[str] = None,
        url: Optional[str] = None,
        headers: Optional[dict] = None,
        schemas: Optional[dict] = None,
        #
        runtime: Optional[str] = None,
        script: Optional[str] = None,
        parameters: Optional[dict] = None,
        #
        revision: Optional[dict] = None,
        # -------------------------------------------------------------------- #
        **kwargs,
    ):
        # -------------------------------------------------------------------- #
        self.id = id
        self.slug = slug
        self.version = version
        # -------------------------------------------------------------------- #
        self.references = references
        self.links = links
        #
        self.selector = selector
        # -------------------------------------------------------------------- #
        self.name = name
        self.description = description
        # -------------------------------------------------------------------- #
        self.flags = flags
        self.tags = tags
        self.meta = meta
        # -------------------------------------------------------------------- #
        # revision= always carries revision-shaped data (may be incomplete):
        # {"data": {"uri": ..., "parameters": ...}, "id": ..., "slug": ...}
        # Extract the data subkey; fall back to treating the whole dict as data.
        if isinstance(revision, dict):
            _rev_data = revision.get("data") if "data" in revision else revision
            _data = WorkflowRevisionData(**_rev_data) if _rev_data else None
        elif isinstance(revision, WorkflowRevisionData):
            _data = revision
        else:
            _data = None
        _data = _data or WorkflowRevisionData(
            uri=uri,
            url=url,
            headers=headers,
            schemas=schemas,
            runtime=runtime,
            script=script,
            parameters=parameters,
        )
        # self.revision is WorkflowRevision — identity fields come from outer revision dict
        # or from explicit id/slug/version kwargs.
        _rev_id = id or (revision.get("id") if isinstance(revision, dict) else None)
        _rev_slug = slug or (
            revision.get("slug") if isinstance(revision, dict) else None
        )
        _rev_version = version or (
            revision.get("version") if isinstance(revision, dict) else None
        )
        self.revision = WorkflowRevision(
            id=_rev_id,
            slug=_rev_slug,
            version=_rev_version,
            data=_data,
        )
        # -------------------------------------------------------------------- #
        self.parameters = _data.parameters
        # -------------------------------------------------------------------- #
        self.kwargs = kwargs
        # -------------------------------------------------------------------- #

        self.handler = None

        self.middlewares = [
            VaultMiddleware(),
            ResolverMiddleware(),
            NormalizerMiddleware(),
        ]

        self.default_request = None

        self.uri = _data.uri

        if self.uri is not None:
            self._retrieve_handler(self.uri)

            if self.handler:
                registered = retrieve_interface(self.uri)
                if registered:
                    # merge registered interface into revision data, keeping caller overrides
                    merged = registered.model_dump(exclude_none=True)
                    merged.update(self.revision.data.model_dump(exclude_none=True))
                    self.revision.data = WorkflowRevisionData(**merged)
                    self.uri = self.revision.data.uri

                registered_config = retrieve_configuration(self.uri)
                if registered_config and not self.revision.data.parameters:
                    self.revision.data.parameters = registered_config.parameters

                self.parameters = self.revision.data.parameters

        if is_custom_uri(self.uri):
            self.flags = self.flags or dict()
            self.flags["is_custom"] = True

    def __call__(self, handler: Optional[Callable[..., Any]] = None) -> Workflow:
        if self.handler is None and handler is not None:
            self._register_handler(
                handler,
                uri=self.uri,
            )

        if self.handler is not None:
            self._extend_handler()

            if is_custom_uri(self.uri):
                self.flags = self.flags or dict()
                self.flags["is_custom"] = True

            return self.handler

        raise NotImplementedError("workflow without handler is not implemented yet")

    def _register_handler(
        self,
        handler: Optional[Callable[..., Any]] = None,
        uri: Optional[str] = None,
    ):
        """Register a handler function with the workflow system.

        Takes a callable handler, instruments it for observability, and registers it
        in the global handler registry with a URI. Also initializes or updates the
        workflow's interface with the URI and schemas.

        Args:
            handler: The callable function to register as the workflow handler
            uri: Optional URI to use for registration; if None, one will be generated
        """
        if handler is not None and callable(handler):
            instrumented = auto_instrument(handler)
            uri = register_handler(instrumented, uri=uri)
            if self.revision is None:
                self.revision = WorkflowRevision(data=WorkflowRevisionData())
            if self.revision.data is None:
                self.revision.data = WorkflowRevisionData()
            self.uri = uri
            self.revision.data.uri = uri
            # schemas already populated from __init__ into self.revision.data.schemas
            self.handler = instrumented

    def _retrieve_handler(self, uri: str):
        self.handler = retrieve_handler(uri)
        if self.handler is None:
            raise ValueError(f"Unable to retrieve handler for URI: {uri}")
        if self.revision is None:
            self.revision = WorkflowRevision(data=WorkflowRevisionData())
        if self.revision.data is None:
            self.revision.data = WorkflowRevisionData()
        self.uri = uri
        self.revision.data.uri = uri
        # schemas already populated from __init__ into self.revision.data.schemas

    def _extend_handler(self):
        """Extend the registered handler with additional workflow capabilities.

        Wraps the handler function to:
        1. Automatically inject workflow parameters if the handler expects them
        2. Expose workflow-specific methods (invoke, inspect) on the handler
        3. Mark the handler with is_workflow flag for identification
        4. Wrap everything in a Workflow object for consistent interface

        This transforms a plain function into a full-featured workflow that can be
        invoked programmatically via .invoke() or inspected via .inspect().

        Raises:
            RuntimeError: If no handler has been registered yet
            ValueError: If handler becomes None during extension (should never happen)
        """
        if self.handler is None:
            raise RuntimeError("No handler registered")

        func = self.handler

        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any):
            if "parameters" in signature(func).parameters:
                return func(
                    *args,
                    **{**{"parameters": self.parameters}, **kwargs},
                )
            else:
                return func(*args, **kwargs)

        # expose workflow extras
        wrapper.invoke = self.invoke  # type: ignore[attr-defined]
        wrapper.inspect = self.inspect  # type: ignore[attr-defined]
        wrapper.is_workflow = True  # type: ignore[attr-defined]
        wrapper.__agenta_workflow__ = self  # type: ignore[attr-defined]

        if self.handler is None:
            raise ValueError("handler must be set before extending")

        self.handler = Workflow(wrapper)

    async def invoke(
        self,
        *,
        request: WorkflowInvokeRequest,
        #
        secrets: Optional[list] = None,
        credentials: Optional[str] = None,
        #
        **kwargs,
    ) -> Union[WorkflowBatchResponse, WorkflowStreamingResponse]:
        _flags = {**(self.flags or {}), **(request.flags or {})}
        _tags = {**(self.tags or {}), **(request.tags or {})}
        _meta = {**(self.meta or {}), **(request.meta or {})}

        credentials = (
            credentials
            or request.credentials
            or (
                f"ApiKey {ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_key}"
                if ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_key
                else None
            )
        )

        with tracing_context_manager(TracingContext.get()):
            tracing_ctx = TracingContext.get()

            tracing_ctx.credentials = credentials

            tracing_ctx.flags = _flags
            tracing_ctx.tags = _tags
            tracing_ctx.meta = _meta

            tracing_ctx.references = self.references
            tracing_ctx.links = self.links

            with running_context_manager(RunningContext.get()):
                running_ctx = RunningContext.get()

                running_ctx.secrets = secrets
                running_ctx.credentials = credentials

                running_ctx.revision = (
                    self.revision.model_dump(mode="json", exclude_none=True)
                    if self.revision
                    else None
                )
                running_ctx.schemas = (
                    self.revision.data.schemas
                    if self.revision and self.revision.data
                    else None
                )
                running_ctx.parameters = self.parameters

                async def terminal(req: WorkflowInvokeRequest):
                    return None

                call_next = terminal

                for mw in reversed(self.middlewares):
                    prev_next = call_next

                    async def make_call(mw, prev_next):
                        async def _call(
                            req: WorkflowInvokeRequest,
                        ):
                            return await mw(req, prev_next)

                        return _call

                    call_next = await make_call(mw, prev_next)

                return await call_next(request)

    async def inspect(
        self,
        *,
        credentials: Optional[str] = None,
        #
        **kwargs,
    ) -> WorkflowInvokeRequest:
        with tracing_context_manager(TracingContext.get()):
            tracing_ctx = TracingContext.get()

            tracing_ctx.credentials = credentials

            tracing_ctx.references = self.references
            tracing_ctx.links = self.links

            with running_context_manager(RunningContext.get()):
                running_ctx = RunningContext.get()

                running_ctx.credentials = credentials
                running_ctx.revision = (
                    self.revision.model_dump(mode="json", exclude_none=True)
                    if self.revision
                    else None
                )
                running_ctx.parameters = self.parameters

                if self.default_request is None:
                    self.default_request = WorkflowInvokeRequest(
                        #
                        references=self.references,
                        links=self.links,
                        #
                        selector=self.selector,
                        #
                        flags=self.flags,
                        tags=self.tags,
                        meta=self.meta,
                        #
                        data=WorkflowRequestData(
                            revision=WorkflowRevision(
                                id=self.id,
                                slug=self.slug,
                                version=self.version,
                                #
                                name=self.name,
                                description=self.description,
                                #
                                data=self.revision.data,
                            ).model_dump(
                                mode="json",
                                exclude_none=True,
                            ),
                        ),
                    )

                request = self.default_request.model_copy(deep=True)
                revision = await resolve_revision(
                    request=request,
                    revision=(
                        self.revision.data
                        if (
                            self.revision
                            and self.revision.data
                            and self.revision.data.model_dump(exclude_none=True)
                        )
                        else None
                    ),
                )

                if revision is None and request.references:
                    revision = await resolve_references(
                        request=request,
                        credentials=credentials,
                    )

                resolve_flag = (request.flags or {}).get("resolve", True)
                if (
                    resolve_flag
                    and revision
                    and revision.parameters
                    and _has_embed_markers(revision.parameters)
                ):
                    revision.parameters = await resolve_embeds(
                        parameters=revision.parameters,
                        credentials=credentials,
                    )

                if revision:
                    request.data = request.data or WorkflowRequestData()
                    request.data.revision = WorkflowRevision(
                        id=self.id,
                        slug=self.slug,
                        version=self.version,
                        #
                        name=self.name,
                        description=self.description,
                        #
                        data=revision,
                    ).model_dump(
                        mode="json",
                        exclude_none=True,
                    )

                return request


def is_workflow(obj: Any) -> bool:
    return getattr(obj, "is_workflow", False) or isinstance(
        getattr(obj, "workflow", None), workflow
    )


def auto_workflow(obj: Any, **kwargs) -> Workflow:
    flags = kwargs.get("flags")

    def _merge_flags(
        existing: Optional[dict], incoming: Optional[dict]
    ) -> Optional[dict]:
        if incoming is None:
            return existing
        merged = dict(existing or {})
        merged.update(incoming)
        return merged

    def _apply_flags_to_existing_workflow(
        target: Any, incoming_flags: Optional[dict]
    ) -> None:
        if not incoming_flags:
            return

        # Common case: object exposes the underlying workflow decorator instance.
        try:
            wf = getattr(target, "workflow", None)
            if isinstance(wf, workflow):
                wf.flags = _merge_flags(wf.flags, incoming_flags)
                return
        except Exception:
            pass

        # If this is an extended Workflow wrapper, its `.invoke` is typically a bound
        # method whose `__self__` is the originating `workflow` instance.
        try:
            invoke = getattr(target, "invoke", None)
            wf_self = getattr(invoke, "__self__", None)
            if isinstance(wf_self, workflow):
                wf_self.flags = _merge_flags(wf_self.flags, incoming_flags)
        except Exception:
            pass

    if is_workflow(obj):
        _apply_flags_to_existing_workflow(obj, flags)
        return cast(Workflow, obj)

    if isinstance(obj, workflow):
        if flags is not None:
            obj.flags = _merge_flags(obj.flags, flags)
        return cast(Workflow, obj())

    return cast(Workflow, workflow(**kwargs)(obj))


async def invoke_workflow(
    request: WorkflowInvokeRequest,
    #
    secrets: Optional[list] = None,
    credentials: Optional[str] = None,
    #
    **kwargs,
) -> Union[WorkflowBatchResponse, WorkflowStreamingResponse]:
    log.info(
        "invoke_workflow: references=%r selector=%r data_uri=%r",
        list(request.references.keys()) if request.references else None,
        request.selector.model_dump() if request.selector else None,
        request.data.revision if request.data else None,
    )
    wf = workflow(
        data=request.data,
        #
        revision=request.data.revision if request.data else None,
        #
        flags=request.flags,
        tags=request.tags,
        meta=request.meta,
        #
        references=request.references,
        links=request.links,
        #
        **kwargs,
    )
    log.info("invoke_workflow: wf.handler=%r wf.uri=%r", wf.handler, wf.uri)
    return await wf.invoke(
        request=request,
        #
        secrets=secrets,
        credentials=credentials,
        #
        **kwargs,
    )


async def inspect_workflow(
    request: WorkflowInspectRequest,
    #
    credentials: Optional[str] = None,
    #
    **kwargs,
) -> WorkflowInvokeRequest:
    wf = workflow(
        revision=request.revision,
        #
        flags=request.flags,
        tags=request.tags,
        meta=request.meta,
        #
        references=request.references,
        #
        selector=request.selector,
    )
    return await wf.inspect(
        credentials=credentials,
        #
        **kwargs,
    )


class application(workflow):
    def __init__(
        self,
        #
        slug: Optional[str] = None,
        *,
        name: Optional[str] = None,
        description: Optional[str] = None,
        #
        parameters: Optional[dict] = None,
        schemas: Optional[dict] = None,
        #
        variant_slug: Optional[str] = None,
        #
        **kwargs,
    ):
        kwargs["flags"] = dict(
            # is_custom=False,  # None / False / missing is the same
            # is_evaluator=False,  # None / False / missing is the same
            # is_human=False,  # None / False / missing is the same
        )

        if "references" not in kwargs or not isinstance(kwargs["references"], dict):
            kwargs["references"] = dict()

        for key in [k for k in kwargs["references"] if k.startswith("evaluator_")]:
            del kwargs["references"][key]

        if slug is not None:
            kwargs["references"]["application"] = {"slug": slug}
        if variant_slug is not None:
            kwargs["references"]["application_variant"] = {"slug": variant_slug}

        super().__init__(
            name=name,
            description=description,
            #
            parameters=parameters,
            schemas=schemas,
            #
            **kwargs,
        )


async def invoke_application(
    request: WorkflowInvokeRequest,
    #
    secrets: Optional[list] = None,
    credentials: Optional[str] = None,
    #
    **kwargs,
) -> Union[WorkflowBatchResponse, WorkflowStreamingResponse]:
    return await application(
        data=request.data,
        #
        revision=request.data.revision if request.data else None,
        #
        flags=request.flags,
        tags=request.tags,
        meta=request.meta,
        #
        references=request.references,
        links=request.links,
        #
        **kwargs,
    )().invoke(
        request=request,
        #
        secrets=secrets,
        credentials=credentials,
        #
        **kwargs,
    )


async def inspect_application(
    request: WorkflowInspectRequest,
    #
    credentials: Optional[str] = None,
    #
    **kwargs,
) -> WorkflowInvokeRequest:
    app = application(
        revision=request.revision,
        #
        flags=request.flags,
        tags=request.tags,
        meta=request.meta,
        #
        references=request.references,
        #
        selector=request.selector,
    )
    return await app.inspect(
        credentials=credentials,
        #
        **kwargs,
    )


class evaluator(workflow):
    def __init__(
        self,
        #
        slug: Optional[str] = None,
        *,
        name: Optional[str] = None,
        description: Optional[str] = None,
        #
        parameters: Optional[dict] = None,
        schemas: Optional[dict] = None,
        #
        variant_slug: Optional[str] = None,
        #
        **kwargs,
    ):
        kwargs["flags"] = dict(
            # is_custom=False,  # None / False / missing is the same
            is_evaluator=True,
            # is_human=False,  # None / False / missing is the same
        )

        if "references" not in kwargs or not isinstance(kwargs["references"], dict):
            kwargs["references"] = dict()

        for key in [k for k in kwargs["references"] if k.startswith("application_")]:
            del kwargs["references"][key]

        if slug is not None:
            kwargs["references"]["evaluator"] = {"slug": slug}
        if variant_slug is not None:
            kwargs["references"]["evaluator_variant"] = {"slug": variant_slug}

        super().__init__(
            name=name,
            description=description,
            #
            parameters=parameters,
            schemas=schemas,
            #
            **kwargs,
        )


async def invoke_evaluator(
    request: WorkflowInvokeRequest,
    #
    secrets: Optional[list] = None,
    credentials: Optional[str] = None,
    #
    **kwargs,
) -> Union[WorkflowBatchResponse, WorkflowStreamingResponse]:
    return await evaluator(
        data=request.data,
        #
        revision=request.data.revision if request.data else None,
        #
        flags=request.flags,
        tags=request.tags,
        meta=request.meta,
        #
        references=request.references,
        links=request.links,
        #
        **kwargs,
    )().invoke(
        request=request,
        #
        secrets=secrets,
        credentials=credentials,
        #
        **kwargs,
    )


async def inspect_evaluator(
    request: WorkflowInspectRequest,
    #
    credentials: Optional[str] = None,
    #
    **kwargs,
) -> WorkflowInvokeRequest:
    ev = evaluator(
        revision=request.revision,
        #
        flags=request.flags,
        tags=request.tags,
        meta=request.meta,
        #
        references=request.references,
        #
        selector=request.selector,
    )
    return await ev.inspect(
        credentials=credentials,
        #
        **kwargs,
    )


async def get_openapi(
    *,
    url: str,
    path: str = "/",
) -> dict:
    """Fetch the per-route openapi.json for a workflow, application, or evaluator."""
    base = url.rstrip("/")
    route_base = path.rstrip("/")
    endpoint = f"{base}{route_base}/openapi.json"
    async with httpx.AsyncClient() as client:
        response = await client.get(endpoint)
        response.raise_for_status()
        return response.json()


get_workflow_openapi = get_openapi
get_application_openapi = get_openapi
get_evaluator_openapi = get_openapi
