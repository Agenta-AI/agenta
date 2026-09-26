from collections import OrderedDict
from typing import Dict, List, Optional

from oss.src.utils.logging import get_module_logger
from oss.src.core.shared.dtos import Trace, Traces
from oss.src.core.tracing.dtos import (
    OTelFlatSpan,
    OTelSpan,
    OTelSpansTree,
    OTelTraceTree,
    Span,
    SpanType,
    TraceType,
)
from oss.src.core.tracing.utils.pricing import price_tokens, resolve_pricing_model

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

    This must be called BEFORE batching to ensure complete trace trees.
    If called after batching, partial traces will fail to propagate correctly.

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
    span_id_tree = OrderedDict()
    index = {}

    def push(span_dto: OTelFlatSpan) -> None:
        if span_dto.parent_id is None:
            span_id_tree[span_dto.span_id] = OrderedDict()
            index[span_dto.span_id] = span_id_tree[span_dto.span_id]
        elif span_dto.parent_id in index:
            index[span_dto.parent_id][span_dto.span_id] = OrderedDict()
            index[span_dto.span_id] = index[span_dto.parent_id][span_dto.span_id]

    for span_dto in sorted(span_idx.values(), key=lambda span_dto: span_dto.start_time):
        push(span_dto)

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

        incremental = (
            span.attributes.get("ag", {})
            .get("metrics", {})
            .get("costs", {})
            .get("incremental", {})
        )
        has_reported_total = (
            isinstance(incremental, dict)
            and "total" in incremental
            and "prompt" not in incremental
            and "completion" not in incremental
        )
        if has_reported_total:
            costs = _get_incremental(span)

        if (
            has_reported_total
            or costs.get("prompt", 0.0) != 0.0
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

        incremental = (
            span.attributes.get("ag", {})
            .get("metrics", {})
            .get("tokens", {})
            .get("incremental", {})
        )
        has_workflow_total = (
            span.span_type == SpanType.WORKFLOW
            and isinstance(incremental, dict)
            and "total" in incremental
        )
        if has_workflow_total:
            # record_usage stamps the runner's whole-run total on the workflow
            # root. Its child model spans describe the same usage, not more usage.
            tokens = _get_incremental(span)

        if (
            has_workflow_total
            or tokens.get("prompt", 0.0) != 0.0
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


def _cumulate_tree_dfs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelFlatSpan],
    get_incremental,
    get_cumulative,
    accumulate,
    set_cumulative,
):
    for span_id, children_spans_id_tree in spans_id_tree.items():
        children_spans_id_tree: OrderedDict

        cumulated_metric = get_incremental(spans_idx[span_id])

        _cumulate_tree_dfs(
            children_spans_id_tree,
            spans_idx,
            get_incremental,
            get_cumulative,
            accumulate,
            set_cumulative,
        )

        for child_span_id in children_spans_id_tree.keys():
            marginal_metric = get_cumulative(spans_idx[child_span_id])
            cumulated_metric = accumulate(cumulated_metric, marginal_metric)

        set_cumulative(spans_idx[span_id], cumulated_metric)


TYPES_WITH_COSTS = [
    "embedding",
    "query",
    "llm",
    "completion",
    "chat",
    "rerank",
]

# Prompt tokens served from a provider's cache, which price far below fresh input. The
# adapters disagree on where they land: logfire writes `cache_read`, Vercel AI `cached`,
# and OpenInference `prompt_details.cache_read` (from `llm.token_count.prompt_details.*`).
CACHE_READ_TOKEN_KEYS = ("cache_read", "cached", ("prompt_details", "cache_read"))
CACHE_WRITE_TOKEN_KEYS = ("cache_creation", ("prompt_details", "cache_write"))


def _token_count(tokens: dict, keys) -> int:
    for key in keys:
        if isinstance(key, tuple):
            parent = tokens.get(key[0])
            value = parent.get(key[1]) if isinstance(parent, dict) else None
        else:
            value = tokens.get(key)

        # Non-numeric or negative garbage from a foreign OTLP source counts as absent.
        if (
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and value > 0
        ):
            return int(value)

    return 0


def _input_tokens_include_cache(meta: dict) -> bool:
    """Whether the prompt count already includes the cached tokens.

    Absent means True, the OpenTelemetry GenAI meaning of `gen_ai.usage.input_tokens`.
    The Agenta runner reports input without cache and says so with
    `agenta.usage.input_tokens_includes_cache = false`.
    """
    usage = meta.get("usage")
    marker = (
        usage.get("input_tokens_includes_cache") if isinstance(usage, dict) else None
    )

    if isinstance(marker, str):
        return marker.strip().lower() not in ("false", "0")

    return marker is not False


def _served_by_custom_connection(meta: dict) -> bool:
    model_meta = meta.get("model") if isinstance(meta, dict) else None
    if not isinstance(model_meta, dict):
        return False

    marker = model_meta.get("custom_connection")
    if isinstance(marker, str):
        return marker.strip().lower() in ("true", "1")

    return marker is True


def _set_pricing_status(span: OTelFlatSpan, reason: Optional[str], model) -> None:
    ag = span.attributes.setdefault("ag", {})
    meta = ag.get("meta")

    if reason is None:
        if isinstance(meta, dict):
            meta.pop("pricing", None)
        return

    if not isinstance(meta, dict):
        meta = ag["meta"] = {}

    meta["pricing"] = {"error": reason, "model": model}

    # A cost this function stored on an earlier run is stale once the span is unpriced.
    # A reported cost (a total with no split) never reaches this point.
    metrics = ag.get("metrics")
    costs = metrics.get("costs") if isinstance(metrics, dict) else None
    if isinstance(costs, dict):
        costs.pop("incremental", None)


def calculate_costs(span_idx: Dict[str, OTelFlatSpan]):
    for span in span_idx.values():
        if not (
            span.span_type
            and span.span_type.name.lower() in TYPES_WITH_COSTS
            and span.attributes
        ):
            continue

        attr: dict = span.attributes
        ag: dict = attr.get("ag", {})
        meta: dict = ag.get("meta", {})
        metrics: dict = ag.get("metrics", {})

        incremental_costs = metrics.get("costs", {}).get("incremental", {})
        if (
            isinstance(incremental_costs, dict)
            and "total" in incremental_costs
            and "prompt" not in incremental_costs
            and "completion" not in incremental_costs
        ):
            continue

        model = (
            meta.get("response", {}).get("model")
            or ag.get("data", {}).get("parameters", {}).get("model")
            or meta.get("request", {}).get("model")
        )

        tokens: dict = metrics.get("tokens", {}).get("incremental", {})

        # A custom model connection has its own prices. The public price list would
        # give a wrong cost, so the span stays unpriced and says why.
        if _served_by_custom_connection(meta):
            if tokens:
                _set_pricing_status(span, "custom_connection", model)
            continue

        prompt_tokens = _token_count(tokens, ("prompt",))
        completion_tokens = _token_count(tokens, ("completion",))
        cache_read_tokens = _token_count(tokens, CACHE_READ_TOKEN_KEYS)
        cache_write_tokens = _token_count(tokens, CACHE_WRITE_TOKEN_KEYS)

        # Cache counts can stand in for an input count, but not for a total that is
        # larger than them: the rest of that total has no known split.
        if (
            prompt_tokens <= 0
            and completion_tokens <= 0
            and _token_count(tokens, ("total",))
            > cache_read_tokens + cache_write_tokens
        ):
            _set_pricing_status(span, "missing_token_split", model)
            continue

        # litellm reads `prompt_tokens` as INCLUDING both cache buckets and prices the
        # rest at the input rate. An inclusive count can never be smaller than its cached
        # part, so a smaller one is exclusive whatever the producer claims.
        if (
            not _input_tokens_include_cache(meta)
            or prompt_tokens < cache_read_tokens + cache_write_tokens
        ):
            prompt_tokens += cache_read_tokens + cache_write_tokens

        if prompt_tokens <= 0 and completion_tokens <= 0:
            continue

        resolved_model = (
            resolve_pricing_model(model) if isinstance(model, str) and model else None
        )

        if resolved_model is None:
            _set_pricing_status(
                span, "unknown_model" if model else "missing_model", model
            )
            continue

        try:
            prompt_cost, completion_cost = price_tokens(
                model=resolved_model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cache_read_tokens=cache_read_tokens,
                cache_write_tokens=cache_write_tokens,
            )
        except Exception:  # pylint: disable=broad-exception-caught
            log.warn(
                "Failed to calculate costs",
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cache_read_tokens=cache_read_tokens,
                cache_write_tokens=cache_write_tokens,
            )
            _set_pricing_status(span, "pricing_failed", model)
            continue

        if "ag" not in span.attributes or not isinstance(span.attributes["ag"], dict):
            span.attributes["ag"] = {}
        if "metrics" not in span.attributes["ag"] or not isinstance(
            span.attributes["ag"]["metrics"], dict
        ):
            span.attributes["ag"]["metrics"] = {}
        if "costs" not in span.attributes["ag"]["metrics"] or not isinstance(
            span.attributes["ag"]["metrics"]["costs"], dict
        ):
            span.attributes["ag"]["metrics"]["costs"] = {}

        span.attributes["ag"]["metrics"]["costs"]["incremental"] = {
            "prompt": prompt_cost,
            "completion": completion_cost,
            "total": prompt_cost + completion_cost,
        }
        _set_pricing_status(span, None, model)


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
