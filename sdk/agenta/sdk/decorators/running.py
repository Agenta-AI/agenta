# /agenta/sdk/decorators/running.py

from typing import Any, Callable, Optional, Protocol, Union, Dict
from functools import update_wrapper, wraps
from typing import Callable, Any
from inspect import signature
from uuid import UUID, uuid4

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.models.workflows import (
    WorkflowRevisionData,
    WorkflowRevision,
    WorkflowServiceRequestData,
    WorkflowServiceResponseData,
    WorkflowServiceRequest,
    WorkflowServiceInterface,
    WorkflowServiceConfiguration,
    WorkflowServiceBatchResponse,
    WorkflowServiceStreamResponse,
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
    resolve_interface,
    resolve_configuration,
)
from agenta.sdk.middlewares.running.vault import (
    VaultMiddleware,
    get_secrets,
)
from agenta.sdk.decorators.tracing import auto_instrument
from agenta.sdk.workflows.utils import (
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
        request: Union[WorkflowServiceRequest, dict],
    ) -> Union[WorkflowServiceBatchResponse, WorkflowServiceStreamResponse]: ...


class InspectFn(Protocol):
    async def __call__(self) -> WorkflowServiceRequest: ...


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
        request: Union[WorkflowServiceRequest, dict],
        #
        secrets: Optional[list] = None,
        credentials: Optional[str] = None,
        #
        **kwargs,
    ) -> Union[WorkflowServiceBatchResponse, WorkflowServiceStreamResponse]: ...

    async def inspect(
        self,
        *,
        credentials: Optional[str] = None,
        #
        **kwargs,
    ) -> WorkflowServiceRequest: ...

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
        #
        references: Optional[Dict[str, Union[Reference, Dict[str, Any]]]] = None,
        # -------------------------------------------------------------------- #
        links: Optional[Dict[str, Union[Link, Dict[str, Any]]]] = None,
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
        interface: Optional[
            Union[
                WorkflowServiceInterface,
                Dict[str, Any],
            ]
        ] = None,
        # -------------------------------------------------------------------- #
        script: Optional[dict] = None,
        parameters: Optional[dict] = None,
        #
        configuration: Optional[
            Union[
                WorkflowServiceConfiguration,
                Dict[str, Any],
            ]
        ] = None,
        # -------------------------------------------------------------------- #
        aggregate: Optional[Union[bool, Callable]] = None,  # stream to batch
        annotate: Optional[bool] = None,  # annotation vs invocation
        # -------------------------------------------------------------------- #
        **kwargs,
    ):
        # -------------------------------------------------------------------- #
        self.id = id
        self.slug = slug
        self.version = version
        #
        self.references = references  # FIX TYPING
        # -------------------------------------------------------------------- #
        self.links = links
        # -------------------------------------------------------------------- #
        self.name = name
        self.description = description
        # -------------------------------------------------------------------- #
        self.flags = flags
        self.tags = tags
        self.meta = meta
        # -------------------------------------------------------------------- #
        self.uri = uri
        self.url = url
        self.headers = headers
        self.schemas = schemas
        #
        self.interface = interface
        # -------------------------------------------------------------------- #
        self.script = script
        self.parameters = parameters
        #
        self.configuration = configuration
        # -------------------------------------------------------------------- #
        self.aggregate = aggregate
        self.annotate = annotate
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

        self.uri = uri or (interface.uri if interface else None)

        if self.uri is not None:
            self._retrieve_handler(self.uri)

            if self.handler:
                self.interface = retrieve_interface(self.uri) or self.interface
                if isinstance(self.interface, WorkflowServiceInterface):
                    self.uri = self.interface.uri or self.uri
                self.configuration = self.configuration or retrieve_configuration(
                    self.uri
                )
                if not isinstance(self.configuration, WorkflowServiceConfiguration):
                    self.configuration = WorkflowServiceConfiguration()
                self.configuration.parameters = (
                    self.parameters or self.configuration.parameters
                )
                self.parameters = self.configuration.parameters

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
            if self.interface is None:
                self.interface = WorkflowServiceInterface()
            self.uri = uri
            self.interface.uri = uri
            self.interface.schemas = self.schemas
            self.handler = instrumented

    def _retrieve_handler(self, uri: str):
        self.handler = retrieve_handler(uri)
        if self.handler is None:
            raise ValueError(f"Unable to retrieve handler for URI: {uri}")
        if self.interface is None:
            self.interface = WorkflowServiceInterface()
        self.uri = uri
        self.interface.uri = uri
        self.interface.schemas = self.schemas

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

        if self.handler is None:
            raise ValueError("handler must be set before extending")

        self.handler = Workflow(wrapper)

    async def invoke(
        self,
        *,
        request: WorkflowServiceRequest,
        #
        secrets: Optional[list] = None,
        credentials: Optional[str] = None,
        #
        **kwargs,
    ) -> Union[WorkflowServiceBatchResponse, WorkflowServiceStreamResponse]:
        _flags = {**(self.flags or {}), **(request.flags or {})}
        _tags = {**(self.tags or {}), **(request.tags or {})}
        _meta = {**(self.meta or {}), **(request.meta or {})}

        credentials = credentials or (
            f"ApiKey {ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_key}"
            if ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_key
            else None
        )

        with tracing_context_manager(TracingContext.get()):
            tracing_ctx = TracingContext.get()

            tracing_ctx.credentials = credentials

            tracing_ctx.aggregate = self.aggregate
            tracing_ctx.annotate = self.annotate

            tracing_ctx.flags = _flags
            tracing_ctx.tags = _tags
            tracing_ctx.meta = _meta

            tracing_ctx.references = self.references
            tracing_ctx.links = self.links

            with running_context_manager(RunningContext.get()):
                running_ctx = RunningContext.get()

                running_ctx.secrets = secrets
                running_ctx.credentials = credentials

                running_ctx.interface = self.interface
                running_ctx.schemas = self.schemas
                running_ctx.configuration = self.configuration
                running_ctx.parameters = self.parameters

                running_ctx.aggregate = self.aggregate
                running_ctx.annotate = self.annotate

                async def terminal(req: WorkflowServiceRequest):
                    return None

                call_next = terminal

                for mw in reversed(self.middlewares):
                    prev_next = call_next

                    async def make_call(mw, prev_next):
                        async def _call(
                            req: WorkflowServiceRequest,
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
    ) -> WorkflowServiceRequest:
        with tracing_context_manager(TracingContext.get()):
            tracing_ctx = TracingContext.get()

            tracing_ctx.credentials = credentials

            tracing_ctx.aggregate = self.aggregate
            tracing_ctx.annotate = self.annotate

            tracing_ctx.references = self.references
            tracing_ctx.links = self.links

            with running_context_manager(RunningContext.get()):
                running_ctx = RunningContext.get()

                running_ctx.credentials = credentials

                running_ctx.interface = self.interface
                running_ctx.schemas = self.schemas
                running_ctx.configuration = self.configuration
                running_ctx.parameters = self.parameters

                running_ctx.aggregate = self.aggregate
                running_ctx.annotate = self.annotate

                if self.default_request is None:
                    interface = await resolve_interface(
                        interface=self.interface,
                        **self.kwargs,
                    )
                    configuration = await resolve_configuration(
                        configuration=self.configuration,
                        **self.kwargs,
                    )

                    self.default_request = WorkflowServiceRequest(
                        #
                        interface=interface,
                        configuration=configuration,
                        #
                        references=self.references,
                        links=self.links,
                        #
                        flags=self.flags,
                        tags=self.tags,
                        meta=self.meta,
                        #
                        data=WorkflowServiceRequestData(
                            revision=WorkflowRevision(
                                id=self.id,
                                slug=self.slug,
                                version=self.version,
                                #
                                name=self.name,
                                description=self.description,
                            ).model_dump(
                                mode="json",
                                exclude_none=True,
                            ),
                        ),
                    )

                return self.default_request


def is_workflow(obj: Any) -> bool:
    return getattr(obj, "is_workflow", False) or isinstance(
        getattr(obj, "workflow", None), workflow
    )


def auto_workflow(obj: Any, **kwargs) -> Workflow:
    if is_workflow(obj):
        return obj
    if isinstance(obj, workflow):
        return obj()
    if isinstance(getattr(obj, "workflow", None), workflow):
        return obj

    return workflow(**kwargs)(obj)


async def invoke_workflow(
    request: WorkflowServiceRequest,
    #
    secrets: Optional[list] = None,
    credentials: Optional[str] = None,
    #
    **kwargs,
) -> Union[WorkflowServiceBatchResponse, WorkflowServiceStreamResponse]:
    return await workflow(
        data=request.data,
        #
        interface=request.interface,
        configuration=request.configuration,
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


async def inspect_workflow(
    request: WorkflowServiceRequest,
    #
    credentials: Optional[str] = None,
    #
    **kwargs,
) -> WorkflowServiceRequest:
    return await workflow(
        data=request.data,
        #
        interface=request.interface,
        configuration=request.configuration,
        #
        flags=request.flags,
        tags=request.tags,
        meta=request.meta,
        #
        references=request.references,
        links=request.links,
    )().inspect(
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

        if not "references" in kwargs or not isinstance(kwargs["references"], dict):
            kwargs["references"] = dict()

        for key in kwargs["references"]:
            if key.startswith("evaluator_"):
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
    request: WorkflowServiceRequest,
    #
    secrets: Optional[list] = None,
    credentials: Optional[str] = None,
    #
    **kwargs,
) -> Union[WorkflowServiceBatchResponse, WorkflowServiceStreamResponse]:
    return await application(
        data=request.data,
        #
        interface=request.interface,
        configuration=request.configuration,
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
    request: WorkflowServiceRequest,
    #
    credentials: Optional[str] = None,
    #
    **kwargs,
) -> WorkflowServiceRequest:
    return await application(
        data=request.data,
        #
        interface=request.interface,
        configuration=request.configuration,
        #
        flags=request.flags,
        tags=request.tags,
        meta=request.meta,
        #
        references=request.references,
        links=request.links,
    )().inspect(
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

        if not "references" in kwargs or not isinstance(kwargs["references"], dict):
            kwargs["references"] = dict()

        for key in kwargs["references"]:
            if key.startswith("application_"):
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
    request: WorkflowServiceRequest,
    #
    secrets: Optional[list] = None,
    credentials: Optional[str] = None,
    #
    **kwargs,
) -> Union[WorkflowServiceBatchResponse, WorkflowServiceStreamResponse]:
    return await evaluator(
        data=request.data,
        #
        interface=request.interface,
        configuration=request.configuration,
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
    request: WorkflowServiceRequest,
    #
    credentials: Optional[str] = None,
    #
    **kwargs,
) -> WorkflowServiceRequest:
    return await evaluator(
        data=request.data,
        #
        interface=request.interface,
        configuration=request.configuration,
        #
        flags=request.flags,
        tags=request.tags,
        meta=request.meta,
        #
        references=request.references,
        links=request.links,
    )().inspect(
        credentials=credentials,
        #
        **kwargs,
    )
