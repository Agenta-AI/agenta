"""The code for the Agenta SDK"""
import argparse
import functools
import inspect
import os
import sys
import traceback
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Callable, Optional

from fastapi import Depends, FastAPI, UploadFile, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .context import get_contexts, save_context
from .types import (
    FloatParam,
    InFile,
    TextParam,
    Context,
    MultipleChoiceParam,
    DictInput,
    IntParam,
)
from .router import router as router

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


def ingest(func: Callable[..., Any]):
    sig = inspect.signature(func)
    func_params = sig.parameters

    # find the optional parameters for the app
    app_params = {
        name: param
        for name, param in func_params.items()
        if param.annotation in {TextParam, FloatParam}
    }
    # find the default values for the optional parameters
    for name, param in app_params.items():
        default_value = param.default if param.default is not param.empty else None
        app_params[name] = default_value

    ingestible_files = {
        name: param for name, param in func_params.items() if param.annotation is InFile
    }

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        for name in ingestible_files:
            if name in kwargs and kwargs[name] is not None:
                kwargs[name] = ingest_file(kwargs[name])
        try:
            return func(*args, **kwargs)
        except Exception as e:
            traceback_str = "".join(
                traceback.format_exception(None, e, e.__traceback__)
            )
            return JSONResponse(
                status_code=500,
                content={"error": str(e), "traceback": traceback_str},
            )

    new_params = []
    for name, param in sig.parameters.items():
        if name in app_params:
            new_params.append(
                inspect.Parameter(
                    name,
                    inspect.Parameter.KEYWORD_ONLY,
                    default=Body(app_params[name]),
                    annotation=Optional[param.annotation],
                )
            )
        elif name in ingestible_files:
            new_params.append(
                inspect.Parameter(name, param.kind, annotation=UploadFile)
            )
        else:
            new_params.append(
                inspect.Parameter(
                    name,
                    inspect.Parameter.KEYWORD_ONLY,
                    default=Body(...),
                    annotation=param.annotation,
                )
            )

    wrapper.__signature__ = sig.replace(parameters=new_params)

    route = "/ingest"
    app.post(route)(wrapper)

    # check if the module is being run as the main script
    if (
        os.path.splitext(os.path.basename(sys.argv[0]))[0]
        == os.path.splitext(os.path.basename(inspect.getfile(func)))[0]
    ):
        parser = argparse.ArgumentParser()
        # add arguments to the command-line parser
        for name, param in sig.parameters.items():
            if name in app_params:
                # For optional parameters, we add them as options
                parser.add_argument(
                    f"--{name}",
                    type=type(param.default),
                    default=param.default,
                )
            elif name in ingestible_files:
                parser.add_argument(name, type=str)
            else:
                # For required parameters, we add them as arguments
                parser.add_argument(name, type=param.annotation)

        args = parser.parse_args()
        args_dict = vars(args)
        for name in ingestible_files:
            args_dict[name] = InFile(
                file_name=Path(args_dict[name]).stem, file_path=args_dict[name]
            )
        print(func(**vars(args)))

    return wrapper


def post(func: Callable[..., Any]):
    endpoint_name = "generate"
    sig = inspect.signature(func)
    func_params = sig.parameters

    # determin the optional parameters for the app and save their default values
    app_params = {
        name: param.default if param.default is not param.empty else None
        for name, param in func_params.items()
        if param.annotation
        in {TextParam, FloatParam, IntParam, DictInput, MultipleChoiceParam}
    }

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        kwargs = {**app_params, **kwargs}
        try:
            result = func(*args, **kwargs)
            if isinstance(result, Context):
                save_context(result)
            return result
        except Exception as e:
            if sys.version_info.major == 3 and sys.version_info.minor < 10:
                traceback_str = "".join(
                    traceback.format_exception(None, e, e.__traceback__)
                )
            else:
                traceback_str = "".join(
                    traceback.format_exception(e, value=e, tb=e.__traceback__)
                )
            return JSONResponse(
                status_code=500,
                content={"error": str(e), "traceback": traceback_str},
            )

    new_params = []
    for name, param in sig.parameters.items():
        if name in app_params:  # optional parameters
            new_params.append(
                inspect.Parameter(
                    name,
                    inspect.Parameter.KEYWORD_ONLY,
                    default=Body(app_params[name]),
                    annotation=Optional[param.annotation],
                )
            )
        else:  # required parameters
            new_params.append(
                inspect.Parameter(
                    name,
                    inspect.Parameter.KEYWORD_ONLY,
                    default=Body(...),
                    annotation=param.annotation,
                )
            )

    wrapper.__signature__ = sig.replace(parameters=new_params)

    route = f"/{endpoint_name}"
    app.post(route)(wrapper)
    override_schema(
        openapi_schema=app.openapi(),
        func_name=func.__name__,
        endpoint=endpoint_name,
        app_params=app_params,
    )

    # check if the module is being run as the main script
    if (
        os.path.splitext(os.path.basename(sys.argv[0]))[0]
        == os.path.splitext(os.path.basename(inspect.getfile(func)))[0]
    ):
        parser = argparse.ArgumentParser()
        # add arguments to the command-line parser
        for name, param in sig.parameters.items():
            if name in app_params:
                if param.annotation is MultipleChoiceParam:
                    parser.add_argument(
                        f"--{name}",
                        type=str,
                        default=param.default,
                        choices=param.default.choices,
                    )
                else:
                    parser.add_argument(
                        f"--{name}",
                        type=type(param.default),
                        default=param.default,
                    )
            else:
                # For required parameters, we add them as arguments
                parser.add_argument(name, type=param.annotation)

        args = parser.parse_args()
        print(func(**vars(args)))

    return wrapper


def override_schema(
    openapi_schema: dict, func_name: str, endpoint: str, app_params: dict
):
    """
    Overrides the default openai schema generated by fastapi with additional information about:
    - The choices available for each MultipleChoiceParam instance
    - The min and max values for each FloatParam instance
    - The min and max values for each IntParam instance
    - The default value for DictInput instance
    - ... [PLEASE ADD AT EACH CHANGE]

    Args:
        openapi_schema (dict): The openapi schema generated by fastapi
        func_name (str): The name of the function to override
        endpoint (str): The name of the endpoint to override
        app_params (dict(param_name, param_val)): The dictionary of optional parameters for the function
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
    for param_name, param_val in app_params.items():
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
        if isinstance(param_val, DictInput):
            subschema = find_in_schema(schema_to_override, param_name, "dict")
            subschema["default"] = param_val.data
