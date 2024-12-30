from typing import Type, Any, Callable, Dict, Optional, Tuple
from inspect import signature, iscoroutinefunction, Parameter
from functools import wraps
from traceback import format_exception
from asyncio import sleep
from json import dumps
from uuid import UUID

from pydantic import BaseModel, HttpUrl, ValidationError

from fastapi import Body, FastAPI, HTTPException, Request

from agenta.sdk.middleware.inline import InlineMiddleware
from agenta.sdk.middleware.vault import VaultMiddleware
from agenta.sdk.middleware.config import ConfigMiddleware
from agenta.sdk.middleware.auth import AuthMiddleware
from agenta.sdk.middleware.otel import OTelMiddleware
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
from agenta.sdk.utils.exceptions import (
    display_exception,
    suppress,
)
from agenta.sdk.router import router
from agenta.sdk.utils.logging import log

from agenta.sdk.types import BaseResponse

import agenta as ag


app = FastAPI()
log.setLevel("DEBUG")


app.include_router(router, prefix="")


class PathValidator(BaseModel):
    url: HttpUrl


class route:  # pylint: disable=invalid-name
    """
    Decorator class to wrap a function for HTTP POST, terminal exposure and enable tracing.

    This decorator generates the following endpoints:

    Playground Endpoints
    - /test                     with e.g. @route("/"), @route(path="")
    - /test/{route}             with e.g. @route({route}), @route(path={route})

    Environment Endpoints:
    - /run                      with e.g. @route("/"), @route(path="")
    - /run/{route}              with e.g. @route({route}), @route(path={route})

    Example:
    ```python
        import agenta as ag

        @ag.route()
        async def chain_of_prompts_llm(prompt: str):
            return ...
    ```
    """

    routes = list()
    _middleware = False

    _run_path = "/run"
    _test_path = "/test"

    _config_key = "ag_config"

    def __init__(
        self,
        path: Optional[str] = "/",
        config_schema: Optional[BaseModel] = None,
        content_type: Optional[str] = None,
    ):
        self.route_path = "/" + path.strip("/").strip()
        self.route_path = "" if self.route_path == "/" else self.route_path
        self.config_schema: BaseModel = config_schema
        self.content_type = content_type

        PathValidator(url=f"http://example.com{path}")

        self.func = None
        self.config = None
        self.default_parameters = {}

        self.parse_config()

        if not route._middleware:
            route._middleware = True
            self.attach_middleware()

    def __call__(
        self,
        func: Callable[..., Any],
    ) -> Callable[..., Any]:
        self.func = func

        self.create_run_route()
        self.create_test_route()

    # --- Route(r) Setup --- #

    def parse_config(self) -> Tuple[Optional[Type[BaseModel]], Dict[str, Any]]:
        if self.config_schema:
            try:
                self.config = self.config_schema() if self.config_schema else None
                self.default_parameters = self.config.dict() if self.config else {}
            except ValidationError as e:
                raise ValueError(
                    f"Error initializing config_schema. Please ensure all required fields have default values: {str(e)}"
                ) from e
            except Exception as e:
                raise ValueError(
                    f"Unexpected error initializing config_schema: {str(e)}"
                ) from e

    def attach_middleware(self):
        app.add_middleware(InlineMiddleware)
        app.add_middleware(VaultMiddleware)
        app.add_middleware(ConfigMiddleware)
        app.add_middleware(AuthMiddleware)
        app.add_middleware(OTelMiddleware)
        app.add_middleware(CORSMiddleware)

    # --- Route Registration --- #

    def create_run_route(self):
        @wraps(self.func)
        async def run_wrapper(request: Request, *args, **kwargs) -> Any:
            kwargs, _ = self.process_kwargs(kwargs)

            if (
                request.state.config["parameters"] is None
                or request.state.config["references"] is None
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Config not found based on provided references.",
                )

            return await self.execute_wrapper(request, *args, **kwargs)

        self.update_wrapper_signature(wrapper=run_wrapper, add_config=False)

        run_route = f"{route._run_path}{self.route_path}"
        app.post(run_route, response_model=BaseResponse)(run_wrapper)

    def create_test_route(self):
        @wraps(self.func)
        async def test_wrapper(request: Request, *args, **kwargs) -> Any:
            kwargs, config = self.process_kwargs(kwargs)

            request.state.inline = True
            request.state.config["parameters"] = config

            if request.state.config["references"]:
                request.state.config["references"] = {
                    k: v
                    for k, v in request.state.config["references"].items()
                    if k.startswith("application")
                } or None

            return await self.execute_wrapper(request, *args, **kwargs)

        self.update_wrapper_signature(wrapper=test_wrapper, add_config=True)

        test_route = f"{route._test_path}{self.route_path}"
        app.post(test_route, response_model=BaseResponse)(test_wrapper)

    def process_kwargs(
        self,
        kwargs: Dict[str, Any],
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        config_params = kwargs.pop(route._config_key, {})  # TODO: rename this

        if isinstance(config_params, BaseModel):  # TODO: explain this
            config_params = config_params.model_dump()

        config = {**self.default_parameters, **config_params}

        return kwargs, config

    # --- Function Request/Response --- #

    async def execute_wrapper(
        self,
        request: Request,
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
        inline = state.inline

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
                try:
                    result = (
                        await self.func(*args, **kwargs)
                        if iscoroutinefunction(self.func)
                        else self.func(*args, **kwargs)
                    )

                    return await self.handle_success(result, inline)

                except Exception as error:  # pylint: disable=broad-except
                    self.handle_failure(error)

        return result

    async def handle_success(
        self,
        result: Any,
        inline: bool,
    ):
        data = None
        content_type = self.content_type
        tree = None
        tree_id = None

        print(result)
        print(content_type)

        with suppress():
            if isinstance(result, str):
                content_type = "text/plain"
                data = result
            elif not isinstance(result, str) and content_type == "text/plain":
                data = dumps(result)

            if inline:
                tree, tree_id = await self.fetch_inline_trace(inline)

        try:
            return BaseResponse(
                data=data,
                content_type=content_type,
                tree=tree,
                tree_id=tree_id,
            )

        except:  # pylint: disable=bare-except
            display_exception("Response Exception")

            return BaseResponse(
                data=data,
                content_type=content_type,
            )

    def handle_failure(
        self,
        error: Exception,
    ):
        display_exception("Application Exception")

        raise HTTPException(
            status_code=500,
            detail={
                "message": str(error),
                "stacktrace": format_exception(
                    error, value=error, tb=error.__traceback__
                ),
            },
        )

    async def fetch_inline_trace(
        self,
        inline: bool,
    ):
        TIMESTEP = 0.1
        NOFSTEPS = 1 / TIMESTEP

        context = tracing_context.get()
        link = context.link

        tree = None
        _tree_id = link.get("tree_id") if link else None
        tree_id = str(UUID(int=_tree_id)) if _tree_id else None

        if _tree_id is not None:
            if inline:
                remaining_steps = NOFSTEPS

                while (
                    not ag.tracing.is_inline_trace_ready(_tree_id)
                    and remaining_steps > 0
                ):
                    await sleep(TIMESTEP)

                    remaining_steps -= 1

                tree = ag.tracing.get_inline_trace(_tree_id)

        return tree, tree_id

    # --- Function Signature --- #

    def update_wrapper_signature(
        self,
        wrapper: Callable[..., Any],
        add_config: bool,
    ):
        parameters = [
            Parameter(
                name="request",
                kind=Parameter.POSITIONAL_OR_KEYWORD,
                annotation=Request,
            )
        ]

        for name, param in signature(self.func).parameters.items():
            assert (
                len(param.default.__class__.__bases__) == 1
            ), f"Inherited standard type of {param.default.__class__} needs to be one."

            parameters.append(
                Parameter(
                    name=name,
                    kind=Parameter.KEYWORD_ONLY,
                    default=Body(param.default, embed=True),
                    annotation=param.default.__class__.__bases__[0],
                    # ^ determines and gets the base (parent/inheritance) type of the SDK type at run-time.
                )
            )

        if self.config and add_config:
            for name, field in self.config.model_fields.items():
                assert field.default is not None, f"Field {name} has no default value"

            parameters.append(
                Parameter(
                    name=self._config_key,
                    kind=Parameter.KEYWORD_ONLY,
                    annotation=type(self.config),  # Get the actual class type
                    default=Body(self.config),  # Use the instance directly
                )
            )

        wrapper.__signature__ = signature(wrapper).replace(parameters=parameters)
