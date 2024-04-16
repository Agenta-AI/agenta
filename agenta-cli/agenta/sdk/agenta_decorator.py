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
from .context import save_context
from .router import router as router
from .types import (
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


def ingest_file(upfile: UploadFile):
    temp_file = NamedTemporaryFile(delete=False)
    temp_file.write(upfile.file.read())
    temp_file.close()
    return InFile(file_name=upfile.filename, file_path=temp_file.name)


def entrypoint(func: Callable[..., Any]) -> Callable[..., Any]:
    """
    Decorator to wrap a function for HTTP POST and terminal exposure.

    Args:
        func: Function to wrap.

    Returns:
        Wrapped function for HTTP POST and terminal.
    """

    endpoint_name = "generate"
    func_signature = inspect.signature(func)
    config_params = agenta.config.all()
    ingestible_files = extract_ingestible_files(func_signature)

    # Initialize tracing
    tracing = agenta.llm_tracing()

    @functools.wraps(func)
    async def wrapper(*args, **kwargs) -> Any:
        func_params, api_config_params = split_kwargs(kwargs, config_params)

        # Start tracing
        tracing.start_parent_span(
            name=func.__name__,
            inputs=func_params,
            config=config_params,
            environment="playground",  # type: ignore #NOTE: wrapper is only called in playground
        )

        # Ingest files, prepare configurations and run llm app
        ingest_files(func_params, ingestible_files)
        agenta.config.set(**api_config_params)
        llm_result = await execute_function(
            func, *args, params=func_params, config_params=config_params
        )

        # End trace recording
        tracing.end_recording(
            outputs=llm_result.dict(),
            span=tracing.active_trace,
        )
        return llm_result

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

        config = agenta.config.all()

        # Start tracing
        tracing.start_parent_span(
            name=func.__name__,
            inputs=func_params,
            config=config,
            environment=kwargs["environment"],  # type: ignore #NOTE: wrapper is only called in playground
        )

        llm_result = await execute_function(
            func, *args, params=func_params, config_params=config_params
        )

        # End trace recording
        tracing.end_recording(
            outputs=llm_result.dict(),
            span=tracing.active_trace,
        )
        return llm_result

    update_function_signature(wrapper, func_signature, config_params, ingestible_files)
    route = f"/{endpoint_name}"
    app.post(route, response_model=FuncResponse)(wrapper)

    update_deployed_function_signature(
        wrapper_deployed,
        func_signature,
        ingestible_files,
    )
    route_deployed = f"/{endpoint_name}_deployed"
    app.post(route_deployed, response_model=FuncResponse)(wrapper_deployed)
    override_schema(
        openapi_schema=app.openapi(),
        func_name=func.__name__,
        endpoint=endpoint_name,
        params={**config_params, **func_signature.parameters},
    )

    if is_main_script(func):
        handle_terminal_run(
            func,
            func_signature.parameters,
            config_params,
            ingestible_files,
        )
    return None


def extract_ingestible_files(
    func_signature: inspect.Signature,
) -> Dict[str, inspect.Parameter]:
    """Extract parameters annotated as InFile from function signature."""

    return {
        name: param
        for name, param in func_signature.parameters.items()
        if param.annotation is InFile
    }


def split_kwargs(
    kwargs: Dict[str, Any], config_params: Dict[str, Any]
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Split keyword arguments into function parameters and API configuration parameters."""

    func_params = {k: v for k, v in kwargs.items() if k not in config_params}
    api_config_params = {k: v for k, v in kwargs.items() if k in config_params}
    return func_params, api_config_params


def ingest_files(
    func_params: Dict[str, Any], ingestible_files: Dict[str, inspect.Parameter]
) -> None:
    """Ingest files specified in function parameters."""

    for name in ingestible_files:
        if name in func_params and func_params[name] is not None:
            func_params[name] = ingest_file(func_params[name])


async def execute_function(func: Callable[..., Any], *args, **func_params):
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
            return FuncResponse(message=result, latency=round(latency, 4))  # type: ignore
    except Exception as e:
        handle_exception(e)
    return FuncResponse(message="Unexpected error occurred", latency=0)  # type: ignore


def handle_exception(e: Exception):
    """Handle exceptions."""

    status_code: int = e.status_code if hasattr(e, "status_code") else 500
    traceback_str = traceback.format_exception(e, value=e, tb=e.__traceback__)  # type: ignore
    raise HTTPException(
        status_code=status_code,
        detail={"error": str(e), "traceback": "".join(traceback_str)},
    )


def update_wrapper_signature(wrapper: Callable[..., Any], updated_params: List):
    """
    Updates the signature of a wrapper function with a new list of parameters.

    Args:
        wrapper (callable): A callable object, such as a function or a method, that requires a signature update.
        updated_params (List[inspect.Parameter]): A list of `inspect.Parameter` objects representing the updated parameters
            for the wrapper function.
    """

    wrapper_signature = inspect.signature(wrapper)
    wrapper_signature = wrapper_signature.replace(parameters=updated_params)
    wrapper.__signature__ = wrapper_signature


def update_function_signature(
    wrapper: Callable[..., Any],
    func_signature: inspect.Signature,
    config_params: Dict[str, Any],
    ingestible_files: Dict[str, inspect.Parameter],
) -> None:
    """Update the function signature to include new parameters."""

    updated_params = []
    add_config_params_to_parser(updated_params, config_params)
    add_func_params_to_parser(updated_params, func_signature, ingestible_files)
    update_wrapper_signature(wrapper, updated_params)


def update_deployed_function_signature(
    wrapper: Callable[..., Any],
    func_signature: inspect.Signature,
    ingestible_files: Dict[str, inspect.Parameter],
) -> None:
    """Update the function signature to include new parameters."""
    updated_params = []
    add_func_params_to_parser(updated_params, func_signature, ingestible_files)
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
    update_wrapper_signature(wrapper, updated_params)


def add_config_params_to_parser(
    updated_params: list, config_params: Dict[str, Any]
) -> None:
    """Add configuration parameters to function signature."""
    for name, param in config_params.items():
        updated_params.append(
            inspect.Parameter(
                name,
                inspect.Parameter.KEYWORD_ONLY,
                default=Body(param),
                annotation=Optional[type(param)],
            )
        )


def add_func_params_to_parser(
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
            updated_params.append(
                inspect.Parameter(
                    name,
                    inspect.Parameter.KEYWORD_ONLY,
                    default=Body(..., embed=True),
                    annotation=param.annotation,
                )
            )


def is_main_script(func: Callable) -> bool:
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
    return (
        os.path.splitext(os.path.basename(sys.argv[0]))[0]
        == os.path.splitext(os.path.basename(inspect.getfile(func)))[0]
    )


def handle_terminal_run(
    func: Callable,
    func_params: Dict[str, Any],
    config_params: Dict[str, Any],
    ingestible_files: Dict,
) -> None:
    """
    Parses command line arguments and sets configuration when script is run from the terminal.

    Args:
        func_params (dict): A dictionary containing the function parameters and their annotations.
        config_params (dict): A dictionary containing the configuration parameters.

    Example:
        handle_terminal_run(func_params=inspect.signature(my_function).parameters, config_params=config.all())
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
                choices=param.choices,
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
    args_func_params = {k: v for k, v in vars(args).items() if k not in config_params}
    for name in ingestible_files:
        args_func_params[name] = InFile(
            file_name=Path(args_func_params[name]).stem,
            file_path=args_func_params[name],
        )
    agenta.config.set(**args_config_params)

    loop = asyncio.get_event_loop()
    result = loop.run_until_complete(
        execute_function(
            func, **{"params": args_func_params, "config_params": args_config_params}
        )
    )
    print(result)


def override_schema(openapi_schema: dict, func_name: str, endpoint: str, params: dict):
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

    def find_in_schema(schema: dict, param_name: str, xparam: str):
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
                and value.get("x-parameter") == xparam
                and value_title == param_name
            ):
                return value

    schema_to_override = openapi_schema["components"]["schemas"][
        f"Body_{func_name}_{endpoint}_post"
    ]["properties"]
    for param_name, param_val in params.items():
        if isinstance(param_val, GroupedMultipleChoiceParam):
            subschema = find_in_schema(schema_to_override, param_name, "grouped_choice")
            assert (
                subschema
            ), f"GroupedMultipleChoiceParam '{param_name}' is in the parameters but could not be found in the openapi.json"
            subschema["choices"] = param_val.choices
            subschema["default"] = param_val.default
        if isinstance(param_val, MultipleChoiceParam):
            subschema = find_in_schema(schema_to_override, param_name, "choice")
            default = str(param_val)
            param_choices = param_val.choices
            choices = (
                [default] + param_choices
                if param_val not in param_choices
                else param_choices
            )
            subschema["enum"] = choices
            subschema["default"] = default if default in param_choices else choices[0]
        if isinstance(param_val, FloatParam):
            subschema = find_in_schema(schema_to_override, param_name, "float")
            subschema["minimum"] = param_val.minval
            subschema["maximum"] = param_val.maxval
            subschema["default"] = param_val
        if isinstance(param_val, IntParam):
            subschema = find_in_schema(schema_to_override, param_name, "int")
            subschema["minimum"] = param_val.minval
            subschema["maximum"] = param_val.maxval
            subschema["default"] = param_val
        if (
            isinstance(param_val, inspect.Parameter)
            and param_val.annotation is DictInput
        ):
            subschema = find_in_schema(schema_to_override, param_name, "dict")
            subschema["default"] = param_val.default["default_keys"]
        if isinstance(param_val, TextParam):
            subschema = find_in_schema(schema_to_override, param_name, "text")
            subschema["default"] = param_val
        if (
            isinstance(param_val, inspect.Parameter)
            and param_val.annotation is MessagesInput
        ):
            subschema = find_in_schema(schema_to_override, param_name, "messages")
            subschema["default"] = param_val.default
        if (
            isinstance(param_val, inspect.Parameter)
            and param_val.annotation is FileInputURL
        ):
            subschema = find_in_schema(schema_to_override, param_name, "file_url")
            subschema["default"] = "https://example.com"
        if isinstance(param_val, BinaryParam):
            subschema = find_in_schema(schema_to_override, param_name, "bool")
            subschema["default"] = param_val.default
