import builtins as _py_builtins
from typing import Any, Dict, Union, Optional

from RestrictedPython import compile_restricted, safe_builtins, PrintCollector
from RestrictedPython.Eval import default_guarded_getiter, default_guarded_getitem
from RestrictedPython.Guards import (
    safer_getattr,
    guarded_iter_unpack_sequence,
    full_write_guard,
)

from agenta.sdk.engines.running.runners.base import CodeRunner


# Pure data/iteration builtins that RestrictedPython's safe_builtins omits but
# evaluators routinely need. All operate on data only — none reach the host or
# the class graph, so adding them does not widen the sandbox (escapes go through
# attribute access, which safer_getattr blocks).
_SAFE_EXTRA_BUILTINS = (
    "dict",
    "list",
    "set",
    "frozenset",
    "min",
    "max",
    "sum",
    "enumerate",
    "map",
    "filter",
    "reversed",
    "all",
    "any",
)


# Pure-computation stdlib modules only: no filesystem, network, or process reach.
# Deliberately strict — anything that can touch the host (os, subprocess, sys,
# pathlib, socket, importlib, io, shutil, ...) or the network (httpx, urllib,
# requests, ...) is excluded. Operators who need unrestricted execution must opt
# into the `local` runner; hostile multi-tenant should use `daytona`.
_ALLOWED_IMPORTS = frozenset(
    {
        "math",
        "statistics",
        "datetime",
        "json",
        "re",
        "random",
        "string",
        "typing",
        "collections",
        "itertools",
        "functools",
    }
)


def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    """Guarded ``__import__`` that only permits the pure-stdlib allowlist.

    Replaces the real ``__import__`` inside the sandbox so user evaluator code
    cannot import host-reaching modules. Relative imports (``level != 0``) are
    rejected outright.
    """
    root = name.split(".")[0]
    if level != 0 or root not in _ALLOWED_IMPORTS:
        raise ImportError(
            f"Import of '{name}' is not allowed in the restricted evaluator sandbox. "
            f"Allowed modules: {', '.join(sorted(_ALLOWED_IMPORTS))}. "
            "To run unrestricted evaluator code set "
            "AGENTA_SERVICES_CODE_SANDBOX_RUNNER=local (trusted deployments only)."
        )
    return __import__(name, globals, locals, fromlist, level)


def _build_restricted_globals() -> Dict[str, Any]:
    """Build the execution globals for RestrictedPython.

    Closes the two holes the previous sandbox had:
    1. it injected the real ``__import__`` (here: a guarded allowlist import), and
    2. it never set ``_getattr_`` (here: ``safer_getattr`` blocks dunder/underscore
       attribute access, which defeats the ``().__class__.__bases__`` gadget escape).
    """
    builtins = dict(safe_builtins)
    for name in _SAFE_EXTRA_BUILTINS:
        builtins[name] = getattr(_py_builtins, name)
    builtins["__import__"] = _safe_import

    return {
        "__builtins__": builtins,
        "_getattr_": safer_getattr,
        "_getitem_": default_guarded_getitem,
        "_getiter_": default_guarded_getiter,
        "_iter_unpack_sequence_": guarded_iter_unpack_sequence,
        "_write_": full_write_guard,
        # print() goes through PrintCollector (captured, not real stdout).
        "_print_": PrintCollector,
    }


class RestrictedRunner(CodeRunner):
    """Default code runner: executes evaluator code in an in-process RestrictedPython sandbox."""

    def run(
        self,
        code: str,
        app_params: Dict[str, Any],
        inputs: Dict[str, Any],
        output: Union[dict, str],
        correct_answer: Any,
        runtime: Optional[str] = None,
        templates: Optional[Dict[str, str]] = None,
        *,
        version: str = "1",
        trace: Optional[Dict[str, Any]] = None,
    ) -> Union[float, None]:
        """
        Execute provided Python code in a RestrictedPython sandbox.

        Args:
            code: The Python code to be executed
            app_params: The parameters of the app variant (v1 only)
            inputs: Inputs to be used during code execution
            output: The output of the app variant after being called
            correct_answer: The correct answer (or target) for comparison (v1 only)
            runtime: Runtime environment (only "python" is supported)
            templates: Wrapper templates keyed by runtime (unused for in-process runners).
            version: Evaluator interface version ("1" = legacy, "2" = new)
            trace: Full trace data (v2 only)

        Returns:
            Float score between 0 and 1, or None if execution fails
        """
        # Normalize runtime: None means python
        runtime = runtime or "python"

        # The restricted sandbox runs in-process and only supports Python.
        if runtime != "python":
            raise ValueError(
                f"RestrictedRunner only supports 'python' runtime, got: {runtime}. "
                "Use the Daytona runner for javascript/typescript."
            )

        try:
            byte_code = compile_restricted(code, filename="<inline>", mode="exec")
        except SyntaxError as e:
            raise SyntaxError(f"Syntax error in provided code: {e}")

        environment = _build_restricted_globals()

        try:
            exec(byte_code, environment)

            fn = environment["evaluate"]

            if version == "2":
                result = fn(inputs, output, trace)
            else:
                result = fn(app_params, inputs, output, correct_answer)

            # Attempt to convert result to float
            if isinstance(result, (float, int, str)):
                try:
                    result = float(result)
                except ValueError as e:
                    raise ValueError(f"Result cannot be converted to float: {e}")

            if not isinstance(result, float):
                raise TypeError(
                    f"Result is not a float after conversion: {type(result)}"
                )

            return result

        except KeyError as e:
            raise KeyError(f"Missing expected key in environment: {e}")

        except SyntaxError as e:
            raise SyntaxError(f"Syntax error in provided code: {e}")

        except Exception as e:
            raise RuntimeError(f"Error during code execution: {e}")
