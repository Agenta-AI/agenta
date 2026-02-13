from typing import Any, Callable, Optional, Protocol, Tuple, TYPE_CHECKING

if TYPE_CHECKING:
    from daytona import (
        CreateSandboxFromSnapshotParams,
        Daytona,
        DaytonaConfig,
        Sandbox,
    )
    from fastapi import APIRouter, FastAPI, HTTPException, Request
    from jinja2 import Template, TemplateError
    from openai import AsyncOpenAI, OpenAIError
    from starlette.responses import Response as StarletteResponse, StreamingResponse
    from jsonpath import JSONPointer


class _JsonpathModule(Protocol):
    findall: Callable[..., Any]


class _LitellmModule(Protocol):
    cost_calculator: Any
    acompletion: Callable[..., Any]


class _FastAPIModule(Protocol):
    FastAPI: type["FastAPI"]
    APIRouter: type["APIRouter"]
    Request: type["Request"]
    HTTPException: type["HTTPException"]
    Body: Any


class _YamlModule(Protocol):
    def safe_load(self, *args: Any, **kwargs: Any) -> Any: ...


_litellm_module: Optional[_LitellmModule] = None
_litellm_checked = False

_jsonpath_module: Optional[_JsonpathModule] = None
_jsonpath_pointer: Optional[type["JSONPointer"]] = None
_jsonpath_checked = False

_openai_cached: Optional[Tuple[type["AsyncOpenAI"], type["OpenAIError"]]] = None
_openai_checked = False

_yaml_module: Optional[_YamlModule] = None
_yaml_checked = False

_jinja_cached: Optional[Tuple[type["Template"], type["TemplateError"]]] = None
_jinja_checked = False

_fastapi_module: Optional[_FastAPIModule] = None
_fastapi_checked = False

_starlette_responses_cached: Optional[
    Tuple[type["StarletteResponse"], type["StreamingResponse"]]
] = None
_starlette_responses_checked = False

_daytona_cached: Optional[
    Tuple[
        type["Daytona"],
        type["DaytonaConfig"],
        type["Sandbox"],
        type["CreateSandboxFromSnapshotParams"],
    ]
] = None
_daytona_checked = False


def _load_litellm(
    injected: Optional[_LitellmModule] = None,
) -> Optional[_LitellmModule]:
    global _litellm_module, _litellm_checked  # pylint: disable=global-statement

    if _litellm_checked:
        return _litellm_module

    if injected is not None:
        _litellm_checked = True
        _litellm_module = injected
        return _litellm_module

    _litellm_checked = True
    try:
        import litellm as _litellm
    except Exception:
        _litellm_module = None
    else:
        _litellm_module = _litellm
        _configure_litellm(_litellm_module)

    return _litellm_module


def _configure_litellm(litellm: _LitellmModule) -> None:
    """Configure litellm with Agenta's callback handler for cost/token tracking."""
    from agenta.sdk.litellm import mockllm
    from agenta.sdk.litellm.litellm import litellm_handler

    litellm.logging = False  # type: ignore
    litellm.set_verbose = False  # type: ignore
    litellm.drop_params = True  # type: ignore
    mockllm.litellm = litellm  # type: ignore
    litellm.callbacks = [litellm_handler()]  # type: ignore


def _load_jsonpath() -> Tuple[Optional[_JsonpathModule], Optional[type["JSONPointer"]]]:
    global _jsonpath_module, _jsonpath_pointer, _jsonpath_checked  # pylint: disable=global-statement

    if _jsonpath_checked:
        return _jsonpath_module, _jsonpath_pointer

    _jsonpath_checked = True
    try:
        import jsonpath as _jsonpath
        from jsonpath import JSONPointer as _JSONPointer
    except Exception:
        _jsonpath_module = None
        _jsonpath_pointer = None
    else:
        _jsonpath_module = _jsonpath
        _jsonpath_pointer = _JSONPointer

    return _jsonpath_module, _jsonpath_pointer


def _load_openai() -> Tuple[type["AsyncOpenAI"], type["OpenAIError"]]:
    global _openai_cached, _openai_checked  # pylint: disable=global-statement

    if _openai_checked:
        if _openai_cached is None:
            raise ImportError(
                "openai is required for semantic similarity evaluation. "
                "Install it with `pip install openai`."
            )
        return _openai_cached

    _openai_checked = True
    try:
        from openai import AsyncOpenAI, OpenAIError
    except Exception as exc:
        _openai_cached = None
        raise ImportError(
            "openai is required for semantic similarity evaluation. "
            "Install it with `pip install openai`."
        ) from exc

    _openai_cached = (AsyncOpenAI, OpenAIError)
    return _openai_cached


def _load_yaml() -> _YamlModule:
    global _yaml_module, _yaml_checked  # pylint: disable=global-statement

    if _yaml_checked:
        if _yaml_module is None:
            raise ImportError("pyyaml is required to load YAML configs.")
        return _yaml_module

    _yaml_checked = True
    try:
        import yaml as _yaml
    except Exception as exc:
        _yaml_module = None
        raise ImportError("pyyaml is required to load YAML configs.") from exc

    _yaml_module = _yaml
    return _yaml_module


def _load_jinja2() -> Tuple[type["Template"], type["TemplateError"]]:
    global _jinja_cached, _jinja_checked  # pylint: disable=global-statement

    if _jinja_checked:
        if _jinja_cached is None:
            raise ImportError("jinja2 is required for jinja2 template rendering.")
        return _jinja_cached

    _jinja_checked = True
    try:
        from jinja2 import Template, TemplateError
    except Exception as exc:
        _jinja_cached = None
        raise ImportError("jinja2 is required for jinja2 template rendering.") from exc

    _jinja_cached = (Template, TemplateError)
    return _jinja_cached


def _load_fastapi() -> _FastAPIModule:
    global _fastapi_module, _fastapi_checked  # pylint: disable=global-statement

    if _fastapi_checked:
        if _fastapi_module is None:
            raise ImportError("fastapi is required for serving routes.")
        return _fastapi_module

    _fastapi_checked = True
    try:
        import fastapi as _fastapi
    except Exception as exc:
        _fastapi_module = None
        raise ImportError("fastapi is required for serving routes.") from exc

    _fastapi_module = _fastapi
    return _fastapi_module


def _load_starlette_responses() -> Tuple[
    type["StarletteResponse"], type["StreamingResponse"]
]:
    global _starlette_responses_cached, _starlette_responses_checked  # pylint: disable=global-statement

    if _starlette_responses_checked:
        if _starlette_responses_cached is None:
            raise ImportError("starlette is required for response handling.")
        return _starlette_responses_cached

    _starlette_responses_checked = True
    try:
        from starlette.responses import Response as StarletteResponse, StreamingResponse
    except Exception as exc:
        _starlette_responses_cached = None
        raise ImportError("starlette is required for response handling.") from exc

    _starlette_responses_cached = (StarletteResponse, StreamingResponse)
    return _starlette_responses_cached


def _load_daytona() -> Tuple[
    type["Daytona"],
    type["DaytonaConfig"],
    type["Sandbox"],
    type["CreateSandboxFromSnapshotParams"],
]:
    global _daytona_cached, _daytona_checked  # pylint: disable=global-statement

    if _daytona_checked:
        if _daytona_cached is None:
            raise ImportError("daytona is required for Daytona sandbox execution.")
        return _daytona_cached

    _daytona_checked = True
    try:
        from daytona import (
            Daytona,
            DaytonaConfig,
            Sandbox,
            CreateSandboxFromSnapshotParams,
        )
    except Exception as exc:
        _daytona_cached = None
        raise ImportError("daytona is required for Daytona sandbox execution.") from exc

    _daytona_cached = (
        Daytona,
        DaytonaConfig,
        Sandbox,
        CreateSandboxFromSnapshotParams,
    )
    return _daytona_cached
