"""Tracing setup and trace reading for the evals.

Two responsibilities:

1. `call_setup()` initializes Agenta and turns on the OpenInference LangChain
   instrumentation, the same way the FastAPI server does. This makes the agent
   run emit a real trace: the workflow span, the LangGraph chain, each ChatOpenAI
   call, and each tool call, every one with inputs and outputs.

2. Reading tool usage back from the platform trace. The trace read endpoint
   returns a nested tree: the top level holds the root span, and each span holds
   its children under its own `spans` key. `tool_spans` walks that tree and
   returns the tool calls the agent made, with their outputs.

We read the trace by the application's trace id, which we take from
`request.links["invocation"].trace_id`. We do this rather than reading the
`trace` argument the SDK passes, because the released SDK (0.100.9) gives the
wrong trace to the second and later evaluators (see status.md issue 2). Reading
by id is correct for every evaluator and stays correct once that bug is fixed.
"""

from __future__ import annotations

import asyncio
import json
import os
from decimal import Decimal, InvalidOperation
from typing import Any, Iterator

import agenta as ag
import httpx

_HOST = os.environ.get("AGENTA_HOST", "").rstrip("/")
_KEY = os.environ.get("AGENTA_API_KEY", "")

_READY = False


def call_setup() -> None:
    """Initialize Agenta and turn on LangChain tracing. Idempotent."""
    global _READY
    ag.init()
    if not _READY:
        from openinference.instrumentation.langchain import LangChainInstrumentor

        LangChainInstrumentor().instrument()
        _READY = True


# --- reading the trace -------------------------------------------------------


def app_trace_id(request: Any) -> str | None:
    """The application's trace id, from the evaluator request's invocation link."""
    links = getattr(request, "links", None) or {}
    inv = links.get("invocation") if isinstance(links, dict) else getattr(links, "invocation", None)
    if inv is None:
        return None
    return inv.get("trace_id") if isinstance(inv, dict) else getattr(inv, "trace_id", None)


def _walk(spans: Any) -> Iterator[dict]:
    """Yield every span node from the nested `{name: node | [nodes]}` tree."""
    if not isinstance(spans, dict):
        return
    for value in spans.values():
        nodes = value if isinstance(value, list) else [value]
        for node in nodes:
            if not isinstance(node, dict):
                continue
            yield node
            yield from _walk(node.get("spans"))


async def fetch_trace(trace_id: str | None) -> dict:
    """Fetch a trace by id and return its nested `spans` dict.

    The async tracing worker is eventually consistent, so retry briefly.
    """
    if not trace_id or not _HOST:
        return {}
    url = f"{_HOST}/api/tracing/traces/{trace_id}"
    headers = {"Authorization": f"ApiKey {_KEY}"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        for _ in range(5):
            try:
                data = (await client.get(url, headers=headers)).json()
            except (httpx.HTTPError, ValueError):
                return {}
            traces = data.get("traces") or {}
            trace = next(iter(traces.values()), {})
            if trace.get("spans"):
                return trace["spans"]
            await asyncio.sleep(1.0)
    return {}


async def tool_spans(request: Any) -> list[dict]:
    """Return the tool calls in the run, as `{name, output}` dicts.

    Reads the real TOOL spans from the application trace.
    """
    spans = await fetch_trace(app_trace_id(request))
    tools = []
    for node in _walk(spans):
        if str(node.get("span_type")).lower() == "tool":
            output = node.get("attributes", {}).get("ag", {}).get("data", {}).get("outputs")
            tools.append({"name": node.get("span_name"), "output": output})
    return tools


# --- numbers helper for faithful pricing -------------------------------------


def numbers_in(obj: Any) -> set:
    """Recursively collect numeric values, descending into JSON-encoded strings."""

    def to_cents(v: Any):
        try:
            return Decimal(str(v)).quantize(Decimal("0.01"))
        except (InvalidOperation, ValueError, TypeError):
            return None

    found: set = set()
    if isinstance(obj, dict):
        for v in obj.values():
            found |= numbers_in(v)
    elif isinstance(obj, list):
        for v in obj:
            found |= numbers_in(v)
    elif isinstance(obj, bool):
        pass
    elif isinstance(obj, (int, float)):
        c = to_cents(obj)
        if c is not None:
            found.add(c)
    elif isinstance(obj, str):
        c = to_cents(obj)
        if c is not None:
            found.add(c)
        else:
            try:
                parsed = json.loads(obj)
            except (json.JSONDecodeError, ValueError):
                parsed = None
            if isinstance(parsed, (dict, list)):
                found |= numbers_in(parsed)
    return found
