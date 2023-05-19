from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Callable, Any, Optional
import functools
import inspect

app = FastAPI()

origins = [
    "http://localhost:3000",
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
    sig = inspect.signature(func)
    func_params = sig.parameters

    app_params = {name: param.default for name, param in func_params.items()
                  if isinstance(param.default, (TextParam, FloatParam))}

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        kwargs = {**app_params, **kwargs}
        return func(*args, **kwargs)

    new_params = []
    for name, param in sig.parameters.items():
        if name in app_params:
            new_params.append(
                inspect.Parameter(
                    name,
                    inspect.Parameter.KEYWORD_ONLY,
                    default=app_params[name],
                    annotation=Optional[type(app_params[name])]
                )
            )
        else:
            new_params.append(param)

    wrapper.__signature__ = sig.replace(parameters=new_params)

    route = f"/{func.__name__}"
    app.post(route)(wrapper)
    return wrapper


def get(func):
    """get decorator

    Arguments:
        func -- _description_

    Returns:
        _description_
    """
    route = f"/{func.__name__}"
    app.get(route)(func)
    return func
