"""The code for the Agenta SDK"""
import argparse
import functools
import inspect
import os
import sys
import traceback
from typing import Any, Callable, Optional

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI()

origins = [
    "http://localhost:3000",
    "http://localhost:3001",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TextParam(str):
    @classmethod
    def __modify_schema__(cls, field_schema):
        field_schema.update({"x-parameter": "text"})


class FloatParam(float):
    @classmethod
    def __modify_schema__(cls, field_schema):
        field_schema.update({"x-parameter": "float"})


def post(func: Callable[..., Any]):
    load_dotenv()  # TODO: remove later when we have a better way to inject env variables
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

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        kwargs = {**app_params, **kwargs}
        try:
            return func(*args, **kwargs)
        except Exception as e:
            traceback_str = "".join(
                traceback.format_exception(etype=type(e), value=e, tb=e.__traceback__)
            )
            return JSONResponse(
                status_code=500, content={"error": str(e), "traceback": traceback_str}
            )

    new_params = []
    for name, param in sig.parameters.items():
        if name in app_params:
            new_params.append(
                inspect.Parameter(
                    name,
                    inspect.Parameter.KEYWORD_ONLY,
                    default=app_params[name],
                    annotation=Optional[param.annotation],
                )
            )
        else:
            new_params.append(param)

    wrapper.__signature__ = sig.replace(parameters=new_params)

    route = "/generate"
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
                    f"--{name}", type=type(param.default), default=param.default
                )
            else:
                # For required parameters, we add them as arguments
                parser.add_argument(name, type=param.annotation)

        args = parser.parse_args()
        print(func(**vars(args)))

    return wrapper
