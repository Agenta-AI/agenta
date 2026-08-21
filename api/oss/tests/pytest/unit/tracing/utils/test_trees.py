from copy import deepcopy
from datetime import datetime, timezone
from uuid import UUID

import pytest

from agenta.sdk.models.tracing import OTelLink
from oss.src.core.shared.dtos import Trace
from oss.src.core.tracing.dtos import OTelFlatSpan, OTelSpan, SpanType, TraceType
from oss.src.core.tracing.utils.trees import (
    calculate_and_propagate_metrics,
    calculate_costs,
    connect_children,
    cumulate_costs,
    cumulate_errors,
    cumulate_tokens,
    get_span_from_trace,
    infer_and_propagate_trace_type_by_trace,
    parse_span_dtos_to_span_idx,
    parse_span_idx_to_span_id_tree,
    promote_identity_by_trace,
    trace_map_to_traces,
    traces_to_trace_map,
)


TRACE_UUID = "31d6cfe0-4b90-11ec-8001-42010a8000b0"
ROOT_UUID = "31d6cfe0-4b90-11ec-31d6-cfe04b9011ec"
CHILD_A_UUID = "41d6cfe0-4b90-11ec-41d6-cfe04b9011ec"
CHILD_B_UUID = "51d6cfe0-4b90-11ec-51d6-cfe04b9011ec"
ABSENT_PARENT_UUID = "61d6cfe0-4b90-11ec-61d6-cfe04b9011ec"
ORPHAN_UUID = "71d6cfe0-4b90-11ec-71d6-cfe04b9011ec"
ORPHAN_CHILD_UUID = "81d6cfe0-4b90-11ec-81d6-cfe04b9011ec"
CYCLE_A_UUID = "91d6cfe0-4b90-11ec-91d6-cfe04b9011ec"
CYCLE_B_UUID = "a1d6cfe0-4b90-11ec-a1d6-cfe04b9011ec"


def _span(
    *,
    span_id: str,
    parent_id: str | None = None,
    span_name: str,
    trace_id: str = TRACE_UUID,
    links=None,
    prompt_tokens: float = 0.0,
    completion_tokens: float = 0.0,
    cache_read_tokens: float | None = None,
    cache_token_key: str = "cache_read",
    prompt_cost: float = 0.0,
    completion_cost: float = 0.0,
    errors: int = 0,
    start_offset_s: int = 0,
    span_type: SpanType = SpanType.TASK,
    session_id: str | None = None,
    user_id: str | None = None,
    agent_id: str | None = None,
) -> OTelFlatSpan:
    total_tokens = prompt_tokens + completion_tokens
    total_cost = prompt_cost + completion_cost
    incremental_tokens = {
        "prompt": prompt_tokens,
        "completion": completion_tokens,
        "total": total_tokens,
    }
    # Under `cache_token_key` because the ingest adapters disagree on the name: the logfire
    # path writes `cache_read`, the Vercel AI path writes `cached`. Absent entirely when
    # None, which is the shape of a span from a provider or model without prompt caching.
    if cache_read_tokens is not None:
        incremental_tokens[cache_token_key] = cache_read_tokens
    metrics = {
        "tokens": {"incremental": incremental_tokens},
        "costs": {
            "incremental": {
                "prompt": prompt_cost,
                "completion": completion_cost,
                "total": total_cost,
            }
        },
    }
    if errors:
        metrics["errors"] = {"incremental": errors}

    ag_attributes = {
        "data": {"parameters": {"model": "gpt-4o-mini"}},
        "meta": {"response": {"model": "gpt-4o-mini"}},
        "metrics": metrics,
    }
    if session_id is not None:
        ag_attributes["session"] = {"id": session_id}
    if user_id is not None:
        ag_attributes["user"] = {"id": user_id}
    if agent_id is not None:
        ag_attributes["agent"] = {"id": agent_id}

    return OTelFlatSpan(
        trace_id=trace_id,
        span_id=span_id,
        parent_id=parent_id,
        span_name=span_name,
        span_type=span_type,
        start_time=datetime(2024, 1, 1, 0, 0, start_offset_s, tzinfo=timezone.utc),
        links=links,
        attributes={"ag": ag_attributes},
    )


def _otel_span_from_flat(span: OTelFlatSpan) -> OTelSpan:
    return OTelSpan(**span.model_dump(mode="json"))


def test_parse_span_dtos_to_span_idx_and_tree_hierarchy():
    root = _span(span_id=ROOT_UUID, span_name="root", start_offset_s=0)
    child = _span(
        span_id=CHILD_A_UUID,
        parent_id=ROOT_UUID,
        span_name="child",
        start_offset_s=1,
    )

    span_idx = parse_span_dtos_to_span_idx([child, root])
    tree = parse_span_idx_to_span_id_tree(span_idx)

    assert set(span_idx.keys()) == {ROOT_UUID, CHILD_A_UUID}
    assert list(tree.keys()) == [ROOT_UUID]
    assert list(tree[ROOT_UUID].keys()) == [CHILD_A_UUID]


def test_parentless_root_still_seeds_its_own_tree_only():
    # A span with parent_id=None keeps seeding exactly as before; widening the rule to
    # dangling parents must not turn its children into extra roots.
    root = _span(span_id=ROOT_UUID, span_name="root", start_offset_s=0)
    child = _span(
        span_id=CHILD_A_UUID,
        parent_id=ROOT_UUID,
        span_name="child",
        start_offset_s=1,
    )
    grandchild = _span(
        span_id=CHILD_B_UUID,
        parent_id=CHILD_A_UUID,
        span_name="grandchild",
        start_offset_s=2,
    )

    span_idx = parse_span_dtos_to_span_idx([grandchild, child, root])
    tree = parse_span_idx_to_span_id_tree(span_idx)

    assert list(tree.keys()) == [ROOT_UUID]
    assert list(tree[ROOT_UUID].keys()) == [CHILD_A_UUID]
    assert list(tree[ROOT_UUID][CHILD_A_UUID].keys()) == [CHILD_B_UUID]


def test_span_with_parent_absent_from_batch_seeds_and_cumulates():
    # The agent runner ships its subtree in its own OTLP request; the top span points at
    # a parent that arrived in the SDK's request. That span must still root a tree.
    invoke_agent = _span(
        span_id=ORPHAN_UUID,
        parent_id=ABSENT_PARENT_UUID,
        span_name="invoke_agent",
        errors=1,
        start_offset_s=0,
    )
    llm_call = _span(
        span_id=ORPHAN_CHILD_UUID,
        parent_id=ORPHAN_UUID,
        span_name="llm_call",
        prompt_tokens=10,
        completion_tokens=20,
        prompt_cost=0.1,
        completion_cost=0.2,
        errors=2,
        start_offset_s=1,
    )

    span_idx = parse_span_dtos_to_span_idx([invoke_agent, llm_call])
    tree = parse_span_idx_to_span_id_tree(span_idx)

    assert list(tree.keys()) == [ORPHAN_UUID]
    assert list(tree[ORPHAN_UUID].keys()) == [ORPHAN_CHILD_UUID]

    cumulate_tokens(tree, span_idx)
    cumulate_costs(tree, span_idx)
    cumulate_errors(tree, span_idx)

    metrics = span_idx[ORPHAN_UUID].attributes["ag"]["metrics"]

    assert metrics["tokens"]["cumulative"] == {
        "prompt": 10.0,
        "completion": 20.0,
        "total": 30.0,
    }
    assert metrics["costs"]["cumulative"]["total"] == pytest.approx(0.3)
    assert metrics["errors"]["cumulative"] == 3


def test_disconnected_subtrees_cumulate_independently():
    root = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=1,
        start_offset_s=0,
    )
    root_child = _span(
        span_id=CHILD_A_UUID,
        parent_id=ROOT_UUID,
        span_name="root-child",
        prompt_tokens=2,
        start_offset_s=1,
    )
    orphan = _span(
        span_id=ORPHAN_UUID,
        parent_id=ABSENT_PARENT_UUID,
        span_name="orphan",
        prompt_tokens=4,
        start_offset_s=2,
    )
    orphan_child = _span(
        span_id=ORPHAN_CHILD_UUID,
        parent_id=ORPHAN_UUID,
        span_name="orphan-child",
        prompt_tokens=8,
        start_offset_s=3,
    )

    span_idx = parse_span_dtos_to_span_idx([root, root_child, orphan, orphan_child])
    tree = parse_span_idx_to_span_id_tree(span_idx)

    assert list(tree.keys()) == [ROOT_UUID, ORPHAN_UUID]

    cumulate_tokens(tree, span_idx)

    def _cumulative_prompt(span_id: str) -> float:
        return span_idx[span_id].attributes["ag"]["metrics"]["tokens"]["cumulative"][
            "prompt"
        ]

    assert _cumulative_prompt(ROOT_UUID) == 3.0
    assert _cumulative_prompt(ORPHAN_UUID) == 12.0
    assert _cumulative_prompt(CHILD_A_UUID) == 2.0
    assert _cumulative_prompt(ORPHAN_CHILD_UUID) == 8.0


def test_parent_cycle_terminates_and_is_left_out_of_the_forest():
    cycle_a = _span(
        span_id=CYCLE_A_UUID,
        parent_id=CYCLE_B_UUID,
        span_name="cycle-a",
        prompt_tokens=1,
        start_offset_s=0,
    )
    cycle_b = _span(
        span_id=CYCLE_B_UUID,
        parent_id=CYCLE_A_UUID,
        span_name="cycle-b",
        prompt_tokens=2,
        start_offset_s=1,
    )
    root = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=4,
        start_offset_s=2,
    )

    span_idx = parse_span_dtos_to_span_idx([cycle_a, cycle_b, root])
    tree = parse_span_idx_to_span_id_tree(span_idx)

    assert list(tree.keys()) == [ROOT_UUID]
    assert tree[ROOT_UUID] == {}

    cumulate_tokens(tree, span_idx)

    assert span_idx[ROOT_UUID].attributes["ag"]["metrics"]["tokens"]["cumulative"][
        "prompt"
    ] == pytest.approx(4.0)
    assert (
        "cumulative" not in span_idx[CYCLE_A_UUID].attributes["ag"]["metrics"]["tokens"]
    )
    assert (
        "cumulative" not in span_idx[CYCLE_B_UUID].attributes["ag"]["metrics"]["tokens"]
    )


def test_cumulate_tokens_and_costs_propagate_from_children_to_parent():
    root = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=1,
        completion_tokens=2,
        prompt_cost=0.1,
        completion_cost=0.2,
    )
    child = _span(
        span_id=CHILD_A_UUID,
        parent_id=ROOT_UUID,
        span_name="child",
        prompt_tokens=4,
        completion_tokens=5,
        prompt_cost=0.4,
        completion_cost=0.5,
        start_offset_s=1,
    )

    span_idx = parse_span_dtos_to_span_idx([root, child])
    tree = parse_span_idx_to_span_id_tree(span_idx)

    cumulate_tokens(tree, span_idx)
    cumulate_costs(tree, span_idx)

    root_tokens = span_idx[ROOT_UUID].attributes["ag"]["metrics"]["tokens"][
        "cumulative"
    ]
    root_costs = span_idx[ROOT_UUID].attributes["ag"]["metrics"]["costs"]["cumulative"]

    assert root_tokens == {"prompt": 5.0, "completion": 7.0, "total": 12.0}
    assert root_costs["prompt"] == pytest.approx(0.5)
    assert root_costs["completion"] == pytest.approx(0.7)
    assert root_costs["total"] == pytest.approx(1.2)


def test_cumulate_errors_propagates_scalar_counts_from_children_to_parent():
    root = _span(
        span_id=ROOT_UUID,
        span_name="root",
        errors=1,
    )
    child = _span(
        span_id=CHILD_A_UUID,
        parent_id=ROOT_UUID,
        span_name="child",
        errors=2,
        start_offset_s=1,
    )

    span_idx = parse_span_dtos_to_span_idx([root, child])
    tree = parse_span_idx_to_span_id_tree(span_idx)

    cumulate_errors(tree, span_idx)

    root_errors = span_idx[ROOT_UUID].attributes["ag"]["metrics"]["errors"]
    child_errors = span_idx[CHILD_A_UUID].attributes["ag"]["metrics"]["errors"]

    assert root_errors["incremental"] == 1
    assert root_errors["cumulative"] == 3
    assert child_errors["incremental"] == 2
    assert child_errors["cumulative"] == 2


def test_connect_children_groups_duplicate_child_names_into_lists():
    root = _otel_span_from_flat(_span(span_id=ROOT_UUID, span_name="root"))
    child_a = _otel_span_from_flat(
        _span(
            span_id=CHILD_A_UUID,
            parent_id=ROOT_UUID,
            span_name="child",
            start_offset_s=1,
        )
    )
    child_b = _otel_span_from_flat(
        _span(
            span_id=CHILD_B_UUID,
            parent_id=ROOT_UUID,
            span_name="child",
            start_offset_s=2,
        )
    )

    spans_idx = {ROOT_UUID: root, CHILD_A_UUID: child_a, CHILD_B_UUID: child_b}
    tree = parse_span_idx_to_span_id_tree(spans_idx)

    connect_children(tree, spans_idx)

    assert root.spans is not None
    assert isinstance(root.spans["child"], list)
    assert len(root.spans["child"]) == 2


def test_calculate_costs_sets_incremental_values_for_cost_supported_types(monkeypatch):
    span = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=10,
        completion_tokens=20,
        span_type=SpanType.CHAT,
    )
    span_idx = {span.span_id: span}

    monkeypatch.setattr(
        "oss.src.core.tracing.utils.trees.cost_calculator.cost_per_token",
        lambda **_: (0.12, 0.34),
    )

    calculate_costs(span_idx)

    costs = span_idx[ROOT_UUID].attributes["ag"]["metrics"]["costs"]["incremental"]
    assert costs == {"prompt": 0.12, "completion": 0.34, "total": 0.46}


def test_calculate_costs_swallows_calculation_errors(monkeypatch):
    span = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=10,
        completion_tokens=20,
        span_type=SpanType.CHAT,
    )
    span_idx = {span.span_id: span}

    def _raise(**_):
        raise RuntimeError("boom")

    monkeypatch.setattr(
        "oss.src.core.tracing.utils.trees.cost_calculator.cost_per_token",
        _raise,
    )

    calculate_costs(span_idx)

    assert "incremental" in span_idx[ROOT_UUID].attributes["ag"]["metrics"]["costs"]


@pytest.mark.parametrize("cache_token_key", ["cache_read", "cached"])
def test_calculate_costs_passes_cached_tokens_to_the_pricer(
    monkeypatch,
    cache_token_key,
):
    """Cached prompt tokens must reach litellm, which prices them far below fresh input.

    Both spellings have to be honoured: the logfire ingest path writes `cache_read`, the
    Vercel AI path writes `cached`. Reading only one silently overstates the other's cost.
    """
    span = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=25978,
        completion_tokens=100,
        cache_read_tokens=24540,
        cache_token_key=cache_token_key,
        span_type=SpanType.CHAT,
    )
    span_idx = {span.span_id: span}

    seen = {}

    def _capture(**kwargs):
        seen.update(kwargs)
        return (0.005, 0.001)

    monkeypatch.setattr(
        "oss.src.core.tracing.utils.trees.cost_calculator.cost_per_token",
        _capture,
    )

    calculate_costs(span_idx)

    assert seen["cache_read_input_tokens"] == 24540
    # The cached count is a SUBSET of the prompt total, not an addition to it. litellm
    # re-prices that slice itself, so the prompt total is passed through untouched;
    # subtracting the cached tokens here would understate cost instead of overstating it.
    assert seen["prompt_tokens"] == 25978


def test_calculate_costs_sends_the_cached_count_as_an_int(monkeypatch):
    """The count must reach litellm as an int, not the float this metric is stored as.

    litellm reads the cached slice back off `Usage.prompt_tokens_details.cached_tokens`,
    and its `Usage` model only builds that wrapper from an int -- given a float it leaves
    `prompt_tokens_details` None and bills every token at the full input rate again. There
    is no exception to catch: the whole fix degrades to a no-op. Verified against litellm
    1.92.0, where `cost_per_token(..., cache_read_input_tokens=24540)` prices a 25,978-token
    Gemini prompt at $0.001168 and the same call with `24540.0` at $0.007793.
    """
    span = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=25978.0,
        completion_tokens=100.0,
        cache_read_tokens=24540.0,
        span_type=SpanType.CHAT,
    )
    span_idx = {span.span_id: span}

    seen = {}

    def _capture(**kwargs):
        seen.update(kwargs)
        return (0.001, 0.002)

    monkeypatch.setattr(
        "oss.src.core.tracing.utils.trees.cost_calculator.cost_per_token",
        _capture,
    )

    calculate_costs(span_idx)

    assert isinstance(seen["cache_read_input_tokens"], int)
    assert not isinstance(seen["cache_read_input_tokens"], bool)
    assert seen["cache_read_input_tokens"] == 24540


def test_calculate_costs_omits_cache_kwarg_when_nothing_was_cached(monkeypatch):
    """A span with no caching must call exactly the signature it always did.

    The SDK pins `litellm>=1,<2`, and `calculate_costs` swallows every exception. On a 1.x
    old enough to lack the parameter, passing it unconditionally would raise TypeError and
    be swallowed into "no costs at all" for EVERY span, not just cached ones -- so the
    pricer is called here with a signature that accepts nothing else.
    """
    span = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=10,
        completion_tokens=20,
        span_type=SpanType.CHAT,
    )
    span_idx = {span.span_id: span}

    def _legacy_signature(model, prompt_tokens, completion_tokens):
        return (0.1, 0.2)

    monkeypatch.setattr(
        "oss.src.core.tracing.utils.trees.cost_calculator.cost_per_token",
        _legacy_signature,
    )

    calculate_costs(span_idx)

    costs = span_idx[ROOT_UUID].attributes["ag"]["metrics"]["costs"]["incremental"]
    assert costs["prompt"] == pytest.approx(0.1)
    assert costs["completion"] == pytest.approx(0.2)
    assert costs["total"] == pytest.approx(0.3)


def test_calculate_costs_ignores_a_zero_cached_count(monkeypatch):
    """An explicit zero is a cache miss, not a cached slice: still the legacy signature."""
    span = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=10,
        completion_tokens=20,
        cache_read_tokens=0,
        span_type=SpanType.CHAT,
    )
    span_idx = {span.span_id: span}

    def _legacy_signature(model, prompt_tokens, completion_tokens):
        return (0.1, 0.2)

    monkeypatch.setattr(
        "oss.src.core.tracing.utils.trees.cost_calculator.cost_per_token",
        _legacy_signature,
    )

    calculate_costs(span_idx)

    costs = span_idx[ROOT_UUID].attributes["ag"]["metrics"]["costs"]["incremental"]
    assert costs["total"] == pytest.approx(0.3)


def test_calculate_costs_ignores_a_non_numeric_cached_count(monkeypatch):
    """Garbage in the cache field must not cost the span its ENTIRE cost.

    A foreign OTLP source can write anything under `tokens.incremental`. A truthy
    non-numeric value that reached `int()` would raise inside the try, and the bare
    `except` would swallow it into "no costs at all" for the span -- a regression
    against the pre-fix behaviour, where a garbage cache field was simply ignored
    and prompt/completion were still priced.
    """
    span = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=10,
        completion_tokens=20,
        cache_read_tokens="24540",
        span_type=SpanType.CHAT,
    )
    span_idx = {span.span_id: span}

    def _legacy_signature(model, prompt_tokens, completion_tokens):
        return (0.1, 0.2)

    monkeypatch.setattr(
        "oss.src.core.tracing.utils.trees.cost_calculator.cost_per_token",
        _legacy_signature,
    )

    calculate_costs(span_idx)

    costs = span_idx[ROOT_UUID].attributes["ag"]["metrics"]["costs"]["incremental"]
    assert costs["prompt"] == pytest.approx(0.1)
    assert costs["completion"] == pytest.approx(0.2)
    assert costs["total"] == pytest.approx(0.3)


def test_calculate_costs_ignores_a_negative_cached_count(monkeypatch):
    """A negative count is not a cached slice: still the legacy signature.

    Negative is truthy, so without the numeric guard it would reach the pricer,
    where "fresh = prompt - cached" arithmetic turns it into an overstated cost.
    """
    span = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=10,
        completion_tokens=20,
        cache_read_tokens=-5,
        span_type=SpanType.CHAT,
    )
    span_idx = {span.span_id: span}

    def _legacy_signature(model, prompt_tokens, completion_tokens):
        return (0.1, 0.2)

    monkeypatch.setattr(
        "oss.src.core.tracing.utils.trees.cost_calculator.cost_per_token",
        _legacy_signature,
    )

    calculate_costs(span_idx)

    costs = span_idx[ROOT_UUID].attributes["ag"]["metrics"]["costs"]["incremental"]
    assert costs["total"] == pytest.approx(0.3)


def test_calculate_costs_prefers_cache_read_over_cached_when_both_present(monkeypatch):
    """`cache_read` wins when both aliases appear on one span.

    No ingest adapter writes both today, but the precedence should be pinned:
    `cache_read` is the spelling the runner emits and the logfire path stores.
    """
    span = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=25978,
        completion_tokens=100,
        cache_read_tokens=24540,
        span_type=SpanType.CHAT,
    )
    span.attributes["ag"]["metrics"]["tokens"]["incremental"]["cached"] = 999
    span_idx = {span.span_id: span}

    seen = {}

    def _capture(**kwargs):
        seen.update(kwargs)
        return (0.001, 0.002)

    monkeypatch.setattr(
        "oss.src.core.tracing.utils.trees.cost_calculator.cost_per_token",
        _capture,
    )

    calculate_costs(span_idx)

    assert seen["cache_read_input_tokens"] == 24540


def test_calculate_costs_bills_cached_tokens_below_fresh_input(monkeypatch):
    """End-to-end shape of #5711, with the pricer modelling litellm's published contract.

    The reported case: a 25,978-token prompt of which 24,540 came from cache, on a model
    whose cached rate is a tenth of its input rate. Billing every token at the full input
    rate is what produced the 6.6x overstatement.
    """
    input_rate = 0.30 / 1_000_000
    cached_rate = input_rate / 10
    output_rate = 2.50 / 1_000_000

    def _priced(model, prompt_tokens, completion_tokens, cache_read_input_tokens=0):
        fresh = prompt_tokens - cache_read_input_tokens
        return (
            fresh * input_rate + cache_read_input_tokens * cached_rate,
            completion_tokens * output_rate,
        )

    monkeypatch.setattr(
        "oss.src.core.tracing.utils.trees.cost_calculator.cost_per_token",
        _priced,
    )

    cached = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=25978,
        completion_tokens=100,
        cache_read_tokens=24540,
        span_type=SpanType.CHAT,
    )
    uncached = _span(
        span_id=CHILD_A_UUID,
        span_name="root",
        prompt_tokens=25978,
        completion_tokens=100,
        span_type=SpanType.CHAT,
    )

    calculate_costs({cached.span_id: cached})
    calculate_costs({uncached.span_id: uncached})

    cached_costs = cached.attributes["ag"]["metrics"]["costs"]["incremental"]
    uncached_costs = uncached.attributes["ag"]["metrics"]["costs"]["incremental"]

    assert cached_costs["total"] < uncached_costs["total"]
    # Compared on the prompt component, which is the part caching changes -- the issue's
    # 6.6x is a prompt-side ratio, and folding in the (identical) completion cost would
    # dilute it to ~5.7x. Same call, same token counts: the only difference is whether the
    # cached slice was priced as cached. Before the fix both paths produced the high number.
    assert uncached_costs["prompt"] / cached_costs["prompt"] == pytest.approx(
        6.67,
        abs=0.01,
    )


def test_calculate_and_propagate_metrics_runs_full_pipeline(monkeypatch):
    root = _span(
        span_id=ROOT_UUID,
        span_name="root",
        prompt_tokens=1,
        completion_tokens=1,
        span_type=SpanType.CHAT,
    )
    child = _span(
        span_id=CHILD_A_UUID,
        parent_id=ROOT_UUID,
        span_name="child",
        prompt_tokens=2,
        completion_tokens=3,
        errors=1,
        span_type=SpanType.CHAT,
        start_offset_s=1,
    )

    monkeypatch.setattr(
        "oss.src.core.tracing.utils.trees.cost_calculator.cost_per_token",
        lambda model, prompt_tokens, completion_tokens: (
            prompt_tokens * 0.01,
            completion_tokens * 0.02,
        ),
    )

    out = calculate_and_propagate_metrics([deepcopy(root), deepcopy(child)])
    out_idx = {span.span_id: span for span in out}

    root_tokens = out_idx[ROOT_UUID].attributes["ag"]["metrics"]["tokens"]["cumulative"]
    root_costs = out_idx[ROOT_UUID].attributes["ag"]["metrics"]["costs"]["cumulative"]
    root_errors = out_idx[ROOT_UUID].attributes["ag"]["metrics"]["errors"]["cumulative"]

    assert root_tokens["total"] == 7
    assert round(root_costs["total"], 6) == round(
        (1 * 0.01 + 1 * 0.02) + (2 * 0.01 + 3 * 0.02), 6
    )
    assert root_errors == 1


def test_infer_and_propagate_trace_type_by_trace_preserves_input_order():
    trace_a = "trace-a"
    trace_b = "trace-b"
    spans = [
        _span(span_id="span-a1", span_name="a1", trace_id=trace_a, start_offset_s=0),
        _span(
            span_id="span-b1",
            span_name="b1",
            trace_id=trace_b,
            start_offset_s=1,
            links=[OTelLink(trace_id=trace_a, span_id="span-a1")],
        ),
        _span(span_id="span-a2", span_name="a2", trace_id=trace_a, start_offset_s=2),
        _span(span_id="span-b2", span_name="b2", trace_id=trace_b, start_offset_s=3),
    ]

    out = infer_and_propagate_trace_type_by_trace(spans)

    assert [span.span_id for span in out] == [
        "span-a1",
        "span-b1",
        "span-a2",
        "span-b2",
    ]
    assert out[0].trace_type == TraceType.INVOCATION
    assert out[1].trace_type == TraceType.ANNOTATION
    assert out[2].trace_type == TraceType.INVOCATION
    assert out[3].trace_type == TraceType.ANNOTATION
    assert out[0].attributes["ag"]["type"]["trace"] == TraceType.INVOCATION.value
    assert out[1].attributes["ag"]["type"]["trace"] == TraceType.ANNOTATION.value


def test_infer_and_propagate_trace_type_by_trace_treats_empty_links_as_annotation():
    # A queue annotation on a testcase has no link target, so the frontend sends
    # links={}, which build_otel_links converts to an empty list []. An explicitly
    # set (even empty) links list means annotation; only None means invocation.
    trace_a = "trace-a"
    trace_b = "trace-b"
    spans = [
        _span(span_id="span-a1", span_name="a1", trace_id=trace_a, links=None),
        _span(span_id="span-b1", span_name="b1", trace_id=trace_b, links=[]),
    ]

    out = infer_and_propagate_trace_type_by_trace(spans)

    out_idx = {span.span_id: span for span in out}
    assert out_idx["span-a1"].trace_type == TraceType.INVOCATION
    assert out_idx["span-b1"].trace_type == TraceType.ANNOTATION
    assert (
        out_idx["span-a1"].attributes["ag"]["type"]["trace"]
        == TraceType.INVOCATION.value
    )
    assert (
        out_idx["span-b1"].attributes["ag"]["type"]["trace"]
        == TraceType.ANNOTATION.value
    )


def test_trace_map_to_traces_and_back_and_get_span_helpers():
    root = _otel_span_from_flat(_span(span_id=ROOT_UUID, span_name="root"))
    child = _otel_span_from_flat(
        _span(
            span_id=CHILD_A_UUID,
            parent_id=ROOT_UUID,
            span_name="child",
            start_offset_s=1,
        )
    )

    trace_map = {TRACE_UUID: {"spans": {"root": root, "children": [child]}}}

    traces = trace_map_to_traces(trace_map)
    assert len(traces) == 1
    assert traces[0].trace_id == TRACE_UUID

    rebuilt = traces_to_trace_map(traces)
    assert TRACE_UUID in rebuilt

    trace = Trace(trace_id=TRACE_UUID, spans={"root": root, "children": [child]})
    assert get_span_from_trace(trace, ROOT_UUID) is not None
    assert get_span_from_trace(trace, CHILD_A_UUID) is not None
    assert get_span_from_trace(trace, str(UUID(int=1))) is None


def test_promote_identity_by_trace_lifts_root_only():
    root = _span(
        span_id=ROOT_UUID,
        span_name="root",
        session_id="sess-1",
        user_id="user-1",
        agent_id="agent-1",
    )
    child = _span(
        span_id=CHILD_A_UUID,
        parent_id=ROOT_UUID,
        span_name="child",
        start_offset_s=1,
    )

    out = promote_identity_by_trace([root, child])
    out_idx = {span.span_id: span for span in out}

    assert out_idx[ROOT_UUID].session_id == "sess-1"
    assert out_idx[ROOT_UUID].user_id == "user-1"
    assert out_idx[ROOT_UUID].agent_id == "agent-1"

    assert out_idx[CHILD_A_UUID].session_id is None
    assert out_idx[CHILD_A_UUID].user_id is None
    assert out_idx[CHILD_A_UUID].agent_id is None


def test_promote_identity_by_trace_is_per_trace_and_ignores_missing_attrs():
    trace_a = "trace-a"
    trace_b = "trace-b"

    root_a = _span(
        span_id="root-a",
        span_name="root",
        trace_id=trace_a,
        session_id="sess-a",
    )
    root_b = _span(
        span_id="root-b",
        span_name="root",
        trace_id=trace_b,
    )

    out = promote_identity_by_trace([root_a, root_b])
    out_idx = {span.span_id: span for span in out}

    assert out_idx["root-a"].session_id == "sess-a"
    assert out_idx["root-b"].session_id is None
    assert out_idx["root-b"].user_id is None
    assert out_idx["root-b"].agent_id is None


def test_promote_identity_by_trace_empty_list_is_noop():
    assert promote_identity_by_trace([]) == []
