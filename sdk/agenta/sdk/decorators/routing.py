from typing import Type, Any, Callable, Dict, Optional, Tuple, List
from inspect import signature, iscoroutinefunction, Signature, Parameter
from functools import wraps
from traceback import format_exception
from asyncio import sleep
from uuid import UUID
from pydantic import BaseModel, HttpUrl, ValidationError
from os import environ

from fastapi import Body, FastAPI, HTTPException, Request

from agenta.sdk.middleware.mock import MockMiddleware
from agenta.sdk.middleware.inline import InlineMiddleware
from agenta.sdk.middleware.vault import VaultMiddleware
from agenta.sdk.middleware.config import ConfigMiddleware
from agenta.sdk.middleware.otel import OTelMiddleware
from agenta.sdk.middleware.auth import AuthMiddleware
from agenta.sdk.middleware.cors import CORSMiddleware

from agenta.sdk.context.routing import (
    routing_context_manager,
    RoutingContext,
)
from agenta.sdk.context.tracing import (
    tracing_context_manager,
    tracing_context,
    TracingContext,
)
from agenta.sdk.router import router
from agenta.sdk.utils.exceptions import suppress, display_exception
from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.helpers import get_current_version
from agenta.sdk.types import (
    MultipleChoice,
    BaseResponse,
    MCField,
)

import agenta as ag

log = get_module_logger(__name__)

AGENTA_RUNTIME_PREFIX = environ.get("AGENTA_RUNTIME_PREFIX", "")

app = FastAPI(
    docs_url=f"{AGENTA_RUNTIME_PREFIX}/docs",  # Swagger UI
    openapi_url=f"{AGENTA_RUNTIME_PREFIX}/openapi.json",  # OpenAPI schema
)

app.include_router(router, prefix=AGENTA_RUNTIME_PREFIX)


class PathValidator(BaseModel):
    url: HttpUrl


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
    ):
        self.config_schema: BaseModel = config_schema
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
    ):
        self.func = func
        self.route_path = route_path
        self.config_schema = config_schema

        signature_parameters = signature(func).parameters
        config, default_parameters = self.parse_config()

        ### --- Middleware --- #
        if not entrypoint._middleware:
            entrypoint._middleware = True
            app.add_middleware(MockMiddleware)
            app.add_middleware(InlineMiddleware)
            app.add_middleware(VaultMiddleware)
            app.add_middleware(ConfigMiddleware)
            app.add_middleware(AuthMiddleware)
            app.add_middleware(OTelMiddleware)
            app.add_middleware(CORSMiddleware)
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
                raise HTTPException(
                    status_code=400,
                    detail="Config not found based on provided references.",
                )

            return await self.execute_wrapper(request, *args, **kwargs)

        self.update_run_wrapper_signature(wrapper=run_wrapper)

        run_route = f"{route_path}{entrypoint._run_path}"
        app.post(
            run_route,
            response_model=BaseResponse,
            response_model_exclude_none=True,
        )(run_wrapper)

        # LEGACY
        # TODO: Removing this implies breaking changes in :
        # - calls to /generate_deployed must be replaced with calls to /run
        if route_path == "":
            run_route = entrypoint._legacy_generate_deployed_path
            app.post(
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
        app.post(
            test_route,
            response_model=BaseResponse,
            response_model_exclude_none=True,
        )(test_wrapper)

        # LEGACY
        # TODO: Removing this implies breaking changes in :
        # - calls to /generate must be replaced with calls to /test
        if route_path == "":
            test_route = entrypoint._legacy_generate_path
            app.post(
                test_route,
                response_model=BaseResponse,
                response_model_exclude_none=True,
            )(test_wrapper)
        # LEGACY

        ### --- OpenAPI --- #
        test_route = f"{route_path}{entrypoint._test_path}"
        entrypoint.routes.append(
            {
                "func": func.__name__,
                "endpoint": test_route,
                "params": signature_parameters,
                "config": config,
            }
        )

        # LEGACY
        if route_path == "":
            test_route = entrypoint._legacy_generate_path
            entrypoint.routes.append(
                {
                    "func": func.__name__,
                    "endpoint": test_route,
                    "params": (
                        {**default_parameters, **signature_parameters}
                        if not config
                        else signature_parameters
                    ),
                    "config": config,
                }
            )
        # LEGACY

        openapi_schema = self.openapi()

        for _route in entrypoint.routes:
            if _route["config"] is not None:
                self.override_config_in_schema(
                    openapi_schema=openapi_schema,
                    func_name=_route["func"],
                    endpoint=_route["endpoint"].replace(AGENTA_RUNTIME_PREFIX, ""),
                    config=_route["config"],
                )

        app.openapi_schema = openapi_schema
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
        request: Request,
        *args,
        **kwargs,
    ):
        if not request:
            raise HTTPException(status_code=500, detail="Missing 'request'.")

        state = request.state
        traceparent = state.otel.get("traceparent")
        baggage = state.otel.get("baggage")
        credentials = state.auth.get("credentials")
        parameters = state.config.get("parameters")
        references = state.config.get("references")
        secrets = state.vault.get("secrets")
        inline = state.inline
        mock = state.mock

        with routing_context_manager(
            context=RoutingContext(
                parameters=parameters,
                secrets=secrets,
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
                    self.handle_failure(error)

    async def handle_success(
        self,
        result: Any,
        inline: bool,
    ):
        data = None
        tree = None
        content_type = "text/plain"
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
            return BaseResponse(
                data=data,
                tree=tree,
                content_type=content_type,
                tree_id=tree_id,
                trace_id=trace_id,
                span_id=span_id,
            )
        except:  # pylint: disable=bare-except
            try:
                return BaseResponse(
                    data=data,
                    content_type=content_type,
                    tree_id=tree_id,
                    trace_id=trace_id,
                    span_id=span_id,
                )
            except:  # pylint: disable=bare-except
                return BaseResponse(
                    data=data,
                    content_type=content_type,
                )

    def handle_failure(
        self,
        error: Exception,
    ):
        display_exception("Application Exception")

        status_code = (
            getattr(error, "status_code") if hasattr(error, "status_code") else 500
        )
        if status_code in [401, 403]:  # Reserved HTTP codes for auth middleware
            status_code = 424  # Proxy Authentication Required

        stacktrace = format_exception(error, value=error, tb=error.__traceback__)  # type: ignore

        raise HTTPException(
            status_code=status_code,
            detail={"message": str(error), "stacktrace": stacktrace},
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
        context = tracing_context.get()

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

        context = tracing_context.get()

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
                annotation=Request,
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
                default=Body(config_instance),  # Use the instance directly
            )
        )

    def add_func_params_to_parser(self, updated_params: list) -> None:
        """Add function parameters to function signature."""
        for name, param in signature(self.func).parameters.items():
            assert (
                len(param.default.__class__.__bases__) == 1
            ), f"Inherited standard type of {param.default.__class__} needs to be one."
            updated_params.append(
                Parameter(
                    name,
                    Parameter.KEYWORD_ONLY,
                    default=Body(..., embed=True),
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
                                    content["schema"][
                                        "$ref"
                                    ] = f"#/components/schemas/{schema_name_map[schema_name]}"

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
                                            content["schema"][
                                                "$ref"
                                            ] = f"#/components/schemas/{schema_name_map[schema_name]}"

            # ✅ Update OpenAPI schema with fixed schemas
            openapi_schema["components"]["schemas"] = updated_schemas

            # ✅ Add Agenta SDK version info
            openapi_schema["agenta_sdk"] = {"version": get_current_version()}

        return openapi_schema

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
