"""Three evaluators, one per kind of assertion a test case can make.

1. ``rubric_correctness`` is an LLM judge that scores the answer against a list of
   natural-language rubrics carried by the test case. One model call per case
   judges all rubrics and returns a per-rubric verdict.
2. ``tool_usage`` asserts the expected tools were called and the forbidden ones
   were not. It reads the real TOOL spans of the run **from the trace**.
3. ``faithful_pricing`` requires every dollar amount the agent states to be
   grounded: a number a pricing tool returned this run (read from the TOOL spans'
   outputs) or an authoritative constant from the system prompt. Otherwise it is
   hallucinated.

The framework passes each evaluator ``outputs`` (the answer), any testcase fields
it names, and ``request``. We take the application's trace id off
``request.links["invocation"]``, fetch that trace, and walk it for the real TOOL
spans (see ``tracing.tool_spans``).

Note: we deliberately do NOT use the ``trace`` argument. In the released SDK,
``aevaluate`` reuses one ``trace`` variable across the evaluator loop, so only the
first evaluator receives the application trace; later ones receive the previous
evaluator's trace (status.md issue 2). The invocation link is correct for every
evaluator, so we key off that instead.
"""

from __future__ import annotations

import json
import os
import re
from decimal import Decimal, InvalidOperation
from typing import Any

import agenta as ag
from openai import AsyncOpenAI

from .tracing import numbers_in, tool_spans

_JUDGE_MODEL = os.getenv("EVAL_JUDGE_MODEL", "gpt-4o-mini")

_CENTS = Decimal("0.01")


# --- helpers -----------------------------------------------------------------


def _answer(outputs: Any) -> str:
    """The application output is the answer string (tolerate dict shapes)."""
    if isinstance(outputs, str):
        return outputs
    if isinstance(outputs, dict):
        return outputs.get("answer") or outputs.get("data") or ""
    return "" if outputs is None else str(outputs)


def _to_cents(value: Any) -> Decimal | None:
    try:
        return Decimal(str(value)).quantize(_CENTS)
    except (InvalidOperation, ValueError, TypeError):
        return None


# --- 1. Rubric correctness (LLM judge) ---------------------------------------


_JUDGE_SYSTEM = (
    "You are a strict evaluator of a hotel concierge assistant. "
    "You are given the user's message, the assistant's answer, and a list of "
    "rubric assertions. For each rubric, decide whether the assistant's answer "
    "satisfies it. Be literal: if the answer does not clearly satisfy a rubric, "
    "mark it failed. Respond ONLY with JSON of the form "
    '{"verdicts": [{"rubric": "<text>", "passed": true/false, "reason": "<short>"}]}.'
)


async def judge_rubrics(rubrics: list[str], message: str, answer: str) -> dict:
    """Core: LLM-judge an answer against a list of rubrics. Reusable off-platform."""
    rubrics = list(rubrics or [])
    if not rubrics:
        return {"success": True, "score": 1.0, "note": "no rubrics for this case"}

    payload = {"user_message": message, "assistant_answer": answer, "rubrics": rubrics}

    client = AsyncOpenAI()
    resp = await client.chat.completions.create(
        model=_JUDGE_MODEL,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _JUDGE_SYSTEM},
            {"role": "user", "content": json.dumps(payload)},
        ],
    )
    data = json.loads(resp.choices[0].message.content or "{}")
    verdicts = data.get("verdicts", [])
    passed = sum(1 for v in verdicts if v.get("passed"))
    total = len(rubrics)
    return {
        "success": passed == total,
        "score": passed / total if total else 1.0,
        "passed": passed,
        "total": total,
        "verdicts": verdicts,
    }


@ag.evaluator(
    slug="rubric_correctness",
    name="Rubric Correctness",
    description="LLM judge scores the answer against a list of per-case rubrics.",
)
async def rubric_correctness(rubrics: list[str], message: str, outputs: Any) -> dict:
    return await judge_rubrics(rubrics, message, _answer(outputs))


# --- 2. Tool usage (from the trace's TOOL spans) -----------------------------


def assess_tool_usage(
    expected_tools: list[str], forbidden_tools: list[str], tool_spans: list[dict]
) -> dict:
    """Core: check expected/forbidden tools against the run's TOOL spans."""
    used = {t["name"] for t in tool_spans}
    expected = set(expected_tools or [])
    forbidden = set(forbidden_tools or [])

    missing = sorted(expected - used)
    used_forbidden = sorted(forbidden & used)
    ok = not missing and not used_forbidden

    return {
        "success": ok,
        "score": 1.0 if ok else 0.0,
        "tools_used": sorted(used),
        "missing": missing,
        "used_forbidden": used_forbidden,
    }


@ag.evaluator(
    slug="tool_usage",
    name="Tool Usage",
    description="Asserts expected tools were called and forbidden tools were not (from TOOL spans).",
)
async def tool_usage(expected_tools: list[str], forbidden_tools: list[str], request: Any) -> dict:
    return assess_tool_usage(expected_tools, forbidden_tools, await tool_spans(request))


# --- 3. Faithful pricing (answer prices vs TOOL span outputs) -----------------


# Dollar amounts in the answer, e.g. "$1,234.50" or "$35".
_PRICE_RE = re.compile(r"\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)")

# Tools that legitimately produce prices the agent may quote.
_PRICING_TOOLS = {"quote_stay", "search_availability", "list_room_types", "list_rate_plans"}

# Authoritative constants stated in the system prompt (fees the agent may cite
# without a tool call). See runtimes/langgraph/vanilla/agent.py.
_PROMPT_CONSTANTS = {Decimal(x) for x in ("25", "28", "35", "50", "75", "100", "200")}


def assess_pricing(answer: str, tool_spans: list[dict]) -> dict:
    """Core: every price in the answer must be grounded in a TOOL output or a constant."""
    tools_used = {t["name"] for t in tool_spans}

    prices = []
    for raw in _PRICE_RE.findall(answer):
        c = _to_cents(raw.replace(",", ""))
        if c is not None:
            prices.append(c)

    if not prices:
        return {"success": True, "score": 1.0, "prices_found": [], "note": "no prices in answer"}

    trusted: set[Decimal] = set(_PROMPT_CONSTANTS)
    for t in tool_spans:
        trusted |= numbers_in(t.get("output"))

    unfaithful = [str(p) for p in prices if all(abs(p - t) > _CENTS for t in trusted)]
    success = not unfaithful

    return {
        "success": success,
        "score": 1.0 if success else 0.0,
        "prices_found": [str(p) for p in prices],
        "unfaithful_prices": unfaithful,
        "called_pricing_tool": bool(tools_used & _PRICING_TOOLS),
    }


@ag.evaluator(
    slug="faithful_pricing",
    name="Faithful Pricing",
    description="Every price the agent states must come from a pricing tool (trace) or a prompt constant.",
)
async def faithful_pricing(request: Any, outputs: Any) -> dict:
    return assess_pricing(_answer(outputs), await tool_spans(request))
