"""The core: ONE Workflow base, TWO authoring front-ends. (POC, does not run.)

This folder is demo #3 of three peers under docs/designs/:

    ../class-based-sdk/            #1 class-only      (class API, native)
    ../function-based-sdk/         #2 functional-only (function API, native)
    ./  (functional-based-class)   #3 class API rebuilt on the functional core

The point of #3: the class API of #1 is *sugar*. There is one workflow base and
two ways to author it — a decorator (function) front-end and a subclass (class)
front-end. The class front-end does not register anything itself; it gathers the
same data a decorator would and forwards into the function front-end. So:

    class authoring  ->  function authoring  ->  one Workflow base

If the class path built workflows itself, there would be two engines. It does
not, so there is one. That chain is the whole argument.

Grounded in the real SDK (sdks/python/agenta/sdk/):
- `decorators/running.py` already has `class Workflow` wrapping a function
  (`self._fn`) with `.invoke()`/`.inspect()`. The handle exists, and it already
  wraps a function — the function is the substrate today.
- `models/workflows.py::WorkflowFlags` already has `is_application`,
  `is_evaluator`, `has_handler`. A workflow's *kind is a flag*, not a type:
  Application and Evaluator are the same Workflow with a different flag;
  Configuration is a Workflow with has_handler=False.

`Testset` is intentionally NOT a Workflow (no parameters, no handler, no schemas
triple). It gets its own base at the bottom of this file.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

# In the real SDK: agenta.sdk.decorators.running (the `workflow` handle) and
# agenta.sdk.models.workflows (WorkflowFlags). Shown as the contract we sit on.
from agenta import workflow as _workflow_decorator
from agenta.sdk.models.workflows import WorkflowFlags
from pydantic import BaseModel


# =========================================================================
# THE ONE BASE. Both front-ends below produce an instance of this. It is the
# SDK's existing `Workflow` handle given the lifecycle surface the proposal
# needs (.pin/.push/.router/...). Nothing here is kind-specific: "application
# vs evaluator" is a flag, passed in.
# =========================================================================


class Workflow:
    def __init__(
        self,
        *,
        handler: Optional[Callable[..., Any]],
        slug: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        flags: WorkflowFlags,
        parameters: Optional[type[BaseModel]] = None,
        inputs: Optional[type[BaseModel]] = None,
        outputs: Optional[type[BaseModel]] = None,
        streamer: Optional[Callable[..., Any]] = None,
        pinned: Optional[dict] = None,
    ):
        # Compile the three models to JSON Schema and register via the existing
        # `workflow` decorator. flags carries the kind, as data.
        self._decorator = _workflow_decorator(
            slug=slug,
            name=name,
            description=description,
            flags=flags.model_dump(),
            schemas=_compile_schemas(parameters, inputs, outputs),
            parameters=(pinned or {}),
        )
        self._handle = self._decorator(handler) if handler else self._decorator
        self._streamer = streamer
        self._pinned = pinned or {}
        self._spec = dict(
            slug=slug,
            name=name,
            description=description,
            flags=flags,
            parameters=parameters,
            inputs=inputs,
            outputs=outputs,
        )

    async def __call__(self, **kw):
        return await self._handle(**{**self._pinned, **kw})

    async def invoke(self, **kw):
        return await self._handle.invoke(request=kw)

    async def inspect(self):
        return await self._handle.inspect()

    def pin(self, **overrides) -> "Workflow":
        # functools.partial over parameters, expressed as a new handle.
        return Workflow(
            handler=self._handle._fn,
            streamer=self._streamer,
            pinned={**self._pinned, **overrides},
            **self._spec,
        )

    async def push(self) -> Any: ...
    async def deploy(self, **k) -> Any: ...
    def router(self, *a, **k): ...
    async def fetch_parameters(self, **k): ...
    async def from_registry(self, **k): ...


def _compile_schemas(parameters, inputs, outputs) -> dict:
    return {
        "parameters": parameters.model_json_schema() if parameters else None,
        "inputs": inputs.model_json_schema() if inputs else None,
        "outputs": outputs.model_json_schema() if outputs else None,
    }


# =========================================================================
# FRONT-END 1: WorkflowFunction — the DECORATOR path. `@ag.application(...)` over
# a function -> a Workflow. This is exactly what #2 (../function-based-sdk/)
# calls `ag.application`. It gathers (handler, models, flags) and hands them to
# Workflow. Nothing more.
# =========================================================================


class WorkflowFunction:
    @staticmethod
    def make(
        handler,
        *,
        flags,
        slug,
        name,
        description,
        parameters,
        inputs,
        outputs,
        streamer=None,
    ):
        return Workflow(
            handler=handler,
            flags=flags,
            slug=slug,
            name=name,
            description=description,
            parameters=parameters,
            inputs=inputs,
            outputs=outputs,
            streamer=streamer,
        )

    @classmethod
    def application(
        cls,
        *,
        slug,
        name=None,
        description=None,
        parameters=None,
        inputs=None,
        outputs=None,
    ):
        def deco(handler):
            return cls.make(
                handler,
                flags=WorkflowFlags(is_application=True, has_handler=True),
                slug=slug,
                name=name,
                description=description,
                parameters=parameters,
                inputs=inputs,
                outputs=outputs,
            )

        return deco

    @classmethod
    def evaluator(
        cls,
        *,
        slug,
        name=None,
        description=None,
        parameters=None,
        inputs=None,
        outputs=None,
    ):
        def deco(handler):
            return cls.make(
                handler,
                flags=WorkflowFlags(is_evaluator=True, has_handler=True),
                slug=slug,
                name=name,
                description=description,
                parameters=parameters,
                inputs=inputs,
                outputs=outputs,
            )

        return deco

    @classmethod
    def configuration(cls, *, slug, name=None, description=None, parameters=None):
        # No handler: same Workflow, has_handler=False.
        return Workflow(
            handler=None,
            flags=WorkflowFlags(is_application=True, has_handler=False),
            slug=slug,
            name=name,
            description=description,
            parameters=parameters,
        )


# =========================================================================
# FRONT-END 2: WorkflowClass / ClassFrontEnd — the SUBCLASS path. Same base.
#
# `class X(ag.Application)` -> on __init_subclass__, read the inner models +
# handler method off the class and call the SAME WorkflowFunction path. The
# class gathers exactly what the decorator gathered, just from attributes
# instead of arguments. THIS is the "class is sugar" mechanism, in one place.
#
# The per-kind shim files (01_*, 02_*, 07_*) each set _handler_name + flags and
# run a class-based example from ../class-based-sdk verbatim on top of this.
# =========================================================================


class ClassFrontEnd:
    _handler_name: Optional[str] = "run"

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if not getattr(cls, "slug", None):
            return  # an Application/Evaluator base itself, not a user workflow

        instance = cls()  # holds __init__ resources (clients, indexes)
        method = getattr(cls, cls._handler_name, None) if cls._handler_name else None

        async def handler(**kw):
            return await method(instance, **kw)

        streamer_method = getattr(cls, "stream", None)
        streamer = None
        if streamer_method is not None:

            async def streamer(**kw):  # noqa: F811
                async for chunk in streamer_method(instance, **kw):
                    yield chunk

        # ---- the punchline: the class forwards into the function path ----
        cls._handle = WorkflowFunction.make(
            handler if method else None,
            flags=cls._flags(),
            slug=cls.slug,
            name=getattr(cls, "name", None),
            description=getattr(cls, "description", None),
            parameters=getattr(cls, "Parameters", None),
            inputs=getattr(cls, "Inputs", None),
            outputs=getattr(cls, "Outputs", None),
            streamer=streamer,
        )

    @classmethod
    def _flags(cls) -> WorkflowFlags:  # overridden per kind
        raise NotImplementedError

    # instance(parameters=...) -> pin; calls/lifecycle delegate to the handle.
    def __init__(self, *, parameters: dict | None = None):
        self._bound = (
            type(self)._handle.pin(**parameters) if parameters else type(self)._handle
        )

    async def __call__(self, **kw):
        return await self._bound(**kw)

    # A configured instance delegates everything else (router, invoke, inspect,
    # push, ...) to its *pinned* handle, so it serves/runs with its baked-in
    # defaults. Class-level lifecycle uses the classmethods below.
    def __getattr__(self, item):
        return getattr(object.__getattribute__(self, "_bound"), item)

    @classmethod
    async def apush(cls):
        return await cls._handle.push()

    @classmethod
    async def adeploy(cls, **k):
        return await cls._handle.deploy(**k)

    @classmethod
    async def inspect(cls):
        return await cls._handle.inspect()

    @classmethod
    def router(cls, *a, **k):
        return cls._handle.router(*a, **k)

    @classmethod
    async def afetch_parameters(cls, **k):
        return await cls._handle.fetch_parameters(**k)

    @classmethod
    async def afrom_registry(cls, **k):
        return await cls._handle.from_registry(**k)


# Per-kind bases. Each is two lines: which handler method, which flag.
class Application(ClassFrontEnd):
    _handler_name = "run"

    @classmethod
    def _flags(cls):
        return WorkflowFlags(is_application=True, has_handler=True)


class Evaluator(ClassFrontEnd):
    _handler_name = "evaluate"

    @classmethod
    def _flags(cls):
        return WorkflowFlags(is_evaluator=True, has_handler=True)


class Configuration(ClassFrontEnd):
    _handler_name = None  # no runnable

    @classmethod
    def _flags(cls):
        return WorkflowFlags(is_application=True, has_handler=False)


# =========================================================================
# NOT a Workflow. Testset is a typed row collection: inner `Case` model + seed
# `cases`, no parameters/handler/schemas-triple, absent from WorkflowFlags. Its
# own tiny base, deliberately not under `Workflow`, so the hierarchy matches the
# data model instead of papering over it.
# =========================================================================


class Testset:
    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if not getattr(cls, "slug", None):
            return
        cls._case = cls.Case
        cls._seed = getattr(cls, "cases", None)

    @classmethod
    async def apush(cls): ...

    @classmethod
    async def afetch(cls): ...

    @classmethod
    async def aadd(cls, **k): ...

    @classmethod
    async def afrom_traces(cls, **k): ...
