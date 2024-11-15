from typing import Type, Any, Callable, Dict, Optional, Tuple, List
from annotated_types import Ge, Le, Gt, Lt
from pydantic import BaseModel, HttpUrl, ValidationError
from json import dumps
from inspect import signature, iscoroutinefunction, Signature, Parameter, _empty
from argparse import ArgumentParser
from functools import wraps
from asyncio import sleep, get_event_loop
from traceback import format_exc, format_exception
from pathlib import Path
from tempfile import NamedTemporaryFile
from os import environ

from fastapi.middleware.cors import CORSMiddleware
from fastapi import Body, FastAPI, UploadFile, HTTPException

from agenta.sdk.middleware.auth import AuthorizationMiddleware
from agenta.sdk.context.routing import routing_context_manager, routing_context
from agenta.sdk.context.tracing import tracing_context
from agenta.sdk.router import router
from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.utils.logging import log
from agenta.sdk.types import (
    DictInput,
    FloatParam,
    InFile,
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

origins = [
    "*",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_MIDDLEWARES = True


app.include_router(router, prefix="")


log.setLevel("DEBUG")


class PathValidator(BaseModel):
    url: HttpUrl


class route:
    # This decorator is used to expose specific stages of a workflow (embedding, retrieval, summarization, etc.)
    # as independent endpoints. It is designed for backward compatibility with existing code that uses
    # the @entrypoint decorator, which has certain limitations. By using @route(), we can create new
    # routes without altering the main workflow entrypoint. This helps in modularizing the services
    # and provides flexibility in how we expose different functionalities as APIs.
    def __init__(self, path, config_schema: BaseModel):
        self.config_schema: BaseModel = config_schema
        path = "/" + path.strip("/").strip()
        path = "" if path == "/" else path
        PathValidator(url=f"http://example.com{path}")

        self.route_path = path

    def __call__(self, f):
        self.e = entrypoint(
            f, route_path=self.route_path, config_schema=self.config_schema
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

    def __init__(
        self,
        func: Callable[..., Any],
        route_path="",
        config_schema: Optional[BaseModel] = None,
    ):
        ### --- Update Middleware --- #
        try:
            global _MIDDLEWARES  # pylint: disable=global-statement

            if _MIDDLEWARES:
                app.add_middleware(
                    AuthorizationMiddleware,
                    host=ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host,
                    resource_id=ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.app_id,
                    resource_type="application",
                )

                _MIDDLEWARES = False

        except:  # pylint: disable=bare-except
            log.error("------------------------------------")
            log.error("Agenta SDK - failed to secure route: %s", route_path)
            log.error("------------------------------------")
        ### --- Update Middleware --- #

        DEFAULT_PATH = "generate"
        PLAYGROUND_PATH = "/playground"
        RUN_PATH = "/run"
        func_signature = signature(func)
        try:
            config = (
                config_schema() if config_schema else None
            )  # we initialize the config object to be able to use it
        except ValidationError as e:
            raise ValueError(
                f"Error initializing config_schema. Please ensure all required fields have default values: {str(e)}"
            ) from e
        except Exception as e:
            raise ValueError(
                f"Unexpected error initializing config_schema: {str(e)}"
            ) from e

        config_params = config.dict() if config else ag.config.all()
        ingestible_files = self.extract_ingestible_files(func_signature)

        self.route_path = route_path

        ### --- Playground  --- #
        @wraps(func)
        async def wrapper(*args, **kwargs) -> Any:
            func_params, api_config_params = self.split_kwargs(kwargs, config_params)
            self.ingest_files(func_params, ingestible_files)
            if not config_schema:
                ag.config.set(**api_config_params)

            with routing_context_manager(
                config=api_config_params,
            ):
                entrypoint_result = await self.execute_function(
                    func,
                    True,  # inline trace: True
                    *args,
                    params=func_params,
                    config_params=config_params,
                )

            return entrypoint_result

        self.update_function_signature(
            wrapper=wrapper,
            func_signature=func_signature,
            config_class=config,
            config_dict=config_params,
            ingestible_files=ingestible_files,
        )

        #
        if route_path == "":
            route = f"/{DEFAULT_PATH}"
            app.post(route, response_model=BaseResponse)(wrapper)
            entrypoint.routes.append(
                {
                    "func": func.__name__,
                    "endpoint": route,
                    "params": (
                        {**config_params, **func_signature.parameters}
                        if not config
                        else func_signature.parameters
                    ),
                    "config": config,
                }
            )

        route = f"{PLAYGROUND_PATH}{RUN_PATH}{route_path}"
        app.post(route, response_model=BaseResponse)(wrapper)
        entrypoint.routes.append(
            {
                "func": func.__name__,
                "endpoint": route,
                "params": (
                    {**config_params, **func_signature.parameters}
                    if not config
                    else func_signature.parameters
                ),
                "config": config,
            }
        )
        ### ---------------------------- #

        ### --- Deployed --- #
        @wraps(func)
        async def wrapper_deployed(*args, **kwargs) -> Any:
            func_params = {
                k: v
                for k, v in kwargs.items()
                if k not in ["config", "environment", "app"]
            }
            if not config_schema:
                if "environment" in kwargs and kwargs["environment"] is not None:
                    ag.config.pull(environment_name=kwargs["environment"])
                elif "config" in kwargs and kwargs["config"] is not None:
                    ag.config.pull(config_name=kwargs["config"])
                else:
                    ag.config.pull(config_name="default")

            app_id = environ.get("AGENTA_APP_ID")

            with routing_context_manager(
                application={
                    "id": app_id,
                    "slug": kwargs.get("app"),
                },
                variant={
                    "slug": kwargs.get("config"),
                },
                environment={
                    "slug": kwargs.get("environment"),
                },
            ):
                entrypoint_result = await self.execute_function(
                    func,
                    False,  # inline trace: False
                    *args,
                    params=func_params,
                    config_params=config_params,
                )

            return entrypoint_result

        self.update_deployed_function_signature(
            wrapper_deployed,
            func_signature,
            ingestible_files,
        )
        if route_path == "":
            route_deployed = f"/{DEFAULT_PATH}_deployed"
            app.post(route_deployed, response_model=BaseResponse)(wrapper_deployed)

        route_deployed = f"{RUN_PATH}{route_path}"
        app.post(route_deployed, response_model=BaseResponse)(wrapper_deployed)
        ### ---------------- #

        ### --- Update OpenAPI --- #
        app.openapi_schema = None  # Forces FastAPI to re-generate the schema
        openapi_schema = app.openapi()

        for route in entrypoint.routes:
            self.override_schema(
                openapi_schema=openapi_schema,
                func_name=route["func"],
                endpoint=route["endpoint"],
                params=route["params"],
            )
            if route["config"] is not None:  # new SDK version
                self.override_config_in_schema(
                    openapi_schema=openapi_schema,
                    func_name=route["func"],
                    endpoint=route["endpoint"],
                    config=route["config"],
                )

        if self.is_main_script(func) and route_path == "":
            self.handle_terminal_run(
                func,
                func_signature.parameters,  # type: ignore
                config_params,
                ingestible_files,
            )

    def extract_ingestible_files(
        self,
        func_signature: Signature,
    ) -> Dict[str, Parameter]:
        """Extract parameters annotated as InFile from function signature."""

        return {
            name: param
            for name, param in func_signature.parameters.items()
            if param.annotation is InFile
        }

    def split_kwargs(
        self, kwargs: Dict[str, Any], config_params: Dict[str, Any]
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """Split keyword arguments into function parameters and API configuration parameters."""

        func_params = {k: v for k, v in kwargs.items() if k not in config_params}
        api_config_params = {k: v for k, v in kwargs.items() if k in config_params}
        return func_params, api_config_params

    def ingest_file(self, upfile: UploadFile):
        temp_file = NamedTemporaryFile(delete=False)
        temp_file.write(upfile.file.read())
        temp_file.close()
        return InFile(file_name=upfile.filename, file_path=temp_file.name)

    def ingest_files(
        self,
        func_params: Dict[str, Any],
        ingestible_files: Dict[str, Parameter],
    ) -> None:
        """Ingest files specified in function parameters."""

        for name in ingestible_files:
            if name in func_params and func_params[name] is not None:
                func_params[name] = self.ingest_file(func_params[name])

    async def execute_function(
        self,
        func: Callable[..., Any],
        inline_trace,
        *args,
        **func_params,
    ):
        log.info("---------------------------")
        log.info(f"Agenta SDK - running route: {repr(self.route_path or '/')}")
        log.info("---------------------------")

        tracing_context.set(routing_context.get())

        try:
            result = (
                await func(*args, **func_params["params"])
                if iscoroutinefunction(func)
                else func(*args, **func_params["params"])
            )

            return await self.handle_success(result, inline_trace)

        except Exception as error:
            self.handle_failure(error)

    async def handle_success(self, result: Any, inline_trace: bool):
        data = None
        trace = dict()

        with suppress():
            data = self.patch_result(result)

            if inline_trace:
                trace = await self.fetch_inline_trace(inline_trace)

        log.info(f"----------------------------------")
        log.info(f"Agenta SDK - exiting with success: 200")
        log.info(f"----------------------------------")

        return BaseResponse(data=data, trace=trace)

    def handle_failure(self, error: Exception):
        log.error("--------------------------------------------------")
        log.error("Agenta SDK - handling application exception below:")
        log.error("--------------------------------------------------")
        log.error(format_exc().strip("\n"))
        log.error("--------------------------------------------------")

        status_code = error.status_code if hasattr(error, "status_code") else 500
        message = str(error)
        stacktrace = format_exception(error, value=error, tb=error.__traceback__)  # type: ignore
        detail = {"message": message, "stacktrace": stacktrace}

        log.error(f"----------------------------------")
        log.error(f"Agenta SDK - exiting with failure: {status_code}")
        log.error(f"----------------------------------")

        raise HTTPException(status_code=status_code, detail=detail)

    def patch_result(self, result: Any):
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

    async def fetch_inline_trace(self, inline_trace):
        WAIT_FOR_SPANS = True
        TIMEOUT = 1
        TIMESTEP = 0.1
        FINALSTEP = 0.001
        NOFSTEPS = TIMEOUT / TIMESTEP

        trace = None

        root_context: Dict[str, Any] = tracing_context.get().get("root")

        trace_id = root_context.get("trace_id") if root_context else None

        if trace_id is not None:
            if inline_trace:
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

    def update_function_signature(
        self,
        wrapper: Callable[..., Any],
        func_signature: Signature,
        config_class: Type[BaseModel],  # TODO: change to our type
        config_dict: Dict[str, Any],
        ingestible_files: Dict[str, Parameter],
    ) -> None:
        """Update the function signature to include new parameters."""

        updated_params: List[Parameter] = []
        if config_class:
            self.add_config_params_to_parser(updated_params, config_class)
        else:
            self.deprecated_add_config_params_to_parser(updated_params, config_dict)
        self.add_func_params_to_parser(updated_params, func_signature, ingestible_files)
        self.update_wrapper_signature(wrapper, updated_params)

    def update_deployed_function_signature(
        self,
        wrapper: Callable[..., Any],
        func_signature: Signature,
        ingestible_files: Dict[str, Parameter],
    ) -> None:
        """Update the function signature to include new parameters."""

        updated_params: List[Parameter] = []
        self.add_func_params_to_parser(updated_params, func_signature, ingestible_files)
        for param in [
            "config",
            "environment",
        ]:  # we add the config and environment parameters
            updated_params.append(
                Parameter(
                    name=param,
                    kind=Parameter.KEYWORD_ONLY,
                    default=Body(None),
                    annotation=str,
                )
            )
        self.update_wrapper_signature(wrapper, updated_params)

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

    def add_func_params_to_parser(
        self,
        updated_params: list,
        func_signature: Signature,
        ingestible_files: Dict[str, Parameter],
    ) -> None:
        """Add function parameters to function signature."""
        for name, param in func_signature.parameters.items():
            if name in ingestible_files:
                updated_params.append(
                    Parameter(name, param.kind, annotation=UploadFile)
                )
            else:
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

    def is_main_script(self, func: Callable) -> bool:
        """
        Check if the script containing the function is the main script being run.

        Args:
            func (Callable): The function object to check.

        Returns:
            bool: True if the script containing the function is the main script, False otherwise.

        Example:
            if is_main_script(my_function):
                print("This is the main script.")
        """
        return func.__module__ == "__main__"

    def handle_terminal_run(
        self,
        func: Callable,
        func_params: Dict[str, Parameter],
        config_params: Dict[str, Any],
        ingestible_files: Dict,
    ):
        """
        Parses command line arguments and sets configuration when script is run from the terminal.

        Args:
            func_params (dict): A dictionary containing the function parameters and their annotations.
            config_params (dict): A dictionary containing the configuration parameters.
            ingestible_files (dict): A dictionary containing the files that should be ingested.
        """

        # For required parameters, we add them as arguments
        parser = ArgumentParser()
        for name, param in func_params.items():
            if name in ingestible_files:
                parser.add_argument(name, type=str)
            else:
                parser.add_argument(name, type=param.annotation)

        for name, param in config_params.items():
            if type(param) is MultipleChoiceParam:
                parser.add_argument(
                    f"--{name}",
                    type=str,
                    default=param.default,
                    choices=param.choices,  # type: ignore
                )
            else:
                parser.add_argument(
                    f"--{name}",
                    type=type(param),
                    default=param,
                )

        args = parser.parse_args()

        # split the arg list into the arg in the app_param and
        # the args from the sig.parameter
        args_config_params = {k: v for k, v in vars(args).items() if k in config_params}
        args_func_params = {
            k: v for k, v in vars(args).items() if k not in config_params
        }
        for name in ingestible_files:
            args_func_params[name] = InFile(
                file_name=Path(args_func_params[name]).stem,
                file_path=args_func_params[name],
            )

        # Update args_config_params with default values from config_params if not provided in command line arguments
        args_config_params.update(
            {
                key: value
                for key, value in config_params.items()
                if key not in args_config_params
            }
        )

        loop = get_event_loop()

        with routing_context_manager(
            config=args_config_params,
            environment="terminal",
        ):
            result = loop.run_until_complete(
                self.execute_function(
                    func,
                    True,  # inline trace: True
                    **{"params": args_func_params, "config_params": args_config_params},
                )
            )

        SHOW_DETAILS = True
        SHOW_DATA = False
        SHOW_TRACE = False

        if result.trace:
            log.info("\n========= Result =========\n")

            log.info(f"trace_id: {result.trace['trace_id']}")
            if SHOW_DETAILS:
                log.info(f"latency:  {result.trace.get('latency')}")
                log.info(f"cost:     {result.trace.get('cost')}")
                log.info(f"usage:   {list(result.trace.get('usage', {}).values())}")

            if SHOW_DATA:
                log.info(" ")
                log.info(f"data:")
                log.info(dumps(result.data, indent=2))

            if SHOW_TRACE:
                log.info(" ")
                log.info(f"trace:")
                log.info(f"----------------")
                log.info(dumps(result.trace.get("spans", []), indent=2))
                log.info(f"----------------")

            log.info("\n==========================\n")

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

    def override_schema(
        self, openapi_schema: dict, func_name: str, endpoint: str, params: dict
    ):
        """
        Overrides the default openai schema generated by fastapi with additional information about:
        - The choices available for each MultipleChoiceParam instance
        - The min and max values for each FloatParam instance
        - The min and max values for each IntParam instance
        - The default value for DictInput instance
        - The default value for MessagesParam instance
        - The default value for FileInputURL instance
        - The default value for BinaryParam instance
        - ... [PLEASE ADD AT EACH CHANGE]

        Args:
            openapi_schema (dict): The openapi schema generated by fastapi
            func (str): The name of the function to override
            endpoint (str): The name of the endpoint to override
            params (dict(param_name, param_val)): The dictionary of the parameters for the function
        """

        def find_in_schema(
            schema_type_properties: dict, schema: dict, param_name: str, xparam: str
        ):
            """Finds a parameter in the schema based on its name and x-parameter value"""
            for _, value in schema.items():
                value_title_lower = str(value.get("title")).lower()
                value_title = (
                    "_".join(value_title_lower.split())
                    if len(value_title_lower.split()) >= 2
                    else value_title_lower
                )

                if (
                    isinstance(value, dict)
                    and schema_type_properties.get("x-parameter") == xparam
                    and value_title == param_name
                ):
                    # this will update the default type schema with the properties gotten
                    # from the schema type (param_val) __schema_properties__ classmethod
                    for type_key, type_value in schema_type_properties.items():
                        # BEFORE:
                        # value = {'temperature': {'title': 'Temperature'}}
                        value[type_key] = type_value
                        # AFTER:
                        # value = {'temperature': { "type": "number", "title": "Temperature", "x-parameter": "float" }}
                    return value

        def get_type_from_param(param_val):
            param_type = "string"
            annotation = param_val.annotation

            if annotation == int:
                param_type = "integer"
            elif annotation == float:
                param_type = "number"
            elif annotation == dict:
                param_type = "object"
            elif annotation == bool:
                param_type = "boolean"
            elif annotation == list:
                param_type = "list"
            elif annotation == str:
                param_type = "string"
            else:
                print("ERROR, unhandled annotation:", annotation)

            return param_type

        # Goes from '/some/path' to 'some_path'
        endpoint = endpoint[1:].replace("/", "_")

        schema_to_override = openapi_schema["components"]["schemas"][
            f"Body_{func_name}_{endpoint}_post"
        ]["properties"]

        for param_name, param_val in params.items():
            if isinstance(param_val, GroupedMultipleChoiceParam):
                subschema = find_in_schema(
                    param_val.__schema_type_properties__(),
                    schema_to_override,
                    param_name,
                    "grouped_choice",
                )
                assert (
                    subschema
                ), f"GroupedMultipleChoiceParam '{param_name}' is in the parameters but could not be found in the openapi.json"
                subschema["choices"] = param_val.choices  # type: ignore
                subschema["default"] = param_val.default  # type: ignore

            elif isinstance(param_val, MultipleChoiceParam):
                subschema = find_in_schema(
                    param_val.__schema_type_properties__(),
                    schema_to_override,
                    param_name,
                    "choice",
                )
                default = str(param_val)
                param_choices = param_val.choices  # type: ignore
                choices = (
                    [default] + param_choices
                    if param_val not in param_choices
                    else param_choices
                )
                subschema["enum"] = choices
                subschema["default"] = (
                    default if default in param_choices else choices[0]
                )

            elif isinstance(param_val, FloatParam):
                subschema = find_in_schema(
                    param_val.__schema_type_properties__(),
                    schema_to_override,
                    param_name,
                    "float",
                )
                subschema["minimum"] = param_val.minval  # type: ignore
                subschema["maximum"] = param_val.maxval  # type: ignore
                subschema["default"] = param_val

            elif isinstance(param_val, IntParam):
                subschema = find_in_schema(
                    param_val.__schema_type_properties__(),
                    schema_to_override,
                    param_name,
                    "int",
                )
                subschema["minimum"] = param_val.minval  # type: ignore
                subschema["maximum"] = param_val.maxval  # type: ignore
                subschema["default"] = param_val

            elif isinstance(param_val, Parameter) and param_val.annotation is DictInput:
                subschema = find_in_schema(
                    param_val.annotation.__schema_type_properties__(),
                    schema_to_override,
                    param_name,
                    "dict",
                )
                subschema["default"] = param_val.default["default_keys"]

            elif isinstance(param_val, TextParam):
                subschema = find_in_schema(
                    param_val.__schema_type_properties__(),
                    schema_to_override,
                    param_name,
                    "text",
                )
                subschema["default"] = param_val

            elif (
                isinstance(param_val, Parameter)
                and param_val.annotation is MessagesInput
            ):
                subschema = find_in_schema(
                    param_val.annotation.__schema_type_properties__(),
                    schema_to_override,
                    param_name,
                    "messages",
                )
                subschema["default"] = param_val.default

            elif (
                isinstance(param_val, Parameter)
                and param_val.annotation is FileInputURL
            ):
                subschema = find_in_schema(
                    param_val.annotation.__schema_type_properties__(),
                    schema_to_override,
                    param_name,
                    "file_url",
                )
                subschema["default"] = "https://example.com"

            elif isinstance(param_val, BinaryParam):
                subschema = find_in_schema(
                    param_val.__schema_type_properties__(),
                    schema_to_override,
                    param_name,
                    "bool",
                )
                subschema["default"] = param_val.default  # type: ignore
            else:
                subschema = {
                    "title": str(param_name).capitalize(),
                    "type": get_type_from_param(param_val),
                }
                if param_val.default != _empty:
                    subschema["default"] = param_val.default  # type: ignore
                schema_to_override[param_name] = subschema
