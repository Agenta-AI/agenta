from collections import OrderedDict
from typing import Dict, List, Optional

from litellm import cost_calculator

from oss.src.utils.logging import get_module_logger
from oss.src.core.shared.dtos import Trace, Traces
from oss.src.core.tracing.dtos import (
    OTelFlatSpan,
    OTelSpan,
    OTelSpansTree,
    OTelTraceTree,
    Span,
    TraceType,
)

log = get_module_logger(__name__)


def parse_span_dtos_to_span_idx(
    span_dtos: List[OTelFlatSpan],
) -> Dict[str, OTelFlatSpan]:
    """Index the batch's spans by span id."""

    span_idx = {span.span_id: span for span in span_dtos}

    return span_idx


def calculate_and_propagate_metrics(
    span_dtos: List[OTelFlatSpan],
) -> List[OTelFlatSpan]:
    """
    Calculate and propagate costs/tokens/errors for a list of span DTOs.

    Roll-up is batch-local: a span sums only the children present in this call.

    Args:
        span_dtos: List of span DTOs (should be from a complete trace)

    Returns:
        List of span DTOs with calculated and propagated costs/tokens/errors
    """
    if not span_dtos:
        return span_dtos

    # Build span index and tree
    span_idx = parse_span_dtos_to_span_idx(span_dtos)
    span_id_tree = parse_span_idx_to_span_id_tree(span_idx)

    # Calculate incremental costs from token counts
    calculate_costs(span_idx)

    # Propagate costs up the tree (children to parents)
    cumulate_costs(span_id_tree, span_idx)

    # Propagate tokens up the tree (children to parents)
    cumulate_tokens(span_id_tree, span_idx)

    # Propagate errors up the tree (children to parents)
    cumulate_errors(span_id_tree, span_idx)

    # Return updated span DTOs
    return list(span_idx.values())


def calculate_and_propagate_metrics_by_trace(
    span_dtos: List[OTelFlatSpan],
) -> List[OTelFlatSpan]:
    """
    Calculate metrics for each trace independently within a mixed batch.

    Some ingestion requests can carry spans from multiple traces. Metric
    propagation must remain trace-local, so we group by trace_id first and
    process each trace tree separately before flattening back to one list.
    """
    if not span_dtos:
        return span_dtos

    spans_by_trace: Dict[str, List[OTelFlatSpan]] = {}

    for span_dto in span_dtos:
        trace_key = str(span_dto.trace_id)
        spans_by_trace.setdefault(trace_key, []).append(span_dto)

    processed: List[OTelFlatSpan] = []
    for trace_spans in spans_by_trace.values():
        processed.extend(calculate_and_propagate_metrics(trace_spans))

    return processed


def infer_and_propagate_trace_type_by_trace(
    span_dtos: List[OTelFlatSpan],
) -> List[OTelFlatSpan]:
    """
    Infer trace type once per trace from span links and propagate it to every span.

    A trace is an annotation iff any span in that trace explicitly sets links, even
    an empty list (e.g. a queue annotation on a testcase, which has no link target).
    Only missing links (None on every span) means the trace is an invocation.
    """
    if not span_dtos:
        return span_dtos

    trace_types_by_trace: Dict[str, TraceType] = {}
    spans_by_trace: Dict[str, List[OTelFlatSpan]] = {}

    for span_dto in span_dtos:
        trace_key = str(span_dto.trace_id)
        spans_by_trace.setdefault(trace_key, []).append(span_dto)

    for trace_spans in spans_by_trace.values():
        trace_key = str(trace_spans[0].trace_id)
        inferred_trace_type = (
            TraceType.ANNOTATION
            if any(span.links is not None for span in trace_spans)
            else TraceType.INVOCATION
        )
        trace_types_by_trace[trace_key] = inferred_trace_type

    for span in span_dtos:
        inferred_trace_type = trace_types_by_trace[str(span.trace_id)]
        span.trace_type = inferred_trace_type

        if span.attributes is None:
            span.attributes = {}

        ag = span.attributes.setdefault("ag", {})
        if not isinstance(ag, dict):
            ag = {}
            span.attributes["ag"] = ag

        ag_type = ag.setdefault("type", {})
        if not isinstance(ag_type, dict):
            ag_type = {}
            ag["type"] = ag_type

        ag_type["trace"] = inferred_trace_type.value

    return span_dtos


def promote_identity_by_trace(
    span_dtos: List[OTelFlatSpan],
) -> List[OTelFlatSpan]:
    """
    Lift session/user/agent identity from the root span's attributes onto its
    own session_id/user_id/agent_id columns.

    Root-only: ingestion is span-by-span / partial-batch, so there is no cheap
    way to propagate identity from a root to children arriving in a different
    request. Children are left untouched (nullable columns).
    """
    if not span_dtos:
        return span_dtos

    for span_dto in span_dtos:
        if span_dto.parent_id is not None:
            continue

        attributes = span_dto.attributes or {}
        ag = attributes.get("ag") or {}

        session = ag.get("session") or {}
        user = ag.get("user") or {}
        agent = ag.get("agent") or {}

        span_dto.session_id = session.get("id") if isinstance(session, dict) else None
        span_dto.user_id = user.get("id") if isinstance(user, dict) else None
        span_dto.agent_id = agent.get("id") if isinstance(agent, dict) else None

    return span_dtos


def parse_span_idx_to_span_id_tree(
    span_idx: Dict[str, OTelFlatSpan],
) -> OrderedDict:
    """
    Build the forest of span trees for one batch of spans.

    A span whose parent is not in the batch is a root: a trace can arrive split across
    OTLP requests (the agent runner ships its subtree under a parent from the SDK's
    request). Each span has one parent, so it lands in at most one tree; spans in a
    parent cycle reach no root and are left out.
    """
    span_id_tree = OrderedDict()
    children_by_parent_id: Dict[str, List[OTelFlatSpan]] = {}
    roots: List[OTelFlatSpan] = []

    for span_dto in sorted(span_idx.values(), key=lambda span_dto: span_dto.start_time):
        if span_dto.parent_id is None or span_dto.parent_id not in span_idx:
            roots.append(span_dto)
        else:
            children_by_parent_id.setdefault(span_dto.parent_id, []).append(span_dto)

    stack = [(span_dto, span_id_tree) for span_dto in reversed(roots)]

    while stack:
        span_dto, siblings = stack.pop()

        children = OrderedDict()
        siblings[span_dto.span_id] = children

        for child_span_dto in reversed(children_by_parent_id.get(span_dto.span_id, [])):
            stack.append((child_span_dto, children))

    return span_id_tree


def connect_children(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, dict],
) -> None:
    """Attach each span's children to its `spans` field, grouped by span name."""

    _connect_tree_dfs(spans_id_tree, spans_idx)


def _connect_tree_dfs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelSpan],
):
    """Fill `spans` on every span in the tree; a repeated child name becomes a list."""

    # Iterative post-order walk: deep span chains must not hit the recursion limit.
    stack = [(span_id, children, False) for span_id, children in spans_id_tree.items()]

    while stack:
        span_id, children_spans_id_tree, expanded = stack.pop()

        if not expanded:
            stack.append((span_id, children_spans_id_tree, True))
            stack.extend(
                (cid, grandchildren, False)
                for cid, grandchildren in children_spans_id_tree.items()
            )
            continue

        parent_span = spans_idx[span_id]

        parent_span.spans = dict()

        for child_span_id in children_spans_id_tree.keys():
            child_span_name = spans_idx[child_span_id].span_name
            if child_span_name not in parent_span.spans:
                parent_span.spans[child_span_name] = spans_idx[child_span_id]
            else:
                if not isinstance(parent_span.spans[child_span_name], list):
                    parent_span.spans[child_span_name] = [
                        parent_span.spans[child_span_name]
                    ]

                parent_span.spans[child_span_name].append(spans_idx[child_span_id])

        if len(parent_span.spans) == 0:
            parent_span.spans = None


BREAKDOWN_KEYS = ("prompt", "completion", "total")


def _read_breakdown(span: OTelFlatSpan, metric: str, bucket: str) -> Dict[str, float]:
    """The numeric prompt/completion/total values the span carries, keyed by presence.

    Present-and-zero and absent are different facts: a measured 0 must roll up as 0,
    while an unknown value must not be reported as 0.
    """
    node = span.attributes
    for key in ("ag", "metrics", metric, bucket):
        if not isinstance(node, dict):
            return {}
        node = node.get(key)

    if not isinstance(node, dict):
        return {}

    values = {}
    for key in BREAKDOWN_KEYS:
        value = node.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            values[key] = value

    if "total" not in values and ("prompt" in values or "completion" in values):
        values["total"] = values.get("prompt", 0.0) + values.get("completion", 0.0)

    return values


def _sum_breakdowns(a: Dict[str, float], b: Dict[str, float]) -> Dict[str, float]:
    """Add two breakdowns key by key, keeping only the keys either side reports."""

    if not b:
        return a
    if not a:
        return dict(b)

    summed = dict(a)
    for key, value in b.items():
        summed[key] = summed.get(key, 0.0) + value

    return summed


def _write_cumulative(span: OTelFlatSpan, metric: str, values: Dict[str, float]):
    """Store `values` as the span's cumulative `metric`. An empty breakdown writes nothing."""

    if not values:
        return

    if span.attributes is None:
        span.attributes = {}

    node = span.attributes
    for key in ("ag", "metrics", metric):
        if not isinstance(node.get(key), dict):
            node[key] = {}
        node = node[key]

    node["cumulative"] = values


def _is_model_call(span: OTelFlatSpan) -> bool:
    """Whether the span is a model call (chat, completion, embedding, query, rerank)."""

    return (
        span.span_type is not None and span.span_type.name.lower() in TYPES_WITH_COSTS
    )


def _combine_breakdowns(
    span: OTelFlatSpan,
    own: Dict[str, float],
    children: Optional[Dict[str, float]],
) -> Dict[str, float]:
    """Combine a span's own breakdown with its children's summed cumulative breakdown.

    A model call adds both. Any other span keeps the larger side, since its own value
    can only summarize the calls inside it."""

    if not children:
        return own
    if not own:
        return children
    if _is_model_call(span):
        return _sum_breakdowns(own, children)
    # A non-model span's own usage can only summarize model calls made inside it, which
    # may or may not be traced as its children, so the larger side is the whole picture.
    if own.get("total", 0.0) >= children.get("total", 0.0):
        return own
    return children


def _cumulate_breakdown(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelFlatSpan],
    metric: str,
) -> None:
    """Roll `metric` (costs or tokens) up the tree, from the leaves to the roots."""

    _cumulate_tree_dfs(
        spans_id_tree,
        spans_idx,
        lambda span: _read_breakdown(span, metric, "incremental"),
        lambda span: _read_breakdown(span, metric, "cumulative"),
        _sum_breakdowns,
        lambda span, values: _write_cumulative(span, metric, values),
        combine=_combine_breakdowns,
    )


def cumulate_costs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelFlatSpan],
) -> None:
    """Write each span's cumulative cost from its own cost and its children's."""

    _cumulate_breakdown(spans_id_tree, spans_idx, "costs")


def cumulate_tokens(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelFlatSpan],
) -> None:
    """Write each span's cumulative token counts from its own and its children's."""

    _cumulate_breakdown(spans_id_tree, spans_idx, "tokens")


def cumulate_errors(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelFlatSpan],
) -> None:
    """Write each span's cumulative error count: its own errors plus its children's."""

    def _get_incremental(span: OTelFlatSpan):
        if span.attributes is None:
            return 0

        value = (
            span.attributes.get("ag", {})
            .get("metrics", {})
            .get("errors", {})
            .get("incremental", 0)
        )
        return value if isinstance(value, (int, float)) else 0

    def _get_cumulative(span: OTelFlatSpan):
        if span.attributes is None:
            return 0

        value = (
            span.attributes.get("ag", {})
            .get("metrics", {})
            .get("errors", {})
            .get("cumulative", 0)
        )
        return value if isinstance(value, (int, float)) else 0

    def _accumulate(a, b):
        return a + b

    def _set_cumulative(span: OTelFlatSpan, errors):
        if span.attributes is None:
            span.attributes = {}

        if errors != 0:
            if "ag" not in span.attributes or not isinstance(
                span.attributes["ag"],
                dict,
            ):
                span.attributes["ag"] = {}

            if "metrics" not in span.attributes["ag"] or not isinstance(
                span.attributes["ag"]["metrics"],
                dict,
            ):
                span.attributes["ag"]["metrics"] = {}

            if "errors" not in span.attributes["ag"]["metrics"] or not isinstance(
                span.attributes["ag"]["metrics"]["errors"],
                dict,
            ):
                span.attributes["ag"]["metrics"]["errors"] = {}

            span.attributes["ag"]["metrics"]["errors"]["cumulative"] = errors

    _cumulate_tree_dfs(
        spans_id_tree,
        spans_idx,
        _get_incremental,
        _get_cumulative,
        _accumulate,
        _set_cumulative,
    )


def _cumulate_tree_dfs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelFlatSpan],
    get_incremental,
    get_cumulative,
    accumulate,
    set_cumulative,
    combine=None,
):
    """Compute a cumulative metric for every span, children before parents.

    Without `combine`, a span's value is its own value accumulated with its
    children's. With `combine`, `combine(span, own, children)` decides it."""

    # Iterative post-order walk: deep span chains must not hit the recursion limit.
    stack = [(span_id, children, False) for span_id, children in spans_id_tree.items()]

    while stack:
        span_id, children, expanded = stack.pop()

        if not expanded:
            stack.append((span_id, children, True))
            stack.extend(
                (cid, grandchildren, False) for cid, grandchildren in children.items()
            )
            continue

        span = spans_idx[span_id]
        own = get_incremental(span)

        children_metric = None
        for child_span_id in children:
            child_metric = get_cumulative(spans_idx[child_span_id])
            children_metric = (
                child_metric
                if children_metric is None
                else accumulate(children_metric, child_metric)
            )

        if combine is not None:
            cumulated_metric = combine(span, own, children_metric)
        elif children_metric is None:
            cumulated_metric = own
        else:
            cumulated_metric = accumulate(own, children_metric)

        set_cumulative(span, cumulated_metric)


TYPES_WITH_COSTS = [
    "embedding",
    "query",
    "completion",
    "chat",
    "rerank",
]

# Prompt tokens served from a provider's cache, which price at a much lower rate than fresh
# input (a tenth of it, for some models). The ingest adapters disagree on the field name:
# `logfire_adapter` writes `cache_read` (matching the `gen_ai.usage.cache_read.input_tokens`
# the runner emits), while `vercelai_adapter` writes `cached` (from `ai.usage.cachedInputTokens`).
# Read every alias, or the cost is right for one integration and overstated for the other.
CACHE_READ_TOKEN_KEYS = ("cache_read", "cached")


def calculate_costs(span_idx: Dict[str, OTelFlatSpan]):
    for span in span_idx.values():
        if (
            span.span_type
            and span.span_type.name.lower() in TYPES_WITH_COSTS
            and span.attributes
        ):
            attr: dict = span.attributes
            model = attr.get("ag", {}).get("meta", {}).get("response", {}).get(
                "model"
            ) or attr.get("ag", {}).get("data", {}).get("parameters", {}).get("model")

            tokens: dict = (
                attr.get("ag", {})
                .get("metrics", {})
                .get("tokens", {})
                .get("incremental", {})
            )

            incremental_costs = (
                attr.get("ag", {})
                .get("metrics", {})
                .get("costs", {})
                .get("incremental", {})
            )
            if (
                isinstance(incremental_costs, dict)
                and "total" in incremental_costs
                and "prompt" not in incremental_costs
                and "completion" not in incremental_costs
            ):
                continue

            prompt_tokens = tokens.get("prompt", 0.0)

            completion_tokens = tokens.get("completion", 0.0)

            # Only a real positive number qualifies. Non-numeric or negative garbage from a
            # foreign OTLP source must degrade to "no cache kwarg", not reach the int() below
            # and turn into a swallowed exception that drops the span's ENTIRE cost.
            cache_read_tokens = next(
                (
                    value
                    for key in CACHE_READ_TOKEN_KEYS
                    if isinstance((value := tokens.get(key)), (int, float))
                    and not isinstance(value, bool)
                    and value > 0
                ),
                0.0,
            )

            try:
                # litellm's convention is that `prompt_tokens` INCLUDES the cached tokens and
                # that it prices the cached slice separately (it normalizes Anthropic-style
                # usage, where the input count excludes them, on the way in). So the cached
                # count is passed ALONGSIDE the prompt total and must not be subtracted from
                # it first -- doing that would understate cost instead of overstating it.
                #
                # Passed only when non-zero so a span with no caching calls exactly the
                # signature it always did: the SDK pins `litellm>=1,<2`, and on a 1.x old
                # enough to lack the parameter an unconditional kwarg would raise TypeError,
                # which the `except` below would swallow into "no costs at all" for EVERY span.
                #
                # int(), and not incidentally: litellm reads the cached slice back off
                # `Usage.prompt_tokens_details.cached_tokens`, and its `Usage` model only
                # derives that wrapper from an int. Hand it the float this metric is stored
                # as and `prompt_tokens_details` comes back None, so the cached tokens are
                # billed at the full input rate again -- silently, with no error to catch.
                cache_kwargs = (
                    {"cache_read_input_tokens": int(cache_read_tokens)}
                    if cache_read_tokens
                    else {}
                )

                costs = cost_calculator.cost_per_token(
                    model=model,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    **cache_kwargs,
                )

                if not costs:
                    continue

                prompt_cost, completion_cost = costs
                total_cost = prompt_cost + completion_cost

                if "ag" not in span.attributes or not isinstance(
                    span.attributes["ag"],
                    dict,
                ):
                    span.attributes["ag"] = {}
                if "metrics" not in span.attributes["ag"] or not isinstance(
                    span.attributes["ag"]["metrics"],
                    dict,
                ):
                    span.attributes["ag"]["metrics"] = {}

                if "costs" not in span.attributes["ag"]["metrics"] or not isinstance(
                    span.attributes["ag"]["metrics"]["costs"],
                    dict,
                ):
                    span.attributes["ag"]["metrics"]["costs"] = {}

                span.attributes["ag"]["metrics"]["costs"]["incremental"] = {
                    "prompt": prompt_cost,
                    "completion": completion_cost,
                    "total": total_cost,
                }

            except Exception:  # pylint: disable=bare-except
                log.warn(
                    "Failed to calculate costs",
                    model=model,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    cache_read_tokens=cache_read_tokens,
                )


def trace_map_to_traces(trace_map: OTelTraceTree) -> Traces:
    traces: Traces = []
    for tid, spans_tree in trace_map.items():
        if isinstance(spans_tree, dict):
            spans = spans_tree.get("spans")
        else:
            spans = spans_tree.spans
        traces.append(Trace(trace_id=str(tid), spans=spans))
    return traces


def traces_to_trace_map(traces: Traces) -> OTelTraceTree:
    trace_map: OTelTraceTree = {}
    for trace in traces:
        if not trace.trace_id:
            continue
        trace_map[str(trace.trace_id)] = OTelSpansTree(spans=trace.spans)
    return trace_map


def get_span_from_trace(trace: Optional[Trace], span_id: str) -> Optional[Span]:
    if not trace or not trace.spans:
        return None
    for span in trace.spans.values():
        if isinstance(span, list):
            for item in span:
                if item and item.span_id == span_id:
                    return item
        elif span and span.span_id == span_id:
            return span
    return None
