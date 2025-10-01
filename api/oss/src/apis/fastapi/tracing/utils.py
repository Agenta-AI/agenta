from typing import Optional, Union, Dict, Tuple
from json import loads, dumps
from copy import deepcopy
from hashlib import blake2b
from traceback import format_exc

from fastapi import Query as _Query

from oss.src.utils.logging import get_module_logger

from oss.src.core.tracing.dtos import (
    TraceType,
    SpanType,
    AgMetricEntryAttributes,
    AgMetricsAttributes,
    AgTypeAttributes,
    AgDataAttributes,
    AgAttributes,
)


from oss.src.core.tracing.dtos import (
    OTelHash,
    OTelReference,
    OTelAttributes,
    OTelSpan,
    OTelNestedSpans,
    OTelFlatSpans,
    OTelTraceTree,
    Formatting,
    Windowing,
    Filtering,
    Query,
    Focus,
    Format,
)

from oss.src.core.tracing.utils import (
    parse_ref_id_to_uuid,
    parse_ref_slug_to_str,
    parse_timestamp_to_datetime,
    parse_trace_id_to_uuid,
    parse_span_id_to_uuid,
    parse_trace_id_from_uuid,
    parse_span_id_from_uuid,
    unmarshall_attributes,
    parse_span_idx_to_span_id_tree,
    connect_children,
)

log = get_module_logger(__name__)

TRACE_DEFAULT_KEY = "__default__"

# --- PARSE QUERY DTO ---


def _parse_windowing(
    oldest: Optional[Union[str, int]] = None,
    newest: Optional[Union[str, int]] = None,
    limit: Optional[int] = None,
    window: Optional[int] = None,
) -> Optional[Windowing]:
    oldest = parse_timestamp_to_datetime(oldest)
    newest = parse_timestamp_to_datetime(newest)

    _windowing = Windowing(
        oldest=oldest,
        newest=newest,
        limit=limit,
        window=window,
    )

    return _windowing


def _parse_filtering(
    filter: Optional[Union[str, dict]] = None,  # pylint: disable=redefined-builtin
) -> Optional[Filtering]:
    # Accepts either a dict or a string (JSON)
    _filtering = None
    filtering_json_data = None

    if filter:
        if isinstance(filter, dict):
            filtering_json_data = filter
        elif isinstance(filter, str):
            try:
                filtering_json_data = loads(filter)
            except Exception as e:  # pylint: disable=broad-exception-caught
                log.warn(f"Error parsing filter string to JSON: {e}")
                filtering_json_data = None

        if filtering_json_data:
            try:
                _filtering = Filtering(**filtering_json_data)
            except Exception as e:  # pylint: disable=broad-exception-caught
                log.warn(f"Error parsing filter JSON to Filtering DTO: {e}")

    return _filtering


def _parse_formatting(
    focus: Focus = Focus.TRACE,
    format: Format = Format.AGENTA,  # pylint: disable=redefined-builtin
) -> Optional[Formatting]:
    _formatting = Formatting(
        focus=focus or Focus.TRACE,
        format=format or Format.AGENTA,
    )

    return _formatting


def parse_query_request(
    # GROUPING
    focus: Optional[Focus] = _Query(None),
    format: Optional[Format] = _Query(None),  # pylint: disable=redefined-builtin
    # WINDOWING
    oldest: Optional[Union[str, int]] = _Query(None),
    newest: Optional[Union[str, int]] = _Query(None),
    limit: Optional[int] = _Query(None),
    window: Optional[int] = _Query(None),
    # FILTERING
    filter=_Query(None),  # pylint: disable=redefined-builtin
) -> Query:
    return parse_body_request(
        focus=focus,
        format=format,
        #
        oldest=oldest,
        newest=newest,
        limit=limit,
        window=window,
        #
        filter=filter,
    )


def parse_body_request(
    # GROUPING
    focus: Optional[Focus] = None,
    format: Optional[Format] = None,  # pylint: disable=redefined-builtin
    # WINDOWING
    oldest: Optional[Union[str, int]] = None,
    newest: Optional[Union[str, int]] = None,
    limit: Optional[int] = None,
    window: Optional[int] = None,
    # FILTERING
    filter: Optional[Union[dict, str]] = None,  # pylint: disable=redefined-builtin
) -> Query:
    try:
        _query = Query(
            formatting=_parse_formatting(
                focus=focus,
                format=format,
            ),
            windowing=_parse_windowing(
                oldest=oldest,
                newest=newest,
                limit=limit,
                window=window,
            ),
            filtering=_parse_filtering(
                filter=filter,
            ),
        )
    except Exception as e:  # pylint: disable=broad-except
        log.warn(e)

        _query = None

    return _query


def merge_queries(
    query_param: Optional[Query] = None,
    query_body: Optional[Query] = None,
) -> Query:
    if query_body is None:
        if query_param.filtering is None:
            query_param.filtering = Filtering()
        return query_param

    if query_param is None:
        if query_body.filtering is None:
            query_body.filtering = Filtering()
        return query_body

    return Query(
        formatting=Formatting(
            focus=query_param.formatting.focus
            or query_body.formatting.focus
            or Focus.TRACE,
            format=query_param.formatting.format
            or query_body.formatting.format
            or Format.AGENTA,
        ),
        windowing=Windowing(
            oldest=query_param.windowing.oldest or query_body.windowing.oldest,
            newest=query_param.windowing.newest or query_body.windowing.newest,
            limit=query_param.windowing.limit or query_body.windowing.limit,
            window=query_param.windowing.window or query_body.windowing.window,
        ),
        filtering=query_param.filtering or query_body.filtering or Filtering(),
    )


# --- PARSE SPANS ---


def ensure_nested_dict(d: dict, *keys: str) -> dict:
    """Ensure nested structure exists in dictionary `d`."""
    for key in keys:
        if key not in d or not isinstance(d[key], dict):
            d[key] = {}
        d = d[key]
    return d


"""Ensure `ag` is present and populate required structure, putting extra fields under 'unsupported'.

Providing this:
{
    "ag": {
        "type": {
            "trace": "undefined",
            "span": "undefined",
            "extra_type": "x",  # unsupported
        },
        "flags": {"env": "True"},
        "tags": {"foo": "bar"},
        "meta": {"service": "api"},
        "data": {
            "inputs": {"text": "hello"},
            "outputs": "world",
            "internals": {"debug": True},
            "extra_data": 42,  # unsupported
        },
        "metrics": {
            "duration": {
                "cumulative": 12.5,
                "incremental": None,
                "extra_duration": "bad",  # unsupported
            },
            "errors": {
                "incremental": 1
            },
            "tokens": {
                "cumulative": 100
            },
            "costs": {
                "incremental": 0.02
            },
            "extra_metric": {  # unsupported full metric
                "cumulative": 999
            },
        },
        "references": {"trace_id": "abc"},
        "exception": {"message": "boom"},
        "custom": "oops",  # unsupported top-level
    }
}

should return this:
{
    "ag": {
        "type": {
        "trace": "undefined",
        "span": "undefined"
        },
        "flags": {"env": "True"},
        "tags": {"foo": "bar"},
        "meta": {"service": "api"},
        "data": {
        "inputs": {"text": "hello"},
        "outputs": "world",
        "internals": {"debug": True}
        },
        "metrics": {
        "duration": {
            "cumulative": 12.5
        },
        "errors": {
            "incremental": 1
        },
        "tokens": {
            "cumulative": 100
        },
        "costs": {
            "incremental": 0.02
        }
        },
        "references": {"trace_id": "abc"},
        "exception": {"message": "boom"},
        "unsupported": {
        "type": {
            "extra_type": "x"
        },
        "data": {
            "extra_data": 42
        },
        "metrics": {
            "duration": {
            "extra_duration": "bad"
            },
            "extra_metric": {
            "cumulative": 999
            }
        },
        "custom": "oops"
        }
    }
}
"""


def initialize_ag_attributes(attributes: Optional[dict]) -> dict:
    """Ensure structured and validated 'ag' block is always present and complete."""
    if not attributes or not isinstance(attributes, dict):
        attributes = {}

    ag = deepcopy(attributes.get("ag", {})) or {}
    unsupported = deepcopy(ag.get("unsupported", {})) or {}
    cleaned_ag = {}

    # --- type ---
    type_dict = ensure_nested_dict(ag, "type")
    cleaned_type = {
        key: type_dict.get(key, None) for key in AgTypeAttributes.model_fields
    }
    for key in type_dict:
        if key not in AgTypeAttributes.model_fields:
            unsupported.setdefault("type", {})[key] = type_dict[key]
    cleaned_ag["type"] = cleaned_type

    # --- data ---
    data_dict = ensure_nested_dict(ag, "data")
    cleaned_data = {
        key: data_dict.get(key, None) for key in AgDataAttributes.model_fields
    }
    for key in data_dict:
        if key not in AgDataAttributes.model_fields:
            unsupported.setdefault("data", {})[key] = data_dict[key]
    cleaned_ag["data"] = cleaned_data

    # --- metrics ---
    metrics_dict = ensure_nested_dict(ag, "metrics")
    cleaned_metrics = {}

    for metric_key in AgMetricsAttributes.model_fields:
        raw_entry = ensure_nested_dict(metrics_dict, metric_key)
        cleaned_entry = {
            subkey: raw_entry.get(subkey, None)
            for subkey in AgMetricEntryAttributes.model_fields
        }
        cleaned_metrics[metric_key] = cleaned_entry

        # remove unexpected subkeys from metric entry
        for subkey in list(raw_entry.keys()):
            if subkey not in AgMetricEntryAttributes.model_fields:
                unsupported.setdefault("metrics", {}).setdefault(metric_key, {})[
                    subkey
                ] = raw_entry[subkey]

    # detect fully unsupported metric keys
    for metric_key in list(metrics_dict.keys()):
        if metric_key not in AgMetricsAttributes.model_fields:
            unsupported.setdefault("metrics", {})[metric_key] = metrics_dict[metric_key]

    cleaned_ag["metrics"] = cleaned_metrics

    # --- references ---
    references_dict = ensure_nested_dict(ag, "references")
    cleaned_references = {}

    if isinstance(references_dict, dict):
        for key in references_dict:
            if key in REFERENCE_KEYS:
                entry = {}
                if references_dict[key].get("id") is not None:
                    entry["id"] = str(references_dict[key]["id"])
                if references_dict[key].get("slug") is not None:
                    entry["slug"] = str(references_dict[key]["slug"])
                if references_dict[key].get("version") is not None:
                    entry["version"] = str(references_dict[key]["version"])

                cleaned_references[key] = entry

    cleaned_ag["references"] = cleaned_references or None

    # --- passthrough simple optional fields ---
    for key in ["flags", "tags", "meta", "exception", "hashes"]:
        cleaned_ag[key] = ag.get(key, None)

        # --- move ag.meta.configuration to ag.data.parameters ---
    if "meta" in cleaned_ag and cleaned_ag["meta"] is not None:
        if "configuration" in cleaned_ag["meta"]:
            if cleaned_ag["data"]["parameters"] is None:
                cleaned_ag["data"]["parameters"] = cleaned_ag["meta"]["configuration"]

    # --- unsupported top-level ---
    for key in ag:
        if key not in AgAttributes.model_fields:
            unsupported[key] = ag[key]

    cleaned_ag["unsupported"] = unsupported or None

    cleaned_ag = AgAttributes(**cleaned_ag).model_dump(mode="json", exclude_none=True)

    attributes["ag"] = cleaned_ag

    return attributes


REFERENCE_KEYS = [
    "testset",
    "testcase",
    "workflow",
    "workflow_variants",
    "workflow_revisions",
    "application",
    "application_variants",
    "application_revisions",
    "evaluator",
    "evaluator_variants",
    "evaluator_revisions",
    "environment",
    "environment_variants",
    "environment_revisions",
]


def extract_references_and_links_from_span(span: OTelSpan) -> Tuple[Dict, Dict]:
    references = {
        ref.attributes["key"]: {
            "id": str(ref.id) if ref.id else None,
            "slug": str(ref.slug) if ref.slug else None,
        }
        for ref in span.references or []
        if ref.attributes.get("key") in REFERENCE_KEYS
    }
    links = {
        link.attributes["key"]: {
            "trace_id": parse_trace_id_from_uuid(link.trace_id),
            "span_id": parse_span_id_from_uuid(link.span_id),
        }
        for link in span.links or []
        if link.attributes.get("key")
    }
    return references, links


def make_hash_id(
    *,
    references: Optional[Dict[str, Dict[str, str]]] = None,
    links: Optional[Dict[str, Dict[str, str]]] = None,
) -> str:
    if not references and not links:
        return None

    payload = dict()

    for k, v in (references or {}).items():
        if k in REFERENCE_KEYS:
            entry = {}
            if v.get("id") is not None:
                entry["id"] = v["id"]
            if v.get("slug") is not None:
                entry["slug"] = v["slug"]
            payload[k] = entry

    for k, v in (links or {}).items():
        payload[k] = {"span_id": v.get("span_id"), "trace_id": v.get("trace_id")}

    hasher = blake2b(digest_size=16)

    serialized = dumps(payload, sort_keys=True).encode("utf-8").replace(b" ", b"")

    hasher.update(serialized)

    digest = hasher.hexdigest()

    return digest


def _parse_span_from_request(raw_span: OTelSpan) -> Optional[OTelFlatSpans]:
    raw_span_dtos: OTelFlatSpans = []

    # --- IDs ---
    raw_span.trace_id = parse_trace_id_to_uuid(raw_span.trace_id)
    raw_span.span_id = parse_span_id_to_uuid(raw_span.span_id)

    if raw_span.parent_id:
        raw_span.parent_id = parse_span_id_to_uuid(raw_span.parent_id)

    if raw_span.links:
        for link in raw_span.links:
            link.trace_id = parse_trace_id_to_uuid(link.trace_id)
            link.span_id = parse_span_id_to_uuid(link.span_id)

    # --- Timestamps ---
    raw_span.start_time = parse_timestamp_to_datetime(raw_span.start_time)
    raw_span.end_time = parse_timestamp_to_datetime(raw_span.end_time)

    # --- Attributes ---
    raw_span.attributes = unmarshall_attributes(raw_span.attributes or {})
    raw_span.attributes = initialize_ag_attributes(raw_span.attributes)

    ag = raw_span.attributes["ag"]

    # --- Types ---
    raw_span.trace_type = TraceType(ag["type"].get("trace") or TraceType.INVOCATION)
    raw_span.span_type = SpanType(ag["type"].get("span") or SpanType.TASK)

    # --- Latency ---
    if raw_span.start_time and raw_span.end_time:
        duration_s = (raw_span.end_time - raw_span.start_time).total_seconds()
        duration_ms = round(duration_s * 1_000, 3)
        duration_ms = duration_ms if duration_ms > 0 else None

        if duration_ms is not None:
            ag["metrics"]["duration"] = {"cumulative": duration_ms}

    # --- Events / Exceptions ---
    if raw_span.events:
        errors = ag["metrics"]["errors"] = {"incremental": 0}

        for event in raw_span.events:
            event.timestamp = parse_timestamp_to_datetime(event.timestamp)
            if event.name == "exception":
                errors["incremental"] = (errors.get("incremental") or 0) + 1

                raw_span.exception = {
                    "message": event.attributes.get("message"),
                    "type": event.attributes.get("type"),
                    "stacktrace": event.attributes.get("stacktrace"),
                }

    # --- References ---
    ag_references = ag.get("references")
    if isinstance(ag_references, dict):
        raw_span.references = []
        for ref_key, ref_value in ag_references.items():
            if isinstance(ref_value, dict):
                raw_span.references.append(
                    OTelReference(
                        id=(
                            parse_ref_id_to_uuid(ref_value.get("id"))
                            if ref_value.get("id")
                            else None
                        ),
                        slug=(
                            parse_ref_slug_to_str(ref_value.get("slug"))
                            if ref_value.get("slug")
                            else None
                        ),
                        attributes={"key": ref_key},
                    )
                )

    # --- Hashes ---
    if raw_span.references or raw_span.links:
        references, links = extract_references_and_links_from_span(raw_span)

        if references or links:
            hash_id = make_hash_id(references=references, links=links)
            # log.debug("parsing span with hash_id", hash_id=hash_id)

            if hash_id:
                hashes = OTelHash(
                    id=hash_id,
                    attributes={
                        "key": "indirect",
                    },
                )

                raw_span.hashes = [hashes]

    # --- Children ---
    if raw_span.spans:
        raw_span_dtos.extend(parse_spans_from_request(raw_span.spans))
        raw_span.spans = None

    # --- Final Append ---
    raw_span_dtos.append(raw_span)

    return raw_span_dtos


def parse_spans_from_request(
    spans: Dict[str, Union[OTelSpan, OTelFlatSpans]],
) -> Optional[OTelFlatSpans]:
    raw_span_dtos: OTelFlatSpans = []
    span_dtos: OTelFlatSpans = []

    try:
        for span_group in spans.values():
            if isinstance(span_group, list):
                raw_span_dtos.extend(span_group)

            else:
                raw_span_dtos.append(span_group)

        for span in raw_span_dtos:
            span_dtos.extend(_parse_span_from_request(span))

    except Exception:  # pylint:disable=broad-exception-caught
        log.error(f"Error processing spans:\n {format_exc()}")

        span_dtos = []  # FULL RESET OR RETURN PARTIAL?

    return span_dtos


def _parse_span_into_response(
    span_dto: OTelSpan,
    marshall: Optional[bool] = False,
) -> Optional[OTelSpan]:
    if not span_dto.attributes:
        span_dto.attributes = OTelAttributes()

    # HANDLE IDs (TRACE, SPAN, PARENT, LINKS)
    span_dto.trace_id = parse_trace_id_from_uuid(span_dto.trace_id)
    span_dto.span_id = parse_span_id_from_uuid(span_dto.span_id)

    if span_dto.parent_id:
        span_dto.parent_id = parse_span_id_from_uuid(span_dto.parent_id)

    if span_dto.links:
        for link in span_dto.links:
            link.trace_id = parse_trace_id_from_uuid(link.trace_id)
            link.span_id = parse_span_id_from_uuid(link.span_id)

    # HANDLE ATTRIBUTES
    if marshall:
        pass  # TODO: MARSHALL ATTRIBUTES

    ag = span_dto.attributes.get("ag")
    if ag:
        data = ag.get("data") if isinstance(ag, dict) else None
        outputs = data.get("outputs") if isinstance(data, dict) else None
        if isinstance(outputs, dict) and TRACE_DEFAULT_KEY in outputs:
            data["outputs"] = outputs[TRACE_DEFAULT_KEY]

    return span_dto


def parse_spans_into_response(
    span_dtos: OTelFlatSpans,
    focus: Focus,
    format: Format,
) -> Optional[Union[OTelFlatSpans, OTelTraceTree]]:
    clean_span_dtos: OTelFlatSpans = []

    spans: OTelFlatSpans = None
    traces: OTelTraceTree = None

    try:
        for span_dto in span_dtos:
            clean_span_dtos.append(
                _parse_span_into_response(
                    span_dto,
                    marshall=(format == Format.OPENTELEMETRY),
                )
            )

        if format == Format.AGENTA and focus == Focus.TRACE:
            span_lookup = {span.span_id: span for span in clean_span_dtos}

            span_id_tree = parse_span_idx_to_span_id_tree(span_lookup)

            connect_children(span_id_tree, span_lookup)

            span_lookup: OTelNestedSpans

            traces: OTelTraceTree = {
                span_dto.trace_id: {"spans": {span_dto.span_name: span_dto}}
                for span_dto in span_lookup.values()
                if span_dto.parent_id is None
            }

        else:
            spans: OTelFlatSpans = clean_span_dtos

    except Exception:  # pylint:disable=broad-exception-caught
        log.error(f"Error processing spans:\n {format_exc()}")

        if format == Format.AGENTA and focus == Focus.TRACE:
            traces: OTelTraceTree = {}  # FULL RESET OR RETURN PARTIAL?
        else:
            spans: OTelFlatSpans = []

    return spans if spans else traces
