from datetime import datetime
from traceback import format_exc
from typing import Dict, Optional, Union
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.core.tracing.dtos import (
    FilteringException,
    OTelAttributes,
    OTelFlatSpans,
    OTelHash,
    OTelReference,
    OTelSpan,
    OTelSpanKind,
    OTelStatusCode,
    OTelTraceTree,
    Format,
    Focus,
    AgTypeAttributes,
)
from oss.src.core.tracing.utils.attributes import (
    initialize_ag_attributes,
    unmarshall_attributes,
)
from oss.src.core.tracing.utils.trees import (
    connect_children,
    parse_span_idx_to_span_id_tree,
)

from .hashing import extract_references_and_links_from_span, make_hash_id

log = get_module_logger(__name__)

TRACE_DEFAULT_KEY = "__default__"


# VALUES


def parse_ref_id_to_uuid(
    ref_id: str,
):
    clean_ref_id = None

    # HEX   # 0x31d6cfe04b9011ec800142010a8000b0
    if ref_id.startswith("0x") and len(ref_id) == (2 + 32):
        ref_id = ref_id[2:]

    # UUID # 31d6cfe0-4b90-11ec-8001-42010a8000b0
    # HEX  # 31d6cfe04b9011ec800142010a8000b0
    try:
        clean_ref_id = str(UUID(ref_id))
    except Exception as e:
        log.error(
            "ref_id must be a UUID, got %s [%s]",
            type(ref_id),
            ref_id,
        )
        raise TypeError() from e

    return clean_ref_id


def parse_ref_slug_to_str(
    ref_slug: str,
):
    clean_ref_slug = None

    try:
        clean_ref_slug = str(ref_slug)
    except Exception as e:
        log.error(
            "ref_slug must be a string, got %s [%s]",
            type(ref_slug),
            ref_slug,
        )
        raise TypeError() from e

    return clean_ref_slug


def parse_ref_version_to_str(
    ref_version: str,
):
    clean_ref_version = None

    try:
        clean_ref_version = str(ref_version)
    except Exception as e:
        log.error(
            "ref_version must be a string, got %s [%s]",
            type(ref_version),
            ref_version,
        )
        raise TypeError() from e

    return clean_ref_version


def parse_evt_name_to_str(
    evt_name: str,
):
    clean_evt_name = None

    try:
        clean_evt_name = str(evt_name)
    except Exception as e:
        log.error(
            "evt_name must be a string, got %s [%s]",
            type(evt_name),
            evt_name,
        )
        raise TypeError() from e

    return clean_evt_name


def parse_trace_id_to_uuid(
    trace_id: str,
):
    clean_trace_id = None

    # HEX   # 0x31d6cfe04b9011ec800142010a8000b0
    if trace_id.startswith("0x") and len(trace_id) == (2 + 32):
        trace_id = trace_id[2:]

    # UUID # 31d6cfe0-4b90-11ec-8001-42010a8000b0
    # HEX  # 31d6cfe04b9011ec800142010a8000b0
    try:
        clean_trace_id = str(UUID(trace_id))
    except Exception as e:
        log.error(
            "trace_id must be a UUID, got %s [%s]",
            type(trace_id),
            trace_id,
        )
        raise TypeError() from e

    return clean_trace_id


def parse_span_id_to_uuid(
    span_id: str,
):
    clean_span_id = None

    # HEX   # 0x31d6cfe04b9011ec
    if span_id.startswith("0x") and len(span_id) == (2 + 16):
        span_id = span_id[2:] + span_id[2:]

    # HEX   # 31d6cfe04b9011ec
    if len(span_id) == 16:
        span_id = span_id + span_id

    # UUID # 31d6cfe0-4b90-11ec-31d6-cfe04b9011ec
    # HEX  # 31d6cfe04b9011ec31d6cfe04b9011ec
    try:
        clean_span_id = str(UUID(span_id))
    except Exception as e:
        log.error(
            "span_id must be a UUID, got %s [%s]",
            type(span_id),
            span_id,
        )
        raise TypeError() from e

    return clean_span_id


def parse_trace_id_from_uuid(
    trace_id: Union[UUID, str],
):
    if isinstance(trace_id, UUID):
        return trace_id.hex

    if isinstance(trace_id, str):
        return UUID(trace_id).hex


def parse_span_id_from_uuid(
    span_id: Union[UUID, str],
):
    if isinstance(span_id, UUID):
        return span_id.hex[16:]

    if isinstance(span_id, str):
        return UUID(span_id).hex[16:]


def parse_span_kind_to_enum(
    span_kind: str,
):
    try:
        return OTelSpanKind(span_kind)

    except ValueError as e:
        log.error(f"Unsupported span_kind value: {span_kind}")

        raise FilteringException(
            f"Unsupported span_kind value: {span_kind}",
        ) from e


def parse_status_code_to_enum(
    status_code: str,
):
    try:
        return OTelStatusCode(status_code)

    except ValueError as e:
        log.error(f"Unsupported status_code value: {status_code}")

        raise FilteringException(
            f"Unsupported status_code value: {status_code}",
        ) from e


def parse_value_to_enum(value: str, enum: type) -> type:
    try:
        return enum(value)
    except ValueError as e:
        raise FilteringException(
            f"Unsupported condition value: '{value}'",
        ) from e


def parse_timestamp_to_datetime(
    ts: Optional[Union[str, int, datetime]],
) -> Optional[datetime]:
    if isinstance(ts, datetime):
        return ts

    if isinstance(ts, str):
        try:
            ts = int(ts)
        except ValueError:
            return datetime.fromisoformat(str(ts))

    if isinstance(ts, int):
        digits = len(str(ts))
        # Heuristic based on digit length
        if digits == 10:  # seconds
            ts *= 1_000_000
        elif digits == 13:  # milliseconds
            ts *= 1_000
        elif digits == 16:  # microseconds
            pass
        elif digits == 19:  # nanoseconds
            ts //= 1_000  # lose some precision, but reasonable fallback
        else:  # assume microseconds
            raise FilteringException(f"Timestamp {ts} is ambiguous.")

        return datetime.fromtimestamp(ts / 1_000_000)

    return None  # or raise TypeError if desired


# PAYLOAD PARSING


def _parse_span_from_request(raw_span: OTelSpan) -> Optional[OTelFlatSpans]:
    raw_span_dtos: OTelFlatSpans = []

    raw_span.trace_id = parse_trace_id_to_uuid(raw_span.trace_id)
    raw_span.span_id = parse_span_id_to_uuid(raw_span.span_id)

    if raw_span.parent_id:
        raw_span.parent_id = parse_span_id_to_uuid(raw_span.parent_id)

    if raw_span.links:
        for link in raw_span.links:
            link.trace_id = parse_trace_id_to_uuid(link.trace_id)
            link.span_id = parse_span_id_to_uuid(link.span_id)

    raw_span.start_time = parse_timestamp_to_datetime(raw_span.start_time)
    raw_span.end_time = parse_timestamp_to_datetime(raw_span.end_time)

    raw_span.attributes = unmarshall_attributes(raw_span.attributes or {})
    raw_span.attributes = initialize_ag_attributes(raw_span.attributes)
    ag = raw_span.attributes["ag"]

    type_attrs = AgTypeAttributes.model_validate(ag.get("type", {}))
    raw_span.trace_type = type_attrs.trace or raw_span.trace_type
    raw_span.span_type = type_attrs.span or raw_span.span_type

    if raw_span.start_time and raw_span.end_time:
        duration_s = (raw_span.end_time - raw_span.start_time).total_seconds()
        duration_ms = round(duration_s * 1_000, 3)
        duration_ms = duration_ms if duration_ms > 0 else None
        if duration_ms is not None:
            ag["metrics"]["duration"] = {"cumulative": duration_ms}

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
                        version=(
                            parse_ref_version_to_str(ref_value.get("version"))
                            if ref_value.get("version")
                            else None
                        ),
                        attributes={"key": ref_key},
                    )
                )

    if raw_span.references or raw_span.links:
        references, links = extract_references_and_links_from_span(raw_span)
        if references or links:
            hash_id = make_hash_id(references=references, links=links)
            if hash_id:
                raw_span.hashes = [OTelHash(id=hash_id, attributes={"key": "indirect"})]

    if isinstance(raw_span, OTelSpan) and raw_span.spans is not None:
        raw_span_dtos.extend(parse_spans_from_request(raw_span.spans))
        raw_span.spans = None

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
    except Exception:
        log.error(f"Error processing spans:\n {format_exc()}")
        span_dtos = []

    return span_dtos


def _parse_span_into_response(
    span_dto: OTelSpan,
    marshall: Optional[bool] = False,
) -> Optional[OTelSpan]:
    if not span_dto.attributes:
        span_dto.attributes = OTelAttributes()

    span_dto.trace_id = parse_trace_id_from_uuid(span_dto.trace_id)
    span_dto.span_id = parse_span_id_from_uuid(span_dto.span_id)

    if span_dto.parent_id:
        span_dto.parent_id = parse_span_id_from_uuid(span_dto.parent_id)

    if span_dto.links:
        for link in span_dto.links:
            link.trace_id = parse_trace_id_from_uuid(link.trace_id)
            link.span_id = parse_span_id_from_uuid(link.span_id)

    if marshall:
        pass

    ag = span_dto.attributes.get("ag")
    if ag:
        data = ag.get("data") if isinstance(ag, dict) else None
        outputs = data.get("outputs") if isinstance(data, dict) else None
        if isinstance(outputs, dict) and TRACE_DEFAULT_KEY in outputs:
            data["outputs"] = outputs[TRACE_DEFAULT_KEY]

    return span_dto


def parse_spans_into_response(
    span_dtos: OTelFlatSpans,
    focus: Focus = Focus.TRACE,
    format: Format = Format.AGENTA,
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
            traces = {
                span_dto.trace_id: {"spans": {span_dto.span_name: span_dto}}
                for span_dto in span_lookup.values()
                if span_dto.parent_id is None
            }
        else:
            spans = clean_span_dtos
    except Exception:
        log.error(f"Error processing spans:\n {format_exc()}")
        if format == Format.AGENTA and focus == Focus.TRACE:
            traces = {}
        else:
            spans = []

    return spans if spans else traces
