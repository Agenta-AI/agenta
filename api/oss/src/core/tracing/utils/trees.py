from collections import OrderedDict
from typing import Any, Dict, List, NamedTuple, Optional

from litellm import cost_calculator, provider_list

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

    Roll-up is batch-local: a span only ever sums the children present in this call,
    so totals are complete only when the whole trace is passed in.

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

    # Cheap ownership check on the result we just wrote, so a producer that repeats its
    # children's totals is named in the logs instead of silently inflating the trace.
    double_counted = find_token_rollup_violations(span_id_tree, span_idx)
    if double_counted:
        log.warn(
            "Token roll-up double counted: a span's own incremental tokens restate the "
            "total its children already carry",
            span_ids=double_counted,
        )

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

    A span whose parent is missing from the batch is a root here: a trace is split
    across OTLP requests (the agent runner ships its own subtree, headed by a span
    whose parent lives in the SDK's request), so a dangling parent id means "not in
    this batch", not "no parent". Without this, such a batch yields an empty tree and
    nothing is cumulated. Roll-up stays batch-local; it never crosses requests.

    Every span has at most one parent and every parent is expanded at most once, so
    each span appears at most once in the forest. Spans in a parent cycle are reachable
    from no root and are simply left out.
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


def _costs_bucket(span: OTelFlatSpan, bucket: str) -> Optional[dict]:
    if not isinstance(span.attributes, dict):
        return None

    node: Any = span.attributes
    for key in ("ag", "metrics", "costs", bucket):
        if not isinstance(node, dict):
            return None
        node = node.get(key)

    return node if isinstance(node, dict) else None


def _has_reported_cumulative(span: OTelFlatSpan) -> bool:
    bucket = _costs_bucket(span, "cumulative")

    return bucket is not None and "total" in bucket


class _Costs(NamedTuple):
    """Cost triple plus whether anything in this subtree actually measured a cost.

    INVARIANT: `measured` is what decides whether the roll-up writes, never the
    amounts. A measured 0.0 (a fully cached turn, a free model) is a fact and must
    reach the ancestors; an absent measurement must leave them without the attribute
    rather than claiming a zero nobody observed.
    """

    prompt: float = 0.0
    completion: float = 0.0
    total: float = 0.0
    measured: bool = False


def _read_costs(span: OTelFlatSpan, bucket: str) -> _Costs:
    values = _costs_bucket(span, bucket)

    if values is None:
        return _Costs()

    def _amount(key: str) -> float:
        value = values.get(key, 0.0)
        return float(value) if isinstance(value, (int, float)) else 0.0

    return _Costs(
        prompt=_amount("prompt"),
        completion=_amount("completion"),
        total=_amount("total"),
        measured=True,
    )


def cumulate_costs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelFlatSpan],
) -> None:
    def _get_incremental(span: OTelFlatSpan) -> _Costs:
        return _read_costs(span, "incremental")

    def _get_cumulative(span: OTelFlatSpan) -> _Costs:
        return _read_costs(span, "cumulative")

    def _accumulate(a: _Costs, b: _Costs) -> _Costs:
        return _Costs(
            prompt=a.prompt + b.prompt,
            completion=a.completion + b.completion,
            total=a.total + b.total,
            measured=a.measured or b.measured,
        )

    def _set_cumulative(span: OTelFlatSpan, costs: _Costs):
        if span.attributes is None:
            span.attributes = {}

        # A cumulative total already on the span was reported by the producer (an
        # agent harness's gen_ai.usage.cost, mapped at ingest) and is the billed
        # aggregate for this subtree. Child costs recomputed from token counts
        # re-estimate the same spend, so overwriting here would swap a billed figure
        # for a lossier one. The roll-up only fills spans that report nothing.
        # Test presence, not truthiness: a reported 0.0 (a fully cached turn, a free
        # model) is a measurement, not a missing value.
        if _has_reported_cumulative(span):
            return

        if not costs.measured:
            return

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

        span.attributes["ag"]["metrics"]["costs"]["cumulative"] = {
            "prompt": costs.prompt,
            "completion": costs.completion,
            "total": costs.total,
        }

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
    )


def _metric_total(span: OTelFlatSpan, metric: str, bucket: str) -> float:
    if not isinstance(span.attributes, dict):
        return 0.0

    node = span.attributes
    for key in ("ag", "metrics", metric, bucket, "total"):
        if not isinstance(node, dict):
            return 0.0
        node = node.get(key)

    return node if isinstance(node, (int, float)) else 0.0


def find_token_rollup_violations(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelFlatSpan],
) -> List[str]:
    """
    Span ids whose own incremental tokens merely restate the total already below them.

    INVARIANT: an incremental token observation is owned by exactly one span. `cumulate_tokens`
    starts from a span's OWN incremental tokens and adds its children's cumulative values, so a
    span that repeats a run total it did not itself measure — a producer emitting
    `gen_ai.usage.*_tokens` on a parent, which ingest maps to the incremental bucket — is added
    on top of the same tokens the children already contributed.

    The comparison is against what the roll-up should actually produce from this span, its own
    contribution, and not against the subtree's graph leaves. A leaves-only total made every
    non-leaf that ran its own model call look like a repeat, because such a span legitimately
    owns incremental tokens; here it is quiet unless the span's own count is exactly the total
    its children already carry, which is a restatement rather than a measurement.

    Comparing a span's cumulative against the sum of every incremental in its subtree cannot
    work: the roll-up computes the cumulative as exactly that sum, so the two are equal by
    construction and the check would never fire.

    A span may legitimately be the ONLY carrier — a harness that reports run-level usage and
    emits no per-call spans — so a subtree that measured nothing is not a violation.
    """
    violations: List[str] = []

    def _visit(span_id: str, children: OrderedDict) -> None:
        for child_span_id, grandchildren in children.items():
            _visit(child_span_id, grandchildren)

        children_total = sum(
            _metric_total(spans_idx[child_span_id], "tokens", "cumulative")
            for child_span_id in children
        )

        if children_total > 0 and (
            _metric_total(spans_idx[span_id], "tokens", "incremental") == children_total
        ):
            violations.append(span_id)

    for span_id, children in spans_id_tree.items():
        _visit(span_id, children)

    return violations


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
    "completion",
    "chat",
    "rerank",
]


def _token_count(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


# The providers litellm can price by name. A provider identity outside this set is a
# customer's own connection slug, not a public catalog we can charge against.
KNOWN_PRICING_PROVIDERS = frozenset(
    str(getattr(provider, "value", provider)).lower() for provider in provider_list
)


def _dict(node: dict, key: str) -> dict:
    value = node.get(key)

    return value if isinstance(value, dict) else {}


def _text(value) -> Optional[str]:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _input_tokens_include_cache(ag_meta: dict) -> bool:
    """Whether the span's prompt bucket already counts its cached tokens.

    Default: True, the OpenTelemetry GenAI meaning of `gen_ai.usage.input_tokens`.
    Producers whose input count *excludes* cache (the Agenta agent runner, which emits
    the cache buckets separately) say so with `agenta.usage.input_tokens_includes_cache
    = false`. The default is deliberately the inclusive one: runner and API ship as
    independently versioned artifacts, so an old runner will post to a new API, and on
    that skew the inclusive reading undercounts (the pre-existing bug) instead of
    charging the cache twice.
    """
    marker = _dict(ag_meta, "usage").get("input_tokens_includes_cache")

    if isinstance(marker, bool):
        return marker

    if isinstance(marker, str):
        normalized = marker.strip().lower()
        if normalized in ("true", "1"):
            return True
        if normalized in ("false", "0"):
            return False

    return True


def _pricing_prompt_tokens(
    *,
    input_tokens_include_cache: bool,
    uncached_input_tokens: int,
    cache_read_input_tokens: int,
    cache_creation_input_tokens: int,
) -> int:
    """The prompt count litellm expects: always inclusive of the cache buckets.

    litellm's generic calculator derives ordinary input by *subtracting* the cache
    details from the prompt count it is given, so a producer whose input count already
    includes them is passed through untouched and an exclusive one is summed up first.
    """
    if input_tokens_include_cache:
        return uncached_input_tokens

    return uncached_input_tokens + cache_read_input_tokens + cache_creation_input_tokens


def _is_served_by_a_custom_connection(ag_meta: dict) -> bool:
    """Whether the span was served by something whose prices we cannot know.

    A managed custom model is selected as `<connection-slug>/<model-id>` but the tracer
    stamps only the bare model id, so a customer deployment named after a public model
    would otherwise be charged that public model's price. The connection identity
    survives as the provider attribute (the runner puts the slug in `gen_ai.system`),
    and third-party instrumentation additionally reports a base URL or endpoint for a
    self-hosted gateway. Either signal means no priceable identity exists.
    """
    request = _dict(ag_meta, "request")
    if _text(request.get("base_url")) or _text(request.get("endpoint")):
        return True

    provider = (
        _text(_dict(ag_meta, "provider").get("name"))
        or _text(ag_meta.get("provider"))
        or _text(ag_meta.get("system"))
    )

    return provider is not None and provider.lower() not in KNOWN_PRICING_PROVIDERS


def calculate_costs(span_idx: Dict[str, OTelFlatSpan]):
    for span in span_idx.values():
        if (
            span.span_type
            and span.span_type.name.lower() in TYPES_WITH_COSTS
            and span.attributes
        ):
            attr: dict = span.attributes
            ag_attr: dict = attr.get("ag", {})
            ag_meta: dict = ag_attr.get("meta", {})
            ag_data: dict = ag_attr.get("data", {})

            # The agent runner sets the response model only for codex; every other
            # harness sets only the request model, so without that fallback those
            # spans are never priced at all. The fallback is withheld from spans a
            # custom connection served: a bare name we cannot attribute to a catalog
            # would be priced confidently and wrongly, which is worse than no
            # estimate. The response model is left alone, since the harnesses that
            # set it (codex) also report a provider outside litellm's vocabulary.
            request_model = (
                None
                if _is_served_by_a_custom_connection(ag_meta)
                else ag_meta.get("request", {}).get("model")
            )

            model = (
                ag_meta.get("response", {}).get("model")
                or request_model
                or ag_data.get("parameters", {}).get("model")
            )

            token_metrics: dict = (
                ag_attr.get("metrics", {}).get("tokens", {}).get("incremental", {})
            )

            uncached_input_tokens = _token_count(token_metrics.get("prompt"))
            cache_read_input_tokens = _token_count(token_metrics.get("cache_read"))
            cache_creation_input_tokens = _token_count(
                token_metrics.get("cache_creation")
            )
            completion_tokens = _token_count(token_metrics.get("completion"))

            inclusive_prompt_tokens = _pricing_prompt_tokens(
                input_tokens_include_cache=_input_tokens_include_cache(ag_meta),
                uncached_input_tokens=uncached_input_tokens,
                cache_read_input_tokens=cache_read_input_tokens,
                cache_creation_input_tokens=cache_creation_input_tokens,
            )

            try:
                costs = cost_calculator.cost_per_token(
                    model=model,
                    prompt_tokens=inclusive_prompt_tokens,
                    completion_tokens=completion_tokens,
                    cache_read_input_tokens=cache_read_input_tokens,
                    cache_creation_input_tokens=cache_creation_input_tokens,
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

            # Model aliases litellm cannot price (e.g. the bare "sonnet" the model
            # picker sends) raise here rather than returning nothing; swallowing keeps
            # an unpriceable span cost-less instead of failing the whole ingest.
            except Exception:  # pylint: disable=bare-except
                log.warn(
                    "Failed to calculate costs",
                    model=model,
                    prompt_tokens=inclusive_prompt_tokens,
                    completion_tokens=completion_tokens,
                    cache_read_input_tokens=cache_read_input_tokens,
                    cache_creation_input_tokens=cache_creation_input_tokens,
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
