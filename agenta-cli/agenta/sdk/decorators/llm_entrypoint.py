"""The code for the Agenta SDK"""

import os
import sys
import time
import inspect
import argparse
import asyncio
import traceback
import functools
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Callable, Dict, Optional, Tuple, List

from fastapi.middleware.cors import CORSMiddleware
from fastapi import Body, FastAPI, UploadFile, HTTPException

import agenta
from agenta.sdk.context import save_context
from agenta.sdk.router import router as router
from agenta.sdk.tracing.logger import llm_logger as logging
from agenta.sdk.tracing.llm_tracing import Tracing
from agenta.sdk.decorators.base import BaseDecorator
from agenta.sdk.types import (
    Context,
    DictInput,
    FloatParam,
    InFile,
    IntParam,
    MultipleChoiceParam,
    GroupedMultipleChoiceParam,
    TextParam,
    MessagesInput,
    FileInputURL,
    FuncResponse,
    BinaryParam,
)

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

app.include_router(router, prefix="")


from agenta.sdk.utils.debug import debug, DEBUG, SHIFT


logging.setLevel("DEBUG")


class entrypoint(BaseDecorator):
    """Decorator class to wrap a function for HTTP POST, terminal exposure and enable tracing.


    Example:
    ```python
        import agenta as ag

        @ag.entrypoint
        async def chain_of_prompts_llm(prompt: str):
            return ...
    ```
    """

    def __init__(self, func: Callable[..., Any]):
        endpoint_name = "generate"
        func_signature = inspect.signature(func)
        config_params = agenta.config.all()
        ingestible_files = self.extract_ingestible_files(func_signature)

        @debug()
        @functools.wraps(func)
        async def wrapper(*args, **kwargs) -> Any:
            func_params, api_config_params = self.split_kwargs(kwargs, config_params)
            self.ingest_files(func_params, ingestible_files)
            agenta.config.set(**api_config_params)

            # Set the configuration and environment of the LLM app parent span at run-time
            agenta.tracing.update_baggage(
                {"config": config_params, "environment": "playground"}
            )

            # Exceptions are all handled inside self.execute_function()
            llm_result = await self.execute_function(
                func, *args, params=func_params, config_params=config_params
            )

            return llm_result

        @debug()
        @functools.wraps(func)
        async def wrapper_deployed(*args, **kwargs) -> Any:
            func_params = {
                k: v for k, v in kwargs.items() if k not in ["config", "environment"]
            }

            if "environment" in kwargs and kwargs["environment"] is not None:
                agenta.config.pull(environment_name=kwargs["environment"])
            elif "config" in kwargs and kwargs["config"] is not None:
                agenta.config.pull(config_name=kwargs["config"])
            else:
                agenta.config.pull(config_name="default")

            # Set the configuration and environment of the LLM app parent span at run-time
            agenta.tracing.update_baggage(
                {"config": config_params, "environment": kwargs["environment"]}
            )

            llm_result = await self.execute_function(
                func, *args, params=func_params, config_params=config_params
            )

            return llm_result

        self.update_function_signature(
            wrapper, func_signature, config_params, ingestible_files
        )
        route = f"/{endpoint_name}"
        app.post(route, response_model=FuncResponse)(wrapper)

        self.update_deployed_function_signature(
            wrapper_deployed,
            func_signature,
            ingestible_files,
        )
        route_deployed = f"/{endpoint_name}_deployed"
        app.post(route_deployed, response_model=FuncResponse)(wrapper_deployed)
        self.override_schema(
            openapi_schema=app.openapi(),
            func_name=func.__name__,
            endpoint=endpoint_name,
            params={**config_params, **func_signature.parameters},
        )

        if self.is_main_script(func):
            self.handle_terminal_run(
                func,
                func_signature.parameters,  # type: ignore
                config_params,
                ingestible_files,
            )

    def extract_ingestible_files(
        self,
        func_signature: inspect.Signature,
    ) -> Dict[str, inspect.Parameter]:
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
        ingestible_files: Dict[str, inspect.Parameter],
    ) -> None:
        """Ingest files specified in function parameters."""

        for name in ingestible_files:
            if name in func_params and func_params[name] is not None:
                func_params[name] = self.ingest_file(func_params[name])

    async def execute_function(self, func: Callable[..., Any], *args, **func_params):
        """Execute the function and handle any exceptions."""

        try:
            """Note: The following block is for backward compatibility.
            It allows functions to work seamlessly whether they are synchronous or asynchronous.
            For synchronous functions, it calls them directly, while for asynchronous functions,
            it awaits their execution.
            """
            is_coroutine_function = inspect.iscoroutinefunction(func)
            start_time = time.perf_counter()

            if is_coroutine_function:
                result = await func(*args, **func_params["params"])
            else:
                result = func(*args, **func_params["params"])

            end_time = time.perf_counter()
            latency = end_time - start_time

            if isinstance(result, Context):
                save_context(result)
            if isinstance(result, Dict):
                return FuncResponse(**result, latency=round(latency, 4))
            if isinstance(result, str):
                return FuncResponse(
                    message=result, usage=None, cost=None, latency=round(latency, 4)
                )
            if isinstance(result, int) or isinstance(result, float):
                return FuncResponse(
                    message=str(result),
                    usage=None,
                    cost=None,
                    latency=round(latency, 4),
                )
            if result is None:
                return FuncResponse(
                    message="Function executed successfully, but did return None. \n Are you sure you did not forget to return a value?",
                    usage=None,
                    cost=None,
                    latency=round(latency, 4),
                )
        except Exception as e:
            self.handle_exception(e)
        return FuncResponse(message="Unexpected error occurred when calling the @entrypoint decorated function", latency=0)  # type: ignore

    def handle_exception(self, e: Exception):
        """Handle exceptions."""

        status_code: int = e.status_code if hasattr(e, "status_code") else 500
        traceback_str = traceback.format_exception(e, value=e, tb=e.__traceback__)  # type: ignore
        raise HTTPException(
            status_code=status_code,
            detail={"error": str(e), "traceback": "".join(traceback_str)},
        )

    def update_wrapper_signature(
        self, wrapper: Callable[..., Any], updated_params: List
    ):
        """
        Updates the signature of a wrapper function with a new list of parameters.

        Args:
            wrapper (callable): A callable object, such as a function or a method, that requires a signature update.
            updated_params (List[inspect.Parameter]): A list of `inspect.Parameter` objects representing the updated parameters
                for the wrapper function.
        """

        wrapper_signature = inspect.signature(wrapper)
        wrapper_signature = wrapper_signature.replace(parameters=updated_params)
        wrapper.__signature__ = wrapper_signature  # type: ignore

    def update_function_signature(
        self,
        wrapper: Callable[..., Any],
        func_signature: inspect.Signature,
        config_params: Dict[str, Any],
        ingestible_files: Dict[str, inspect.Parameter],
    ) -> None:
        """Update the function signature to include new parameters."""

        updated_params: List[inspect.Parameter] = []
        self.add_config_params_to_parser(updated_params, config_params)
        self.add_func_params_to_parser(updated_params, func_signature, ingestible_files)
        self.update_wrapper_signature(wrapper, updated_params)

    def update_deployed_function_signature(
        self,
        wrapper: Callable[..., Any],
        func_signature: inspect.Signature,
        ingestible_files: Dict[str, inspect.Parameter],
    ) -> None:
        """Update the function signature to include new parameters."""

        updated_params: List[inspect.Parameter] = []
        self.add_func_params_to_parser(updated_params, func_signature, ingestible_files)
        for param in [
            "config",
            "environment",
        ]:  # we add the config and environment parameters
            updated_params.append(
                inspect.Parameter(
                    param,
                    inspect.Parameter.KEYWORD_ONLY,
                    default=Body(None),
                    annotation=str,
                )
            )
        self.update_wrapper_signature(wrapper, updated_params)

    def add_config_params_to_parser(
        self, updated_params: list, config_params: Dict[str, Any]
    ) -> None:
        """Add configuration parameters to function signature."""
        for name, param in config_params.items():
            assert (
                len(param.__class__.__bases__) == 1
            ), f"Inherited standard type of {param.__class__} needs to be one."
            updated_params.append(
                inspect.Parameter(
                    name,
                    inspect.Parameter.KEYWORD_ONLY,
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
        func_signature: inspect.Signature,
        ingestible_files: Dict[str, inspect.Parameter],
    ) -> None:
        """Add function parameters to function signature."""
        for name, param in func_signature.parameters.items():
            if name in ingestible_files:
                updated_params.append(
                    inspect.Parameter(name, param.kind, annotation=UploadFile)
                )
            else:
                assert (
                    len(param.default.__class__.__bases__) == 1
                ), f"Inherited standard type of {param.default.__class__} needs to be one."
                updated_params.append(
                    inspect.Parameter(
                        name,
                        inspect.Parameter.KEYWORD_ONLY,
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
        func_params: Dict[str, inspect.Parameter],
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
        parser = argparse.ArgumentParser()
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

        agenta.config.set(**args_config_params)

        # Set the configuration and environment of the LLM app parent span at run-time
        agenta.tracing.update_baggage(
            {"config": agenta.config.all(), "environment": "bash"}
        )

        loop = asyncio.get_event_loop()
        result = loop.run_until_complete(
            self.execute_function(
                func,
                **{"params": args_func_params, "config_params": args_config_params},
            )
        )
        print(
            f"\n========== Result ==========\n\nMessage: {result.message}\nCost: {result.cost}\nToken Usage: {result.usage}"
        )

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
            func_name (str): The name of the function to override
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

            if isinstance(param_val, MultipleChoiceParam):
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

            if isinstance(param_val, FloatParam):
                subschema = find_in_schema(
                    param_val.__schema_type_properties__(),
                    schema_to_override,
                    param_name,
                    "float",
                )
                subschema["minimum"] = param_val.minval  # type: ignore
                subschema["maximum"] = param_val.maxval  # type: ignore
                subschema["default"] = param_val

            if isinstance(param_val, IntParam):
                subschema = find_in_schema(
                    param_val.__schema_type_properties__(),
                    schema_to_override,
                    param_name,
                    "int",
                )
                subschema["minimum"] = param_val.minval  # type: ignore
                subschema["maximum"] = param_val.maxval  # type: ignore
                subschema["default"] = param_val

            if (
                isinstance(param_val, inspect.Parameter)
                and param_val.annotation is DictInput
            ):
                subschema = find_in_schema(
                    param_val.annotation.__schema_type_properties__(),
                    schema_to_override,
                    param_name,
                    "dict",
                )
                subschema["default"] = param_val.default["default_keys"]

            if isinstance(param_val, TextParam):
                subschema = find_in_schema(
                    param_val.__schema_type_properties__(),
                    schema_to_override,
                    param_name,
                    "text",
                )
                subschema["default"] = param_val

            if (
                isinstance(param_val, inspect.Parameter)
                and param_val.annotation is MessagesInput
            ):
                subschema = find_in_schema(
                    param_val.annotation.__schema_type_properties__(),
                    schema_to_override,
                    param_name,
                    "messages",
                )
                subschema["default"] = param_val.default

            if (
                isinstance(param_val, inspect.Parameter)
                and param_val.annotation is FileInputURL
            ):
                subschema = find_in_schema(
                    param_val.annotation.__schema_type_properties__(),
                    schema_to_override,
                    param_name,
                    "file_url",
                )
                subschema["default"] = "https://example.com"

            if isinstance(param_val, BinaryParam):
                subschema = find_in_schema(
                    param_val.__schema_type_properties__(),
                    schema_to_override,
                    param_name,
                    "bool",
                )
                subschema["default"] = param_val.default  # type: ignore
