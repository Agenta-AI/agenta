"""The base classes this folder assumes. (POC, does not run.)

The numbered files 01-08 write `class HotelAgent(ag.Application)`, `class
RubricJudge(ag.Evaluator)`, etc. This file is where those bases come from —
implemented CLASS-FIRST, as the native foundation of the class-only proposal.

Compare the three `00_*` foundations across the peer folders:

    ./00_core.py                              bases as native classes (this file)
    ../functional-based-class-sdk/00_core.py  the SAME bases on the functional core
    ../function-based-sdk/00_core.py          the function form's foundation (no
                                              base classes — decorators + closures)

In this native version each base registers directly: its `__init_subclass__`
reads the inner Parameters/Inputs/Outputs models and the run/evaluate method off
the subclass and calls the engine. There is no decorator/function layer beneath
— the class is the registration path.

Grounded in the real SDK (sdks/python/agenta/sdk/):
- `decorators/running.py` has the `Workflow` handle and the `workflow`
  registrar this delegates to.
- `models/workflows.py::WorkflowFlags` encodes kind as flags: `is_application`,
  `is_evaluator`, `has_handler`. Application and Evaluator are the same workflow
  with a different flag; Configuration has `has_handler=False`.

`Testset` is intentionally NOT a workflow (no parameters, no handler, no schemas
triple, absent from WorkflowFlags). It gets its own base at the bottom.
"""

from __future__ import annotations

from typing import Any, Optional

from agenta import workflow as _register  # the existing `workflow` registrar
from agenta.sdk.models.workflows import WorkflowFlags


# =========================================================================
# Shared base. `__init_subclass__` compiles the inner models + handler method
# into a registered workflow. Subclasses set `_flags` (kind) and `_handler_name`
# (which method is the handler — None for config-only).
# =========================================================================


class _WorkflowClass:
    _handler_name: Optional[str] = "run"

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if not getattr(cls, "slug", None):
            return  # a base (Application/Evaluator/...), not a user workflow

        instance = cls()  # holds __init__ resources (clients, indexes)
        method = getattr(cls, cls._handler_name, None) if cls._handler_name else None

        schemas = _compile_schemas(
            getattr(cls, "Parameters", None),
            getattr(cls, "Inputs", None),
            getattr(cls, "Outputs", None),
        )

        registrar = _register(
            slug=cls.slug,
            name=getattr(cls, "name", None),
            description=getattr(cls, "description", None),
            flags=cls._flags().model_dump(),
            schemas=schemas,
        )

        if method is None:
            cls._handle = registrar  # config-only: schemas, no handler
        else:

            async def handler(**kw):
                return await method(instance, **kw)

            cls._handle = registrar(handler)

    @classmethod
    def _flags(cls) -> WorkflowFlags:  # overridden per kind
        raise NotImplementedError

    # Authoring/lifecycle surface — same names the examples call.
    def __init__(self, *, parameters: dict | None = None):
        self._bound = (
            type(self)._handle.pin(**parameters) if parameters else type(self)._handle
        )

    async def __call__(self, **kw):
        return await self._bound(**kw)

    def __getattr__(self, item):
        # A configured instance delegates router/invoke/inspect/... to its
        # pinned handle.
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


def _compile_schemas(parameters, inputs, outputs) -> dict:
    return {
        "parameters": parameters.model_json_schema() if parameters else None,
        "inputs": inputs.model_json_schema() if inputs else None,
        "outputs": outputs.model_json_schema() if outputs else None,
    }


# =========================================================================
# The kinds. Each is two lines: which handler method, which flag.
# =========================================================================


class Application(_WorkflowClass):
    _handler_name = "run"

    @classmethod
    def _flags(cls):
        return WorkflowFlags(is_application=True, has_handler=True)


class Evaluator(_WorkflowClass):
    _handler_name = "evaluate"

    @classmethod
    def _flags(cls):
        return WorkflowFlags(is_evaluator=True, has_handler=True)


class Configuration(_WorkflowClass):
    _handler_name = None  # config-only: no runnable

    @classmethod
    def _flags(cls):
        return WorkflowFlags(is_application=True, has_handler=False)

    @classmethod
    async def afetch(cls, **k):
        return await cls._handle.fetch(**k)

    @classmethod
    def fetch(cls, **k):
        return cls._handle.fetch_sync(**k)


# =========================================================================
# NOT a workflow. Testset is a typed row collection — inner `Case` + seed
# `cases`, no parameters/handler/schemas-triple, absent from WorkflowFlags. Its
# own base, so the hierarchy matches the data model.
# =========================================================================


class Testset:
    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if not getattr(cls, "slug", None):
            return
        cls._handle = _register_testset(
            slug=cls.slug,
            name=getattr(cls, "name", None),
            case=cls.Case,
            cases=getattr(cls, "cases", None),
        )

    @classmethod
    async def apush(cls) -> Any:
        return await cls._handle.push()

    @classmethod
    async def afetch(cls) -> Any:
        return await cls._handle.fetch()

    @classmethod
    async def aadd(cls, **k) -> Any:
        return await cls._handle.add(**k)

    @classmethod
    async def afrom_traces(cls, **k) -> Any:
        return await cls._handle.from_traces(**k)


# In the real SDK this is the testset registrar (column schema = Case), a
# different engine path from `workflow`. Stubbed here as the contract.
def _register_testset(*, slug, name, case, cases): ...
