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
    span_idx = {span.span_id: span for span in span_dtos}

    return span_idx


def calculate_and_propagate_metrics(
    span_dtos: List[OTelFlatSpan],
) -> List[OTelFlatSpan]:
    """
    Calculate and propagate costs/tokens/errors for a list of span DTOs.

    Give it the complete trace whenever you can: cumulative metrics are only as
    complete as the spans passed in. Over a partial trace it still propagates
    correctly within each subtree present - a span whose parent is missing is
    treated as a local root - but a root that arrives without its children ends
    up with only its own metrics. `TracingService.ingest` therefore recomputes
    over the stored trace after each batch is written, which is what makes the
    numbers whole for traces split across several OTLP batches.

    Calling it repeatedly is safe: cumulative values are derived from
    incremental ones and overwritten, never accumulated onto the previous result.

    Args:
        span_dtos: List of span DTOs (ideally a complete trace)

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
    Build the span-id tree for a set of spans.

    A span whose parent is absent from `span_idx` becomes a LOCAL ROOT rather
    than being dropped. One trace routinely reaches the API in several OTLP
    batches from different processes - an in-sandbox agent harness exports the
    spans it produces, and the SDK exports the workflow root about a second
    later - so a batch commonly holds a subtree whose parent lives in another
    batch. Dropping those spans would leave the entire subtree out of the tree,
    and no cumulative metric would ever be computed for any of it.

    Spans caught in a parent cycle stay out of the tree, so the depth-first
    walks over the result always terminate.
    """
    span_id_tree = OrderedDict()
    index = OrderedDict()

    ordered = sorted(span_idx.values(), key=lambda span_dto: span_dto.start_time)

    # Seed every node first so placement does not depend on a parent having an
    # earlier start_time than its children.
    for span_dto in ordered:
        index[span_dto.span_id] = OrderedDict()

    for span_dto in ordered:
        parent_id = span_dto.parent_id

        if parent_id is not None and parent_id in index:
            index[parent_id][span_dto.span_id] = index[span_dto.span_id]
        else:
            span_id_tree[span_dto.span_id] = index[span_dto.span_id]

    return span_id_tree


def connect_children(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, dict],
) -> None:
    _connect_tree_dfs(spans_id_tree, spans_idx)


def _connect_tree_dfs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelSpan],
):
    for span_id, children_spans_id_tree in spans_id_tree.items():
        children_spans_id_tree: OrderedDict

        parent_span = spans_idx[span_id]

        parent_span.spans = dict()

        _connect_tree_dfs(children_spans_id_tree, spans_idx)

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


def cumulate_costs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelFlatSpan],
) -> None:
    def _get_incremental(span: OTelFlatSpan):
        _costs = {
            "prompt": 0.0,
            "completion": 0.0,
            "total": 0.0,
        }

        if span.attributes is None:
            return _costs

        attr: dict = span.attributes

        return {
            "prompt": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("costs", {})
                .get("incremental", {})
                .get("prompt", 0.0)
            ),
            "completion": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("costs", {})
                .get("incremental", {})
                .get("completion", 0.0)
            ),
            "total": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("costs", {})
                .get("incremental", {})
                .get("total", 0.0)
            ),
        }

    def _get_cumulative(span: OTelFlatSpan):
        _costs = {
            "prompt": 0.0,
            "completion": 0.0,
            "total": 0.0,
        }

        if span.attributes is None:
            return _costs

        attr: dict = span.attributes

        return {
            "prompt": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("costs", {})
                .get("cumulative", {})
                .get("prompt", 0.0)
            ),
            "completion": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("costs", {})
                .get("cumulative", {})
                .get("completion", 0.0)
            ),
            "total": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("costs", {})
                .get("cumulative", {})
                .get("total", 0.0)
            ),
        }

    def _accumulate(a: dict, b: dict):
        return {
            "prompt": a.get("prompt", 0.0) + b.get("prompt", 0.0),
            "completion": a.get("completion", 0.0) + b.get("completion", 0.0),
            "total": a.get("total", 0.0) + b.get("total", 0.0),
        }

    def _set_cumulative(span: OTelFlatSpan, costs: dict):
        if span.attributes is None:
            span.attributes = {}

        if (
            costs.get("prompt", 0.0) != 0.0
            or costs.get("completion", 0.0) != 0.0
            or costs.get("total", 0.0) != 0.0
        ):
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

            span.attributes["ag"]["metrics"]["costs"]["cumulative"] = costs

    _cumulate_tree_dfs(
        spans_id_tree,
        spans_idx,
        _get_incremental,
        _get_cumulative,
        _accumulate,
        _set_cumulative,
        prefer_children=True,
    )


def cumulate_tokens(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelFlatSpan],
) -> None:
    def _get_incremental(span: OTelFlatSpan):
        _tokens = {
            "prompt": 0.0,
            "completion": 0.0,
            "total": 0.0,
        }

        if span.attributes is None:
            return _tokens

        attr: dict = span.attributes

        return {
            "prompt": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("tokens", {})
                .get("incremental", {})
                .get("prompt", 0.0)
            ),
            "completion": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("tokens", {})
                .get("incremental", {})
                .get("completion", 0.0)
            ),
            "total": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("tokens", {})
                .get("incremental", {})
                .get("total", 0.0)
            ),
        }

    def _get_cumulative(span: OTelFlatSpan):
        _tokens = {
            "prompt": 0.0,
            "completion": 0.0,
            "total": 0.0,
        }

        if span.attributes is None:
            return _tokens

        attr: dict = span.attributes

        return {
            "prompt": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("tokens", {})
                .get("cumulative", {})
                .get("prompt", 0.0)
            ),
            "completion": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("tokens", {})
                .get("cumulative", {})
                .get("completion", 0.0)
            ),
            "total": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("tokens", {})
                .get("cumulative", {})
                .get("total", 0.0)
            ),
        }

    def _accumulate(a: dict, b: dict):
        return {
            "prompt": a.get("prompt", 0.0) + b.get("prompt", 0.0),
            "completion": a.get("completion", 0.0) + b.get("completion", 0.0),
            "total": a.get("total", 0.0) + b.get("total", 0.0),
        }

    def _set_cumulative(span: OTelFlatSpan, tokens: dict):
        if span.attributes is None:
            span.attributes = {}

        if (
            tokens.get("prompt", 0.0) != 0.0
            or tokens.get("completion", 0.0) != 0.0
            or tokens.get("total", 0.0) != 0.0
        ):
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

            if "tokens" not in span.attributes["ag"]["metrics"] or not isinstance(
                span.attributes["ag"]["metrics"]["tokens"],
                dict,
            ):
                span.attributes["ag"]["metrics"]["tokens"] = {}

            span.attributes["ag"]["metrics"]["tokens"]["cumulative"] = tokens

    _cumulate_tree_dfs(
        spans_id_tree,
        spans_idx,
        _get_incremental,
        _get_cumulative,
        _accumulate,
        _set_cumulative,
        prefer_children=True,
    )


def cumulate_errors(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelFlatSpan],
) -> None:
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


def _is_non_zero(metric) -> bool:
    if isinstance(metric, dict):
        return any(value for value in metric.values())

    return bool(metric)


def _is_model_call(span: OTelFlatSpan) -> bool:
    """Whether the span calls a model itself, so its usage is its own spend."""
    return bool(span.span_type) and span.span_type.name.lower() in TYPES_WITH_COSTS


def _cumulate_tree_dfs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelFlatSpan],
    get_incremental,
    get_cumulative,
    accumulate,
    set_cumulative,
    prefer_children: bool = False,
):
    for span_id, children_spans_id_tree in spans_id_tree.items():
        children_spans_id_tree: OrderedDict

        own_metric = get_incremental(spans_idx[span_id])

        _cumulate_tree_dfs(
            children_spans_id_tree,
            spans_idx,
            get_incremental,
            get_cumulative,
            accumulate,
            set_cumulative,
            prefer_children,
        )

        children_metric = None

        for child_span_id in children_spans_id_tree.keys():
            marginal_metric = get_cumulative(spans_idx[child_span_id])

            children_metric = (
                marginal_metric
                if children_metric is None
                else accumulate(children_metric, marginal_metric)
            )

        if children_metric is None:
            cumulated_metric = own_metric
        elif (
            prefer_children
            and _is_non_zero(children_metric)
            and not _is_model_call(spans_idx[span_id])
        ):
            # Usage on a span that cannot call a model itself is a roll-up of
            # the calls its children already report: an agent harness stamps the
            # run total on the agent span, and the per-call chat spans repeat
            # it. Adding both would count every call twice. A span whose
            # children report nothing still falls back to its own figure, which
            # is what keeps runs with no per-call instrumentation working.
            cumulated_metric = children_metric
        else:
            cumulated_metric = accumulate(own_metric, children_metric)

        set_cumulative(spans_idx[span_id], cumulated_metric)


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

            # A cost reported by the instrumentation itself (gen_ai.usage.cost)
            # is authoritative and must not be replaced by a pricing-table
            # estimate: the harness or gateway knows the price actually charged,
            # which public pricing cannot reproduce for proxied, aliased or
            # negotiated models.
            reported_cost = (
                attr.get("ag", {})
                .get("metrics", {})
                .get("costs", {})
                .get("incremental", {})
                .get("total")
            )

            if reported_cost:
                continue

            model = attr.get("ag", {}).get("meta", {}).get("response", {}).get(
                "model"
            ) or attr.get("ag", {}).get("data", {}).get("parameters", {}).get("model")

            tokens: dict = (
                attr.get("ag", {})
                .get("metrics", {})
                .get("tokens", {})
                .get("incremental", {})
            )

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
