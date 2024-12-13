from typing import Type, Any, Callable, Dict, Optional, Tuple, List
from inspect import signature, iscoroutinefunction, Signature, Parameter, _empty
from functools import wraps
from traceback import format_exception
from asyncio import sleep

from tempfile import NamedTemporaryFile
from annotated_types import Ge, Le, Gt, Lt
from pydantic import BaseModel, HttpUrl, ValidationError

from fastapi import Body, FastAPI, UploadFile, HTTPException, Request

from agenta.sdk.middleware.auth import AuthMiddleware
from agenta.sdk.middleware.otel import OTelMiddleware
from agenta.sdk.middleware.config import ConfigMiddleware
from agenta.sdk.middleware.vault import VaultMiddleware
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
from agenta.sdk.utils.logging import log
from agenta.sdk.types import (
    DictInput,
    FloatParam,
    IntParam,
    MultipleChoiceParam,
    MultipleChoice,
    GroupedMultipleChoiceParam,
    TextParam,
    MessagesInput,
    FileInputURL,
    BaseResponse,
    BinaryParam,
)

import agenta as ag


app = FastAPI()
log.setLevel("DEBUG")


app.include_router(router, prefix="")


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
    _run_path = "/run"
    _test_path = "/test"
    # LEGACY
    _legacy_playground_run_path = "/playground/run"
    _legacy_generate_path = "/generate"
    _legacy_generate_deployed_path = "/generate_deployed"

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

            if request.state.config["parameters"] is None:
                raise HTTPException(
                    status_code=400,
                    detail="Config not found based on provided references.",
                )

            kwargs, _ = self.split_kwargs(kwargs, default_parameters)

            return await self.execute_wrapper(request, False, *args, **kwargs)

        self.update_run_wrapper_signature(wrapper=run_wrapper)

        run_route = f"{entrypoint._run_path}{route_path}"
        app.post(run_route, response_model=BaseResponse)(run_wrapper)

        # LEGACY
        # TODO: Removing this implies breaking changes in :
        # - calls to /generate_deployed must be replaced with calls to /run
        if route_path == "":
            run_route = entrypoint._legacy_generate_deployed_path
            app.post(run_route, response_model=BaseResponse)(run_wrapper)
        # LEGACY
        ### ----------- #

        ### --- Test --- #
        @wraps(func)
        async def test_wrapper(request: Request, *args, **kwargs) -> Any:
            kwargs, parameters = self.split_kwargs(kwargs, default_parameters)

            request.state.config["parameters"] = parameters

            return await self.execute_wrapper(request, True, *args, **kwargs)

        self.update_test_wrapper_signature(
            wrapper=test_wrapper,
            config_class=config,
            config_dict=default_parameters,
        )

        test_route = f"{entrypoint._test_path}{route_path}"
        app.post(test_route, response_model=BaseResponse)(test_wrapper)

        # LEGACY
        # TODO: Removing this implies breaking changes in :
        # - calls to /generate must be replaced with calls to /test
        if route_path == "":
            test_route = entrypoint._legacy_generate_path
            app.post(test_route, response_model=BaseResponse)(test_wrapper)
        # LEGACY

        # LEGACY
        # TODO: Removing this implies no breaking changes
        if route_path == "":
            test_route = entrypoint._legacy_playground_run_path
            app.post(test_route, response_model=BaseResponse)(test_wrapper)
        # LEGACY
        ### ------------ #

        ### --- OpenAPI --- #
        test_route = f"{entrypoint._test_path}{route_path}"
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

        app.openapi_schema = None  # Forces FastAPI to re-generate the schema
        openapi_schema = app.openapi()

        for _route in entrypoint.routes:
            if _route["config"] is not None:
                self.override_config_in_schema(
                    openapi_schema=openapi_schema,
                    func_name=_route["func"],
                    endpoint=_route["endpoint"],
                    config=_route["config"],
                )
        ### --------------- #

    def parse_config(self) -> Dict[str, Any]:
        config = None
        default_parameters = ag.config.all()

        if self.config_schema:
            try:
                config = self.config_schema() if self.config_schema else None
                default_parameters = config.dict() if config else default_parameters
            except ValidationError as e:
                raise ValueError(
                    f"Error initializing config_schema. Please ensure all required fields have default values: {str(e)}"
                ) from e
            except Exception as e:
                raise ValueError(
                    f"Unexpected error initializing config_schema: {str(e)}"
                ) from e

        return config, default_parameters

    def split_kwargs(
        self, kwargs: Dict[str, Any], default_parameters: Dict[str, Any]
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        arguments = {k: v for k, v in kwargs.items() if k not in default_parameters}
        parameters = {k: v for k, v in kwargs.items() if k in default_parameters}

        return arguments, parameters

    async def execute_wrapper(
        self,
        request: Request,
        inline: bool,
        *args,
        **kwargs,
    ):
        if not request:
            raise HTTPException(status_code=500, detail="Missing 'request'.")

        state = request.state
        credentials = state.auth.get("credentials")
        parameters = state.config.get("parameters")
        references = state.config.get("references")
        secrets = state.vault.get("secrets")

        with routing_context_manager(
            context=RoutingContext(
                parameters=parameters,
                secrets=secrets,
            )
        ):
            with tracing_context_manager(
                context=TracingContext(
                    credentials=credentials,
                    parameters=parameters,
                    references=references,
                )
            ):
                result = await self.execute_function(inline, *args, **kwargs)

        return result

    async def execute_function(
        self,
        inline: bool,
        *args,
        **kwargs,
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

        with suppress():
            data = self.patch_result(result)

            if inline:
                tree = await self.fetch_inline_trace(inline)

        try:
            return BaseResponse(data=data, tree=tree)
        except:
            return BaseResponse(data=data)

    def handle_failure(
        self,
        error: Exception,
    ):
        display_exception("Application Exception")

        status_code = 500
        message = str(error)
        stacktrace = format_exception(error, value=error, tb=error.__traceback__)  # type: ignore
        detail = {"message": message, "stacktrace": stacktrace}

        raise HTTPException(status_code=status_code, detail=detail)

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

    async def fetch_inline_trace(
        self,
        inline,
    ):
        WAIT_FOR_SPANS = True
        TIMEOUT = 1
        TIMESTEP = 0.1
        FINALSTEP = 0.001
        NOFSTEPS = TIMEOUT / TIMESTEP

        trace = None

        context = tracing_context.get()

        link = context.link

        trace_id = link.get("tree_id") if link else None

        if trace_id is not None:
            if inline:
                if WAIT_FOR_SPANS:
                    remaining_steps = NOFSTEPS

                    while (
                        not ag.tracing.is_inline_trace_ready(trace_id)
                        and remaining_steps > 0
                    ):
                        await sleep(TIMESTEP)

                        remaining_steps -= 1

                    await sleep(FINALSTEP)

                trace = ag.tracing.get_inline_trace(trace_id)
            else:
                trace = {"trace_id": trace_id}

        return trace

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
        config_class: Type[BaseModel],  # TODO: change to our type
        config_dict: Dict[str, Any],
    ) -> None:
        """Update the function signature to include new parameters."""

        updated_params: List[Parameter] = []
        if config_class:
            self.add_config_params_to_parser(updated_params, config_class)
        else:
            self.deprecated_add_config_params_to_parser(updated_params, config_dict)
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
        self, updated_params: list, config_class: Type[BaseModel]
    ) -> None:
        """Add configuration parameters to function signature."""
        for name, field in config_class.__fields__.items():
            assert field.default is not None, f"Field {name} has no default value"
            updated_params.append(
                Parameter(
                    name=name,
                    kind=Parameter.KEYWORD_ONLY,
                    annotation=field.annotation.__name__,
                    default=Body(field.default),
                )
            )

    def deprecated_add_config_params_to_parser(
        self, updated_params: list, config_dict: Dict[str, Any]
    ) -> None:
        """Add configuration parameters to function signature."""
        for name, param in config_dict.items():
            assert (
                len(param.__class__.__bases__) == 1
            ), f"Inherited standard type of {param.__class__} needs to be one."
            updated_params.append(
                Parameter(
                    name=name,
                    kind=Parameter.KEYWORD_ONLY,
                    default=Body(param),
                    annotation=param.__class__.__bases__[
                        0
                    ],  # determines and get the base (parent/inheritance) type of the sdk-type at run-time. \
                    # E.g __class__ is ag.MessagesInput() and accessing it parent type will return (<class 'list'>,), \
                    # thus, why we are accessing the first item.
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

    def override_config_in_schema(
        self,
        openapi_schema: dict,
        func_name: str,
        endpoint: str,
        config: Type[BaseModel],
    ):
        endpoint = endpoint[1:].replace("/", "_")
        schema_to_override = openapi_schema["components"]["schemas"][
            f"Body_{func_name}_{endpoint}_post"
        ]["properties"]
        # New logic
        for param_name, param_val in config.__fields__.items():
            if param_val.annotation is str:
                if any(
                    isinstance(constraint, MultipleChoice)
                    for constraint in param_val.metadata
                ):
                    choices = next(
                        constraint.choices
                        for constraint in param_val.metadata
                        if isinstance(constraint, MultipleChoice)
                    )
                    if isinstance(choices, dict):
                        schema_to_override[param_name]["x-parameter"] = "grouped_choice"
                        schema_to_override[param_name]["choices"] = choices
                    elif isinstance(choices, list):
                        schema_to_override[param_name]["x-parameter"] = "choice"
                        schema_to_override[param_name]["enum"] = choices
                else:
                    schema_to_override[param_name]["x-parameter"] = "text"
            if param_val.annotation is bool:
                schema_to_override[param_name]["x-parameter"] = "bool"
            if param_val.annotation in (int, float):
                schema_to_override[param_name]["x-parameter"] = (
                    "int" if param_val.annotation is int else "float"
                )
                # Check for greater than or equal to constraint
                if any(isinstance(constraint, Ge) for constraint in param_val.metadata):
                    min_value = next(
                        constraint.ge
                        for constraint in param_val.metadata
                        if isinstance(constraint, Ge)
                    )
                    schema_to_override[param_name]["minimum"] = min_value
                # Check for greater than constraint
                elif any(
                    isinstance(constraint, Gt) for constraint in param_val.metadata
                ):
                    min_value = next(
                        constraint.gt
                        for constraint in param_val.metadata
                        if isinstance(constraint, Gt)
                    )
                    schema_to_override[param_name]["exclusiveMinimum"] = min_value
                # Check for less than or equal to constraint
                if any(isinstance(constraint, Le) for constraint in param_val.metadata):
                    max_value = next(
                        constraint.le
                        for constraint in param_val.metadata
                        if isinstance(constraint, Le)
                    )
                    schema_to_override[param_name]["maximum"] = max_value
                # Check for less than constraint
                elif any(
                    isinstance(constraint, Lt) for constraint in param_val.metadata
                ):
                    max_value = next(
                        constraint.lt
                        for constraint in param_val.metadata
                        if isinstance(constraint, Lt)
                    )
                    schema_to_override[param_name]["exclusiveMaximum"] = max_value
