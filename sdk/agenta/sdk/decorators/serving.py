from typing import Type, Any, Callable, Dict, Optional, Tuple, List, TYPE_CHECKING
from inspect import (
    iscoroutinefunction,
    isgenerator,
    isasyncgen,
    signature,
    Signature,
    Parameter,
)
from functools import wraps
from traceback import format_exception
from asyncio import sleep
from uuid import UUID
from pydantic import BaseModel, HttpUrl, ValidationError
from os import environ

if TYPE_CHECKING:
    from fastapi import FastAPI, Request, HTTPException, Body
else:
    # Lazy imports - only loaded when @entrypoint or @route is used
    Request = None
    HTTPException = None
    Body = None

from agenta.sdk.contexts.routing import (
    routing_context_manager,
    RoutingContext,
)
from agenta.sdk.contexts.tracing import (
    tracing_context_manager,
    TracingContext,
)
from agenta.sdk.utils.exceptions import suppress, display_exception
from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.helpers import get_current_version
from agenta.sdk.utils.lazy import _load_fastapi, _load_starlette_responses
from agenta.sdk.types import (
    MultipleChoice,
    BaseResponse,
    StreamResponse,
)

import agenta as ag

log = get_module_logger(__name__)

AGENTA_RUNTIME_PREFIX = environ.get("AGENTA_RUNTIME_PREFIX", "")


# Lazy FastAPI initialization
class _LazyApp:
    """Lazy wrapper for FastAPI app - only imported when accessed."""

    _app = None

    def _get_app(self):
        if self._app is None:
            fastapi = _load_fastapi()
            from agenta.sdk.router import get_router

            self._app = fastapi.FastAPI(
                docs_url=f"{AGENTA_RUNTIME_PREFIX}/docs",  # Swagger UI
                openapi_url=f"{AGENTA_RUNTIME_PREFIX}/openapi.json",  # OpenAPI schema
            )
            self._app.include_router(get_router(), prefix=AGENTA_RUNTIME_PREFIX)
        return self._app

    def __getattr__(self, name):
        return getattr(self._get_app(), name)

    async def __call__(self, scope, receive, send):
        return await self._get_app()(scope, receive, send)


app = _LazyApp()  # type: ignore


class PathValidator(BaseModel):
    url: HttpUrl


def _add_middleware_to_app(target_app: "FastAPI") -> None:  # noqa: F821
    """
    Add all required middleware to a FastAPI app.

    This function registers the standard Agenta middleware stack on the given app.
    The middleware is added in reverse order of execution (last added = first executed).

    Middleware stack (in execution order):
        1. CORSMiddleware - Handle CORS headers
        2. OTelMiddleware - OpenTelemetry tracing
        3. AuthHTTPMiddleware - Authentication
        4. ConfigMiddleware - Configuration injection
        5. VaultMiddleware - Secrets management
        6. InlineMiddleware - Inline execution support
        7. MockMiddleware - Mock/test mode support

    Args:
        target_app: The FastAPI application to add middleware to.
    """
    from agenta.sdk.middleware.mock import MockMiddleware
    from agenta.sdk.middleware.inline import InlineMiddleware
    from agenta.sdk.middleware.vault import VaultMiddleware
    from agenta.sdk.middleware.config import ConfigMiddleware
    from agenta.sdk.middleware.otel import OTelMiddleware
    from agenta.sdk.middleware.auth import AuthHTTPMiddleware
    from agenta.sdk.middleware.cors import CORSMiddleware

    target_app.add_middleware(MockMiddleware)
    target_app.add_middleware(InlineMiddleware)
    target_app.add_middleware(VaultMiddleware)
    target_app.add_middleware(ConfigMiddleware)
    target_app.add_middleware(AuthHTTPMiddleware)
    target_app.add_middleware(OTelMiddleware)
    target_app.add_middleware(CORSMiddleware)


def _generate_openapi(target_app: Any) -> Dict[str, Any]:
    """Generate OpenAPI schema for the target app."""
    target_app.openapi_schema = None
    return target_app.openapi()


def create_app():
    """
    Factory function to create an independent FastAPI app with its own middleware and routes.

    This is useful when you need multiple isolated apps that can be mounted as sub-applications,
    each with their own OpenAPI schema.

    Returns:
        A tuple of (FastAPI app, route decorator class) for this isolated app context.

    Example:
        chat_app, chat_route = ag.create_app()

        @chat_route("/", config_schema=MyConfig)
        async def chat_handler(...):
            ...

        # Mount on main app
        main_app.mount("/chat", chat_app)
    """
    fastapi = _load_fastapi()
    from agenta.sdk.router import get_router

    # Create a new FastAPI app with its own OpenAPI schema
    new_app = fastapi.FastAPI(
        docs_url="/docs",
        openapi_url="/openapi.json",
    )
    new_app.include_router(get_router())
    _add_middleware_to_app(new_app)

    # Create isolated route list for this app
    isolated_routes: List[Dict[str, Any]] = []

    class isolated_route:  # pylint: disable=invalid-name
        """Route decorator for isolated app context."""

        def __init__(
            self,
            path: Optional[str] = "/",
            config_schema: Optional[BaseModel] = None,
            flags: Optional[Dict[str, Any]] = None,
        ):
            self.config_schema = config_schema
            self.flags = dict(flags or {})
            path = "/" + path.strip("/").strip()
            path = "" if path == "/" else path
            PathValidator(url=f"http://example.com{path}")
            self.route_path = path
            self.e = None

        def __call__(self, f):
            self.e = entrypoint(
                f,
                route_path=self.route_path,
                config_schema=self.config_schema,
                flags=self.flags,
                target_app=new_app,
                app_routes=isolated_routes,
            )
            return f

    return new_app, isolated_route


class route:  # pylint: disable=invalid-name
    # This decorator is used to expose specific stages of a workflow (embedding, retrieval, summarization, etc.)
    # as independent endpoints. It is designed for backward compatibility with existing code that uses
    # the @entrypoint decorator, which has certain limitations. By using @route(), we can create new
    # routes without altering the main workflow entrypoint. This helps in modularizing the services
    # and provides flexibility in how we expose different functionalities as APIs.
    def __init__(
        self,
        path: Optional[str] = "/",
        config_schema: Optional[BaseModel] = None,
        flags: Optional[Dict[str, Any]] = None,
    ):
        self.config_schema: BaseModel = config_schema
        self.flags = dict(flags or {})
        path = "/" + path.strip("/").strip()
        path = "" if path == "/" else path
        PathValidator(url=f"http://example.com{path}")

        self.route_path = path

        self.e = None

    def __call__(self, f):
        self.e = entrypoint(
            f,
            route_path=self.route_path,
            config_schema=self.config_schema,
            flags=self.flags,
        )

        return f


class entrypoint:
    """
    Decorator class to wrap a function for HTTP POST, terminal exposure and enable tracing.

    This decorator generates the following endpoints:

    Playground Endpoints
    - /generate                 with @entrypoint, @route("/"), @route(path="") # LEGACY
    - /playground/run           with @entrypoint, @route("/"), @route(path="")
    - /playground/run/{route}   with @route({route}), @route(path={route})

    Deployed Endpoints:
    - /generate_deployed        with @entrypoint, @route("/"), @route(path="") # LEGACY
    - /run                      with @entrypoint, @route("/"), @route(path="")
    - /run/{route}              with @route({route}), @route(path={route})

    The rationale is:
    - There may be multiple endpoints, based on the different routes.
    - It's better to make it explicit that an endpoint is for the playground.
    - Prefixing the routes with /run is more futureproof in case we add more endpoints.

    Example:
    ```python
        import agenta as ag

        @ag.entrypoint
        async def chain_of_prompts_llm(prompt: str):
            return ...
    ```
    """

    routes = list()

    _middleware = False
    _run_path = f"{AGENTA_RUNTIME_PREFIX}/run"
    _test_path = f"{AGENTA_RUNTIME_PREFIX}/test"
    _config_key = "ag_config"
    # LEGACY
    _legacy_generate_path = f"{AGENTA_RUNTIME_PREFIX}/generate"
    _legacy_generate_deployed_path = f"{AGENTA_RUNTIME_PREFIX}/generate_deployed"

    def __init__(
        self,
        func: Callable[..., Any],
        route_path: str = "",
        config_schema: Optional[BaseModel] = None,
        flags: Optional[Dict[str, Any]] = None,
        target_app: Optional[Any] = None,
        app_routes: Optional[List[Dict[str, Any]]] = None,
    ):
        # Lazy import fastapi components - only loaded when decorator is used
        fastapi = _load_fastapi()

        self.func = func
        self.route_path = route_path
        self.config_schema = config_schema
        self.flags = dict(flags or {})

        # Use provided app/routes or fall back to global defaults
        target_app = target_app if target_app is not None else app
        app_routes = app_routes if app_routes is not None else entrypoint.routes

        # Store for use in methods
        self._Request = fastapi.Request
        self._HTTPException = fastapi.HTTPException
        self._Body = fastapi.Body

        signature_parameters = signature(func).parameters
        config, default_parameters = self.parse_config()

        ### --- Middleware --- #
        # Only add middleware to global app (isolated apps get middleware in create_app)
        if target_app is app and not entrypoint._middleware:
            entrypoint._middleware = True
            _add_middleware_to_app(app)
        ### ------------------ #

        ### --- Run --- #
        @wraps(func)
        async def run_wrapper(request: Request, *args, **kwargs) -> Any:
            # LEGACY
            # TODO: Removing this implies breaking changes in :
            # - calls to /generate_deployed
            kwargs = {
                k: v
                for k, v in kwargs.items()
                if k not in ["config", "environment", "app"]
            }
            # LEGACY

            kwargs, _ = self.process_kwargs(kwargs, default_parameters)
            if (
                request.state.config["parameters"] is None
                or request.state.config["references"] is None
            ):
                raise self._HTTPException(
                    status_code=400,
                    detail="Config not found based on provided references.",
                )

            return await self.execute_wrapper(request, *args, **kwargs)

        self.update_run_wrapper_signature(wrapper=run_wrapper)

        run_route = f"{route_path}{entrypoint._run_path}"
        target_app.post(
            run_route,
            response_model=BaseResponse,
            response_model_exclude_none=True,
        )(run_wrapper)

        app_routes.append(
            {
                "func": func.__name__,
                "endpoint": run_route,
                "params": signature_parameters,
                "config": None,
                "flags": self.flags,
            }
        )

        # LEGACY
        # TODO: Removing this implies breaking changes in :
        # - calls to /generate_deployed must be replaced with calls to /run
        if route_path == "":
            run_route = entrypoint._legacy_generate_deployed_path
            target_app.post(
                run_route,
                response_model=BaseResponse,
                response_model_exclude_none=True,
            )(run_wrapper)
        # LEGACY
        ### ----------- #

        ### --- Test --- #
        @wraps(func)
        async def test_wrapper(request: Request, *args, **kwargs) -> Any:
            kwargs, config = self.process_kwargs(kwargs, default_parameters)
            request.state.inline = True
            request.state.config["parameters"] = config
            if request.state.config["references"]:
                request.state.config["references"] = {
                    k: v
                    for k, v in request.state.config["references"].items()
                    if k.startswith("application")
                } or None
            return await self.execute_wrapper(request, *args, **kwargs)

        self.update_test_wrapper_signature(wrapper=test_wrapper, config_instance=config)

        test_route = f"{route_path}{entrypoint._test_path}"
        target_app.post(
            test_route,
            response_model=BaseResponse,
            response_model_exclude_none=True,
        )(test_wrapper)

        # LEGACY
        # TODO: Removing this implies breaking changes in :
        # - calls to /generate must be replaced with calls to /test
        if route_path == "":
            test_route = entrypoint._legacy_generate_path
            target_app.post(
                test_route,
                response_model=BaseResponse,
                response_model_exclude_none=True,
            )(test_wrapper)
        # LEGACY

        ### --- OpenAPI --- #
        test_route = f"{route_path}{entrypoint._test_path}"
        app_routes.append(
            {
                "func": func.__name__,
                "endpoint": test_route,
                "params": signature_parameters,
                "config": config,
                "flags": self.flags,
            }
        )

        # LEGACY
        if route_path == "":
            test_route = entrypoint._legacy_generate_path
            app_routes.append(
                {
                    "func": func.__name__,
                    "endpoint": test_route,
                    "params": (
                        {**default_parameters, **signature_parameters}
                        if not config
                        else signature_parameters
                    ),
                    "config": config,
                    "flags": self.flags,
                }
            )
        # LEGACY

        openapi_schema = _generate_openapi(target_app)

        self.add_flags_to_schema(openapi_schema=openapi_schema, app_routes=app_routes)

        for _route in app_routes:
            if _route["config"] is not None:
                self.override_config_in_schema(
                    openapi_schema=openapi_schema,
                    func_name=_route["func"],
                    endpoint=_route["endpoint"].replace(AGENTA_RUNTIME_PREFIX, ""),
                    config=_route["config"],
                )

        target_app.openapi_schema = openapi_schema
        ### --------------- #

    def parse_config(self) -> Tuple[Optional[Type[BaseModel]], Dict[str, Any]]:
        """Parse the config schema and return the config class and default parameters."""
        config = None
        default_parameters = {}

        if self.config_schema:
            try:
                config = self.config_schema() if self.config_schema else None
                default_parameters = config.dict() if config else {}
            except ValidationError as e:
                raise ValueError(
                    f"Error initializing config_schema. Please ensure all required fields have default values: {str(e)}"
                ) from e
            except Exception as e:
                raise ValueError(
                    f"Unexpected error initializing config_schema: {str(e)}"
                ) from e

        return config, default_parameters

    def process_kwargs(
        self, kwargs: Dict[str, Any], default_parameters: Dict[str, Any]
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """Remove the config parameters from the kwargs."""
        # Extract agenta_config if present
        config_params = kwargs.pop(self._config_key, {})
        if isinstance(config_params, BaseModel):
            config_params = config_params.dict()
        # Merge with default parameters
        config = {**default_parameters, **config_params}

        return kwargs, config

    async def execute_wrapper(
        self,
        request: "Request",  # type: ignore
        *args,
        **kwargs,
    ):
        if not request:
            raise self._HTTPException(status_code=500, detail="Missing 'request'.")

        state = request.state
        traceparent = state.otel.get("traceparent")
        baggage = state.otel.get("baggage")
        credentials = state.auth.get("credentials")
        parameters = state.config.get("parameters")
        references = state.config.get("references")
        secrets = state.vault.get("secrets")
        local_secrets = state.vault.get("local_secrets")
        vault_secrets = state.vault.get("vault_secrets")
        inline = state.inline
        mock = state.mock

        with routing_context_manager(
            context=RoutingContext(
                parameters=parameters,
                secrets=secrets,
                local_secrets=local_secrets,
                vault_secrets=vault_secrets,
                mock=mock,
            )
        ):
            with tracing_context_manager(
                context=TracingContext(
                    traceparent=traceparent,
                    baggage=baggage,
                    credentials=credentials,
                    parameters=parameters,
                    references=references,
                )
            ):
                try:
                    result = (
                        await self.func(*args, **kwargs)
                        if iscoroutinefunction(self.func)
                        else self.func(*args, **kwargs)
                    )

                    return await self.handle_success(result, inline)

                except Exception as error:  # pylint: disable=broad-except
                    await self.handle_failure(error, inline)

    async def handle_success(
        self,
        result: Any,
        inline: bool,
    ):
        StarletteResponse, StreamingResponse = _load_starlette_responses()

        data = None
        content_type = "text/plain"

        tree = None
        tree_id = None
        trace_id = None
        span_id = None

        with suppress():
            if isinstance(result, (dict, list)):
                content_type = "application/json"

            data = self.patch_result(result)

            (
                tree,
                tree_id,
                trace_id,
                span_id,
            ) = await self.fetch_inline_trace(inline)

        try:
            if isinstance(result, StarletteResponse):
                result.headers.setdefault("x-ag-version", "3.0")
                if content_type:
                    result.headers.setdefault("x-ag-content-type", content_type)
                if tree_id:
                    result.headers.setdefault("x-ag-tree-id", tree_id)
                if trace_id:
                    result.headers.setdefault("x-ag-trace-id", trace_id)
                if span_id:
                    result.headers.setdefault("x-ag-span-id", span_id)

                return result
        except Exception:
            return result

        try:
            if isasyncgen(result) or isgenerator(result):
                return StreamResponse(
                    content=result,
                    content_type=content_type,
                    tree_id=tree_id,
                    trace_id=trace_id,
                    span_id=span_id,
                )
        except Exception:
            return StreamingResponse(
                result,
                media_type="text/event-stream",
            )

        try:
            return BaseResponse(
                data=data,
                content_type=content_type,
                tree=tree,
                tree_id=tree_id,
                trace_id=trace_id,
                span_id=span_id,
            )
        except Exception:
            try:
                return BaseResponse(
                    data=data,
                    content_type=content_type,
                    tree_id=tree_id,
                    trace_id=trace_id,
                    span_id=span_id,
                )
            except Exception:
                return BaseResponse(
                    data=data,
                    content_type=content_type,
                )

    async def handle_failure(
        self,
        error: Exception,
        inline: bool,
    ):
        display_exception("Application Exception")

        status_code = (
            getattr(error, "status_code") if hasattr(error, "status_code") else 500
        )
        if status_code in [401, 403, 429]:  # Downstream API errors
            status_code = 424  # Failed Dependency

        stacktrace = format_exception(error, value=error, tb=error.__traceback__)  # type: ignore

        tree = None
        tree_id = None
        trace_id = None
        span_id = None

        with suppress():
            (
                tree,
                tree_id,
                trace_id,
                span_id,
            ) = await self.fetch_inline_trace(inline)

        raise self._HTTPException(
            status_code=status_code,
            detail=dict(
                message=str(error),
                stacktrace=stacktrace,
                tree=tree,
                tree_id=tree_id,
                trace_id=trace_id,
                span_id=span_id,
            ),
        )

    def patch_result(
        self,
        result: Any,
    ):
        """
        Patch the result to only include the message if the result is a FuncResponse-style dictionary with message, cost, and usage keys.

        Example:
        ```python
        result = {
            "message": "Hello, world!",
            "cost": 0.5,
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 20,
                "total_tokens": 30
            }
        }
        result = patch_result(result)
        print(result)
        # Output: "Hello, world!"
        ```
        """
        data = (
            result["message"]
            if isinstance(result, dict)
            and all(key in result for key in ["message", "cost", "usage"])
            else result
        )

        if data is None:
            data = (
                "Function executed successfully, but did return None. \n Are you sure you did not forget to return a value?",
            )

        if not isinstance(result, dict):
            data = str(data)

        return data

    async def fetch_inline_trace_id(
        self,
    ):
        context = TracingContext.get()

        link = context.link

        _trace_id = link.get("trace_id") if link else None  # in int format
        tree_id = (
            str(UUID(int=_trace_id)) if _trace_id else None
        )  # in uuid_as_str format

        return tree_id

    async def fetch_inline_trace(
        self,
        inline: bool,
    ):
        TIMEOUT = 1
        TIMESTEP = 0.1
        NOFSTEPS = TIMEOUT / TIMESTEP

        context = TracingContext.get()

        link = context.link

        _trace_id = link.get("trace_id") if link else None  # in int format
        _span_id = link.get("span_id") if link else None  # in int format

        tree = None
        tree_id = str(UUID(int=_trace_id)) if _trace_id else None
        trace_id = UUID(int=_trace_id).hex if _trace_id else None
        span_id = UUID(int=_span_id).hex[16:] if _span_id else None

        if _trace_id is not None:
            if inline:
                remaining_steps = NOFSTEPS
                while (
                    not ag.tracing.is_inline_trace_ready(_trace_id)
                    and remaining_steps > 0
                ):
                    await sleep(TIMESTEP)

                    remaining_steps -= 1

                tree = ag.tracing.get_inline_trace(_trace_id)

        return tree, tree_id, trace_id, span_id

    # --- OpenAPI --- #

    def add_request_to_signature(
        self,
        wrapper: Callable[..., Any],
    ):
        original_sig = signature(wrapper)
        parameters = [
            Parameter(
                "request",
                kind=Parameter.POSITIONAL_OR_KEYWORD,
                annotation=self._Request,
            ),
            *original_sig.parameters.values(),
        ]
        new_sig = Signature(
            parameters,
            return_annotation=original_sig.return_annotation,
        )
        wrapper.__signature__ = new_sig

    def update_wrapper_signature(
        self, wrapper: Callable[..., Any], updated_params: List
    ):
        """
        Updates the signature of a wrapper function with a new list of parameters.

        Args:
            wrapper (callable): A callable object, such as a function or a method, that requires a signature update.
            updated_params (List[Parameter]): A list of `Parameter` objects representing the updated parameters
                for the wrapper function.
        """

        wrapper_signature = signature(wrapper)
        wrapper_signature = wrapper_signature.replace(parameters=updated_params)
        wrapper.__signature__ = wrapper_signature  # type: ignore

    def update_test_wrapper_signature(
        self,
        wrapper: Callable[..., Any],
        config_instance: Type[BaseModel],  # TODO: change to our type
    ) -> None:
        """Update the function signature to include new parameters."""

        updated_params: List[Parameter] = []
        self.add_config_params_to_parser(updated_params, config_instance)
        self.add_func_params_to_parser(updated_params)
        self.update_wrapper_signature(wrapper, updated_params)
        self.add_request_to_signature(wrapper)

    def update_run_wrapper_signature(
        self,
        wrapper: Callable[..., Any],
    ) -> None:
        """Update the function signature to include new parameters."""

        updated_params: List[Parameter] = []
        self.add_func_params_to_parser(updated_params)
        self.update_wrapper_signature(wrapper, updated_params)
        self.add_request_to_signature(wrapper)

    def add_config_params_to_parser(
        self, updated_params: list, config_instance: Type[BaseModel]
    ) -> None:
        """Add configuration parameters to function signature."""

        for name, field in config_instance.model_fields.items():
            assert field.default is not None, f"Field {name} has no default value"

        updated_params.append(
            Parameter(
                name=self._config_key,
                kind=Parameter.KEYWORD_ONLY,
                annotation=type(config_instance),  # Get the actual class type
                default=self._Body(config_instance),  # Use the instance directly
            )
        )

    def add_func_params_to_parser(self, updated_params: list) -> None:
        """Add function parameters to function signature."""
        for name, param in signature(self.func).parameters.items():
            assert len(param.default.__class__.__bases__) == 1, (
                f"Inherited standard type of {param.default.__class__} needs to be one."
            )
            updated_params.append(
                Parameter(
                    name,
                    Parameter.KEYWORD_ONLY,
                    default=self._Body(..., embed=True),
                    annotation=param.default.__class__.__bases__[
                        0
                    ],  # determines and get the base (parent/inheritance) type of the sdk-type at run-time. \
                    # E.g __class__ is ag.MessagesInput() and accessing it parent type will return (<class 'list'>,), \
                    # thus, why we are accessing the first item.
                )
            )

    def openapi(self):
        app.openapi_schema = None  # Forces FastAPI to re-generate the schema

        openapi_schema = app.openapi()

        # ✅ Fix paths by removing the prefix
        updated_paths = {}
        for path, methods in openapi_schema["paths"].items():
            new_path = (
                path[len(AGENTA_RUNTIME_PREFIX) :]
                if path.startswith(AGENTA_RUNTIME_PREFIX)
                else path
            )
            updated_paths[new_path] = methods
        openapi_schema["paths"] = updated_paths  # Replace paths

        # ✅ Fix schema names and update `$ref` references
        if "components" in openapi_schema and "schemas" in openapi_schema["components"]:
            updated_schemas = {}
            schema_name_map = {}  # Map old schema names to new schema names

            for schema_name, schema_value in openapi_schema["components"][
                "schemas"
            ].items():
                if AGENTA_RUNTIME_PREFIX and AGENTA_RUNTIME_PREFIX != "":
                    new_schema_name = schema_name.replace(
                        AGENTA_RUNTIME_PREFIX.lstrip("/").replace("/", "_") + "_", ""
                    ).strip("_")
                else:
                    new_schema_name = schema_name
                updated_schemas[new_schema_name] = schema_value
                schema_name_map[schema_name] = new_schema_name  # Store mapping

            # ✅ Fix `$ref` references
            for path, methods in updated_paths.items():
                for method in methods.values():
                    if "requestBody" in method and "content" in method["requestBody"]:
                        for content_type, content in method["requestBody"][
                            "content"
                        ].items():
                            if "$ref" in content["schema"]:
                                old_ref = content["schema"]["$ref"]
                                schema_name = old_ref.split("/")[
                                    -1
                                ]  # Extract schema name
                                if schema_name in schema_name_map:
                                    content["schema"]["$ref"] = (
                                        f"#/components/schemas/{schema_name_map[schema_name]}"
                                    )

                    if "responses" in method:
                        for status_code, response in method["responses"].items():
                            if "content" in response:
                                for content_type, content in response[
                                    "content"
                                ].items():
                                    if "$ref" in content["schema"]:
                                        old_ref = content["schema"]["$ref"]
                                        schema_name = old_ref.split("/")[
                                            -1
                                        ]  # Extract schema name
                                        if schema_name in schema_name_map:
                                            content["schema"]["$ref"] = (
                                                f"#/components/schemas/{schema_name_map[schema_name]}"
                                            )

            # ✅ Update OpenAPI schema with fixed schemas
            openapi_schema["components"]["schemas"] = updated_schemas

            # ✅ Add Agenta SDK version info
            openapi_schema["agenta_sdk"] = {"version": get_current_version()}

        return openapi_schema

    def add_flags_to_schema(
        self,
        openapi_schema: Dict[str, Any],
        app_routes: List[Dict[str, Any]],
    ) -> None:
        paths = openapi_schema.get("paths")
        if not paths:
            return

        for route in app_routes:
            endpoint = route.get("endpoint")
            if not endpoint or ("/run" not in endpoint and "/test" not in endpoint):
                continue

            methods = paths.get(endpoint)
            if not methods:
                continue

            flags = dict(route.get("flags") or {})
            for method_data in methods.values():
                # Prefer a single vendor-extension namespace we can evolve over time.
                existing = method_data.get("x-agenta")
                if not isinstance(existing, dict):
                    existing = {}

                existing_flags = existing.get("flags")
                if not isinstance(existing_flags, dict):
                    existing_flags = {}

                # Route-level flags override any previously set flags.
                existing["flags"] = {**existing_flags, **flags}
                method_data["x-agenta"] = existing

    def override_config_in_schema(
        self,
        openapi_schema: dict,
        func_name: str,
        endpoint: str,
        config: Type[BaseModel],
    ):
        """Override config in OpenAPI schema to add agenta-specific metadata."""
        endpoint = endpoint[1:].replace("/", "_")

        # Get the config class name to find its schema
        config_class_name = type(config).__name__
        config_schema = openapi_schema["components"]["schemas"][config_class_name]
        # Process each field in the config class
        for field_name, field in config.__class__.model_fields.items():
            # Check if field has Annotated metadata for MultipleChoice
            if hasattr(field, "metadata") and field.metadata:
                for meta in field.metadata:
                    if isinstance(meta, MultipleChoice):
                        choices = meta.choices
                        if isinstance(choices, dict):
                            config_schema["properties"][field_name].update(
                                {"x-parameter": "grouped_choice", "choices": choices}
                            )
                        elif isinstance(choices, list):
                            config_schema["properties"][field_name].update(
                                {"x-parameter": "choice", "enum": choices}
                            )
