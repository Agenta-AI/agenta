from typing import Optional, Union, Tuple, List, Dict
from json import loads
from datetime import datetime

from fastapi import Query

from oss.src.utils.logging import get_module_logger

from oss.src.core.tracing.dtos import (
    OTelSpan,
    OTelFlatSpans,
    OTelTraceTree,
    Formatting,
    Windowing,
    Filtering,
    TracingQuery,
    Focus,
    Format,
    MetricSpec,
)

from oss.src.core.tracing.utils.attributes import (
    REFERENCE_KEYS as CORE_REFERENCE_KEYS,
    initialize_ag_attributes as core_initialize_ag_attributes,
)
from oss.src.core.tracing.utils.hashing import (
    extract_references_and_links_from_span as core_extract_references_and_links_from_span,
    make_hash_id as core_make_hash_id,
)
from oss.src.core.tracing.utils.parsing import (
    _parse_span_from_request as core_parse_span_from_request,
    _parse_span_into_response as core_parse_span_into_response,
    parse_timestamp_to_datetime,
    parse_spans_from_request as core_parse_spans_from_request,
    parse_spans_into_response as core_parse_spans_into_response,
)

log = get_module_logger(__name__)

REFERENCE_KEYS = CORE_REFERENCE_KEYS

# --- PARSE QUERY DTO ---


def _parse_windowing(
    oldest: Optional[Union[str, int, datetime]] = None,
    newest: Optional[Union[str, int, datetime]] = None,
    limit: Optional[int] = None,
    interval: Optional[int] = None,
    rate: Optional[float] = None,
) -> Optional[Windowing]:
    if all(
        [
            oldest is None,
            newest is None,
            limit is None,
            interval is None,
            rate is None,
        ]
    ):
        return None

    oldest = parse_timestamp_to_datetime(oldest)
    newest = parse_timestamp_to_datetime(newest)

    _windowing = Windowing(
        oldest=oldest,
        newest=newest,
        limit=limit,
        interval=interval,
        rate=rate,
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


def parse_query_from_params_request(
    # GROUPING
    focus: Optional[Focus] = Query(None),
    format: Optional[Format] = Query(None),  # pylint: disable=redefined-builtin
    # WINDOWING
    oldest: Optional[Union[str, int]] = Query(None),
    newest: Optional[Union[str, int]] = Query(None),
    limit: Optional[int] = Query(None),
    interval: Optional[int] = Query(None),
    rate: Optional[float] = Query(None),
    # FILTERING
    filter=Query(None),  # pylint: disable=redefined-builtin
) -> TracingQuery:
    return parse_query_from_body_request(
        focus=focus,
        format=format,
        #
        oldest=oldest,
        newest=newest,
        limit=limit,
        interval=interval,
        rate=rate,
        #
        filter=filter,
    )


def parse_query_from_body_request(
    # GROUPING
    focus: Optional[Focus] = None,
    format: Optional[Format] = None,  # pylint: disable=redefined-builtin
    # WINDOWING
    oldest: Optional[Union[str, int]] = None,
    newest: Optional[Union[str, int]] = None,
    limit: Optional[int] = None,
    interval: Optional[int] = None,
    rate: Optional[float] = None,
    # FILTERING
    filter: Optional[Union[dict, str]] = None,  # pylint: disable=redefined-builtin
) -> TracingQuery:
    try:
        _query = TracingQuery(
            formatting=_parse_formatting(
                focus=focus,
                format=format,
            ),
            windowing=_parse_windowing(
                oldest=oldest,
                newest=newest,
                limit=limit,
                interval=interval,
                rate=rate,
            ),
            filtering=_parse_filtering(
                filter=filter,
            ),
        )
    except Exception as e:  # pylint: disable=broad-except
        log.warn(e)

        _query = TracingQuery()

    return _query


def merge_queries(
    query_param: Optional[TracingQuery] = None,
    query_body: Optional[TracingQuery] = None,
) -> TracingQuery:
    if query_param is None and query_body is None:
        return TracingQuery(
            formatting=_parse_formatting(),
            windowing=_parse_windowing(),
            filtering=_parse_filtering(),
        )

    if query_body is None and query_param is not None:
        query_param.filtering = query_param.filtering or Filtering()

        return query_param

    if query_param is None and query_body is not None:
        query_body.filtering = query_body.filtering or Filtering()

        return query_body

    if query_param is not None and query_body is not None:
        return TracingQuery(
            formatting=query_body.formatting or query_param.formatting or Formatting(),
            windowing=query_body.windowing or query_param.windowing or Windowing(),
            filtering=query_body.filtering or query_param.filtering or Filtering(),
        )

    return TracingQuery(
        formatting=_parse_formatting(),
        windowing=_parse_windowing(),
        filtering=_parse_filtering(),
    )


# --- PARSE SPANS ---


def initialize_ag_attributes(attributes: Optional[dict]) -> dict:
    return core_initialize_ag_attributes(attributes)


def extract_references_and_links_from_span(span: OTelSpan) -> Tuple[Dict, Dict]:
    return core_extract_references_and_links_from_span(span)


def make_hash_id(
    *,
    references: Optional[Dict[str, Dict[str, str]]] = None,
    links: Optional[Dict[str, Dict[str, str]]] = None,
) -> str:
    return core_make_hash_id(references=references, links=links)


def _parse_span_from_request(raw_span: OTelSpan) -> Optional[OTelFlatSpans]:
    return core_parse_span_from_request(raw_span)


def parse_spans_from_request(
    spans: Dict[str, Union[OTelSpan, OTelFlatSpans]],
) -> Optional[OTelFlatSpans]:
    return core_parse_spans_from_request(spans)


def _parse_span_into_response(
    span_dto: OTelSpan,
    marshall: Optional[bool] = False,
) -> Optional[OTelSpan]:
    return core_parse_span_into_response(span_dto, marshall=marshall)


def parse_spans_into_response(
    span_dtos: OTelFlatSpans,
    focus: Focus = Focus.TRACE,
    format: Format = Format.AGENTA,
) -> Optional[Union[OTelFlatSpans, OTelTraceTree]]:
    return core_parse_spans_into_response(span_dtos, focus=focus, format=format)


# -- ANALYTICS


def parse_specs_from_body_request(
    specs: Optional[Union[list, str]] = None,
) -> Optional[List[MetricSpec]]:
    if not specs:
        return None

    if isinstance(specs, str):
        try:
            specs = loads(specs)
        except Exception as e:  # pylint: disable=broad-except
            log.warn(f"Error parsing specs string to JSON: {e}")
            return None

    if isinstance(specs, list):
        return [MetricSpec(**spec) for spec in specs if isinstance(spec, dict)]

    log.warn("Specs should be a list or a JSON string")

    return None


def merge_specs(
    specs_params: Optional[List[MetricSpec]],
    specs_body: Optional[List[MetricSpec]],
) -> List[MetricSpec]:
    if not specs_params and not specs_body:
        return []
    if not specs_params:
        return specs_body or []
    if not specs_body:
        return specs_params or []
    return specs_body or specs_params or []


def parse_analytics_from_params_request(
    # GROUPING
    focus: Optional[Focus] = Query(None),
    format: Optional[Format] = Query(None),  # pylint: disable=redefined-builtin
    # WINDOWING
    oldest: Optional[Union[str, int]] = Query(None),
    newest: Optional[Union[str, int]] = Query(None),
    interval: Optional[int] = Query(None),
    rate: Optional[float] = Query(None),
    # FILTERING
    filter=Query(None),  # pylint: disable=redefined-builtin
    # METRICS SPECS
    specs=Query(None),
) -> Tuple[Optional[TracingQuery], Optional[List[MetricSpec]]]:
    return parse_analytics_from_body_request(
        focus=focus,
        format=format,
        #
        oldest=oldest,
        newest=newest,
        interval=interval,
        rate=rate,
        #
        filter=filter,
        #
        specs=specs,
    )


def parse_analytics_from_body_request(
    # GROUPING
    focus: Optional[Focus] = None,
    format: Optional[Format] = None,  # pylint: disable=redefined-builtin
    # WINDOWING
    oldest: Optional[Union[str, int]] = None,
    newest: Optional[Union[str, int]] = None,
    interval: Optional[int] = None,
    rate: Optional[float] = None,
    # FILTERING
    filter: Optional[Union[dict, str]] = None,  # pylint: disable=redefined-builtin
    # METRICS SPECS
    specs: Optional[Union[list, str]] = None,
) -> Tuple[Optional[TracingQuery], Optional[List[MetricSpec]]]:
    return (
        parse_query_from_body_request(
            focus=focus,
            format=format,
            #
            oldest=oldest,
            newest=newest,
            interval=interval,
            rate=rate,
            #
            filter=filter,
        ),
        parse_specs_from_body_request(
            specs=specs,
        ),
    )


def merge_analytics(
    analytics_params: Tuple[Optional[TracingQuery], Optional[List[MetricSpec]]],
    analytics_body: Tuple[Optional[TracingQuery], Optional[List[MetricSpec]]],
) -> Tuple[TracingQuery, List[MetricSpec]]:
    return (
        merge_queries(analytics_params[0], analytics_body[0]),
        merge_specs(analytics_params[1], analytics_body[1]),
    )
