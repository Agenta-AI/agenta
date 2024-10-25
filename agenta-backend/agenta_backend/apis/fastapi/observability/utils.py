from typing import Optional, Tuple, Any, List, Dict
from uuid import UUID
from collections import OrderedDict
from json import loads, JSONDecodeError, dumps
from copy import copy

from fastapi import Query, HTTPException

from agenta_backend.apis.fastapi.observability.opentelemetry.semconv import CODEX

from agenta_backend.core.observability.dtos import (
    TimeDTO,
    StatusDTO,
    RootDTO,
    TreeDTO,
    NodeDTO,
    ParentDTO,
    LinkDTO,
    ExceptionDTO,
    Attributes,
    SpanDTO,
    OTelExtraDTO,
    OTelEventDTO,
    OTelSpanDTO,
    OTelContextDTO,
    OTelLinkDTO,
)
from agenta_backend.core.observability.dtos import (
    GroupingDTO,
    WindowingDTO,
    FilteringDTO,
    PaginationDTO,
    QueryDTO,
)

# --- PARSE QUERY DTO ---


def _parse_windowing(
    *,
    earliest: Optional[str] = None,
    latest: Optional[str] = None,
) -> Optional[WindowingDTO]:
    _windowing = None

    if earliest or latest:
        _windowing = WindowingDTO(earliest=earliest, latest=latest)

    return _windowing


def _parse_filtering(
    *,
    filtering: Optional[str] = None,
) -> Optional[FilteringDTO]:
    # Parse JSON filtering
    _filtering = None

    if filtering:
        try:
            filtering_json_data = loads(filtering)
            _filtering = FilteringDTO(**filtering_json_data)
        except JSONDecodeError as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid JSON filtering provided: {str(e)}",
            )

    return _filtering


def _parse_grouping(
    *,
    focus: Optional[str] = None,
) -> Optional[GroupingDTO]:
    _grouping = None

    if focus != "node":
        _grouping = GroupingDTO(focus=focus or "tree")

    return _grouping


def _parse_pagination(
    *,
    page: Optional[int] = None,
    size: Optional[int] = None,
) -> Optional[PaginationDTO]:
    _pagination = None

    if page and size:
        _pagination = PaginationDTO(page=page, size=size)

    return _pagination


def parse_query_dto(
    # GROUPING
    # - Option 2: Flat query parameters
    focus: Optional[str] = Query(None),
    # WINDOWING
    # - Option 2: Flat query parameters
    earliest: Optional[str] = Query(None),
    latest: Optional[str] = Query(None),
    # FILTERING
    # - Option 1: Single query parameter as JSON
    filtering: Optional[str] = Query(None),
    # PAGINATION
    # - Option 2: Flat query parameters
    page: Optional[int] = Query(None),
    size: Optional[int] = Query(None),
) -> QueryDTO:
    return QueryDTO(
        grouping=_parse_grouping(focus=focus),
        windowing=_parse_windowing(earliest=earliest, latest=latest),
        filtering=_parse_filtering(filtering=filtering),
        pagination=_parse_pagination(page=page, size=size),
    )


# --- PARSE SPAN DTO ---


def _unmarshal_attributes(
    marshalled: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Unmarshals a dictionary of marshalled attributes into a nested dictionary

    Example:
    marshalled = {
        "ag.type": "tree",
        "ag.node.name": "root",
        "ag.node.children.0.name": "child1",
        "ag.node.children.1.name": "child2"
    }
    unmarshalled = {
        "ag": {
            "type": "tree",
            "node": {
                "name": "root",
                "children": [
                    {
                        "name": "child1",
                    },
                    {
                        "name": "child2",
                    }
                ]
            }
        }
    }
    """
    unmarshalled = {}

    for key, value in marshalled.items():
        keys = key.split(".")

        level = unmarshalled

        for i, part in enumerate(keys[:-1]):
            if part.isdigit():
                part = int(part)

                if not isinstance(level, list):
                    level = []

                while len(level) <= part:
                    level.append({})

                level = level[part]

            else:
                if part not in level:
                    level[part] = {} if not keys[i + 1].isdigit() else []

                level = level[part]

        last_key = keys[-1]

        if last_key.isdigit():
            last_key = int(last_key)

            if not isinstance(level, list):
                level = []

            while len(level) <= last_key:
                level.append(None)

            level[last_key] = value

        else:
            level[last_key] = value

    return unmarshalled


def _encode_key(
    namespace,
    key: str,
) -> str:
    return f"ag.{namespace}.{key}"


def _decode_key(
    namespace,
    key: str,
) -> str:
    return key.replace(f"ag.{namespace}.", "")


def _encode_value(value: Any) -> Optional[Any]:
    if value is None:
        return None

    if isinstance(value, (str, int, float, bool, bytes)):
        return value

    if isinstance(value, dict) or isinstance(value, list):
        encoded = dumps(value)
        value = "@ag.type=json:" + encoded
        return value

    return repr(value)


def _decode_value(
    value: Any,
) -> Any:
    if isinstance(value, (int, float, bool, bytes)):
        return value

    if isinstance(value, str):
        if value == "@ag.type=none:":
            return None

        if value.startswith("@ag.type=json:"):
            encoded = value[len("@ag.type=json:") :]
            value = loads(encoded)
            return value

        return value

    return value


def _get_attributes(
    attributes: Attributes,
    namespace: str,
):
    return {
        _decode_key(namespace, key): _decode_value(value)
        for key, value in attributes.items()
        if key != _decode_key(namespace, key)
    }


def _parse_from_types(
    otel_span_dto: OTelSpanDTO,
) -> dict:
    types = _get_attributes(otel_span_dto.attributes, "type")

    if types.get("tree"):
        del otel_span_dto.attributes[_encode_key("type", "tree")]

    if types.get("node"):
        del otel_span_dto.attributes[_encode_key("type", "node")]

    return types


def _parse_from_semconv(
    attributes: Attributes,
) -> None:
    _attributes = copy(attributes)

    for old_key, value in _attributes.items():
        if old_key in CODEX["keys"]["attributes"]["exact"]["from"]:
            new_key = CODEX["maps"]["attributes"]["exact"]["from"][old_key]

            attributes[new_key] = value

            del attributes[old_key]

        else:
            for prefix_key in CODEX["keys"]["attributes"]["prefix"]["from"]:
                if old_key.startswith(prefix_key):
                    prefix = CODEX["maps"]["attributes"]["prefix"]["from"][prefix_key]

                    new_key = old_key.replace(prefix_key, prefix)

                    attributes[new_key] = value

                    del attributes[old_key]


def _parse_from_links(
    otel_span_dto: OTelSpanDTO,
) -> dict:
    # LINKS
    links = None
    otel_links = None

    if otel_span_dto.links:
        links = list()
        otel_links = list()

        for link in otel_span_dto.links:
            _links = _get_attributes(link.attributes, "type")

            if _links:
                link_type = _links.get("link")
                link_tree_id = str(UUID(link.context.trace_id[2:]))
                link_node_id = str(
                    UUID(link.context.trace_id[2 + 16 :] + link.context.span_id[2:])
                )

                links.append(
                    LinkDTO(
                        type=link_type,
                        tree_id=link_tree_id,
                        id=link_node_id,
                    )
                )
            else:
                otel_links.append(link)

        links = links if links else None
        otel_links = otel_links if otel_links else None

    otel_span_dto.links = otel_links

    return links


def _parse_from_attributes(
    otel_span_dto: OTelSpanDTO,
) -> Tuple[dict, dict, dict, dict, dict]:
    # DATA
    _data = _get_attributes(otel_span_dto.attributes, "data")

    for key in _data.keys():
        del otel_span_dto.attributes[_encode_key("data", key)]

    # _data = _unmarshal_attributes(_data)
    _data = _data if _data else None

    # METRICS
    _metrics = _get_attributes(otel_span_dto.attributes, "metrics")

    for key in _metrics.keys():
        del otel_span_dto.attributes[_encode_key("metrics", key)]

    # _metrics = _unmarshal_attributes(_metrics)
    _metrics = _metrics if _metrics else None

    # META
    _meta = _get_attributes(otel_span_dto.attributes, "meta")

    for key in _meta.keys():
        del otel_span_dto.attributes[_encode_key("meta", key)]

    # _meta = _unmarshal_attributes(_meta)
    _meta = _meta if _meta else None

    # REFS
    _refs = _get_attributes(otel_span_dto.attributes, "refs")

    for key in _refs.keys():
        del otel_span_dto.attributes[_encode_key("refs", key)]

    _refs = _refs if _refs else None

    if len(otel_span_dto.attributes.keys()) < 1:
        otel_span_dto.attributes = None

    return _data, _metrics, _meta, _refs


def _parse_from_events(
    otel_span_dto: OTelSpanDTO,
) -> Optional[ExceptionDTO]:
    exception = None

    _other_events = list()

    if otel_span_dto.events:
        for event in otel_span_dto.events:
            if event.name == "exception":
                exception = ExceptionDTO(
                    timestamp=event.timestamp,
                    type=event.attributes.get("exception.type"),
                    message=event.attributes.get("exception.message"),
                    stacktrace=event.attributes.get("exception.stacktrace"),
                    attributes=event.attributes,
                )

                del exception.attributes["exception.type"]
                del exception.attributes["exception.message"]
                del exception.attributes["exception.stacktrace"]

            else:
                _other_events.append(event)

    otel_span_dto.events = _other_events if _other_events else None

    return exception


def parse_from_otel_span_dto(
    otel_span_dto: OTelSpanDTO,
) -> SpanDTO:
    _parse_from_semconv(otel_span_dto.attributes)

    types = _parse_from_types(otel_span_dto)

    tree_id = UUID(otel_span_dto.context.trace_id[2:])

    tree_type: str = types.get("tree")

    tree = TreeDTO(
        id=tree_id,
        type=tree_type.lower() if tree_type else None,
    )

    node_id = UUID(tree_id.hex[16:] + otel_span_dto.context.span_id[2:])

    node_type: str = types.get("node")

    node = NodeDTO(
        id=node_id,
        type=node_type.lower() if node_type else None,
        name=otel_span_dto.name,
    )

    parent = (
        ParentDTO(
            id=(
                UUID(
                    otel_span_dto.parent.trace_id[2 + 16 :]
                    + otel_span_dto.parent.span_id[2:]
                )
            )
        )
        if otel_span_dto.parent
        else None
    )

    time = TimeDTO(
        start=otel_span_dto.start_time,
        end=otel_span_dto.end_time,
    )

    status = StatusDTO(
        code=otel_span_dto.status_code.value.replace("STATUS_CODE_", ""),
        message=otel_span_dto.status_message,
    )

    links = _parse_from_links(otel_span_dto)

    data, metrics, meta, refs = _parse_from_attributes(otel_span_dto)

    duration = (otel_span_dto.end_time - otel_span_dto.start_time).total_seconds()

    if metrics is None:
        metrics = dict()

    metrics["acc.duration.total"] = round(duration * 1_000, 3)  # milliseconds

    exception = _parse_from_events(otel_span_dto)

    root_id = refs.get("scenario.id", tree.id.hex)

    root = RootDTO(id=UUID(root_id))

    otel = OTelExtraDTO(
        kind=otel_span_dto.kind.value,
        attributes=otel_span_dto.attributes,
        events=otel_span_dto.events,
        links=otel_span_dto.links,
    )

    span_dto = SpanDTO(
        root=root,
        tree=tree,
        node=node,
        parent=parent,
        time=time,
        status=status,
        exception=exception,
        data=data,
        metrics=metrics,
        meta=meta,
        refs=refs,
        links=links,
        otel=otel,
    )

    return span_dto


def _parse_to_attributes(
    span_dto: SpanDTO,
) -> Attributes:
    attributes = dict()

    MAX_DEPTH = 4

    # DATA
    if span_dto.data:
        _data = span_dto.data

        for key, value in _data.items():
            attributes[_encode_key("data", key)] = _encode_value(value)

    # METRICS
    if span_dto.metrics:
        _metrics = span_dto.metrics

        for key, value in _metrics.items():
            attributes[_encode_key("metrics", key)] = _encode_value(value)

    # META
    if span_dto.meta:
        _meta = span_dto.meta

        for key, value in _meta.items():
            attributes[_encode_key("meta", key)] = _encode_value(value)

    # REFS
    if span_dto.refs:
        for key, value in span_dto.refs.items():
            attributes[_encode_key("refs", key)] = _encode_value(value)

    return attributes


def _parse_to_types(
    span_dto: SpanDTO,
    attributes: Attributes,
) -> Attributes:
    if span_dto.tree.type:
        attributes[_encode_key("type", "tree")] = span_dto.tree.type.value
    if span_dto.node.type:
        attributes[_encode_key("type", "node")] = span_dto.node.type.value


def _parse_to_semconv(
    attributes: Attributes,
) -> None:
    _attributes = copy(attributes)

    for old_key, value in _attributes.items():
        if old_key in CODEX["keys"]["attributes"]["exact"]["to"]:
            new_key = CODEX["maps"]["attributes"]["exact"]["to"][old_key]

            attributes[new_key] = value

            del attributes[old_key]

        else:
            for prefix_key in CODEX["keys"]["attributes"]["prefix"]["to"]:
                if old_key.startswith(prefix_key):
                    prefix = CODEX["maps"]["attributes"]["prefix"]["to"][prefix_key]

                    new_key = old_key.replace(prefix_key, prefix)

                    attributes[new_key] = value

                    del attributes[old_key]


def _parse_to_links(
    span_dto: SpanDTO,
    links: List[LinkDTO],
) -> None:
    if span_dto.links:
        for link in span_dto.links:
            links.append(
                OTelLinkDTO(
                    context=OTelContextDTO(
                        trace_id="0x" + link.tree_id.hex,
                        span_id="0x" + link.id.hex[16:],
                    ),
                    attributes={
                        _encode_key("type", "link"): link.type,
                    },
                )
            )


def _parse_to_events(
    span_dto: SpanDTO,
    events: List[OTelEventDTO],
) -> None:
    if span_dto.exception:
        exception = span_dto.exception

        exception_event = OTelEventDTO(
            name="exception",
            timestamp=exception.timestamp,
            attributes={
                "exception.type": exception.type,
                "exception.message": exception.message,
                "exception.stacktrace": exception.stacktrace,
            },
        )

        exception_event.attributes.update(exception.attributes)

        events.append(exception_event)


def parse_to_otel_span_dto(
    span_dto: SpanDTO,
) -> OTelSpanDTO:
    trace_id = "0x" + span_dto.tree.id.hex
    span_id = "0x" + span_dto.node.id.hex[16:]

    context = OTelContextDTO(trace_id=trace_id, span_id=span_id)

    parent_id = "0x" + span_dto.parent.id.hex[16:] if span_dto.parent else None

    parent = OTelContextDTO(trace_id=trace_id, span_id=parent_id) if parent_id else None

    attributes = _parse_to_attributes(span_dto)

    _parse_to_types(span_dto, attributes)

    _parse_to_semconv(attributes)

    attributes = OrderedDict(sorted(attributes.items())) if attributes.keys() else None

    links = span_dto.otel.links or list()

    _parse_to_links(span_dto, links)

    events = span_dto.otel.events or list()

    _parse_to_events(span_dto, events)

    links = links if links else None

    # MASK LINKS FOR NOW
    links = None
    # ------------------

    otel_span_dto = OTelSpanDTO(
        context=context,
        parent=parent,
        name=span_dto.node.name,
        kind=span_dto.otel.kind,
        start_time=span_dto.time.start,
        end_time=span_dto.time.end,
        status_code="STATUS_CODE_" + span_dto.status.code.value,
        status_message=span_dto.status.message,
        attributes=attributes,
        events=events,
        links=links,
    )

    return otel_span_dto


def parse_to_agenta_span_dto(
    span_dto: SpanDTO,
) -> SpanDTO:
    # DATA
    if span_dto.data:
        span_dto.data = _unmarshal_attributes(span_dto.data)

        if "outputs" in span_dto.data:
            if "__default__" in span_dto.data["outputs"]:
                span_dto.data["outputs"] = span_dto.data["outputs"]["__default__"]

    # METRICS
    if span_dto.metrics:
        span_dto.metrics = _unmarshal_attributes(span_dto.metrics)

    # META
    if span_dto.meta:
        span_dto.meta = _unmarshal_attributes(span_dto.meta)

    # REFS
    if span_dto.refs:
        span_dto.refs = _unmarshal_attributes(span_dto.refs)

    # EXCEPTION
    if span_dto.exception:
        span_dto.exception.attributes = _unmarshal_attributes(
            span_dto.exception.attributes
        )

    # LINKS
    if span_dto.links:
        for link in span_dto.links:
            link.tree_id = None

    # NODES
    if span_dto.nodes:
        for node in span_dto.nodes.values():
            if isinstance(node, list):
                for span in node:
                    parse_to_agenta_span_dto(span)
            else:
                parse_to_agenta_span_dto(node)

    # MASK LINKS FOR NOW
    span_dto.links = None
    # ------------------

    # MASK LIFECYCLE FOR NOW
    span_dto.lifecycle = None
    # ----------------------

    return span_dto
