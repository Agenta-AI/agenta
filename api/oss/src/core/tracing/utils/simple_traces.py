"""Shared helpers for simple trace-backed entities (invocations/annotations)."""

from typing import Any, Dict, List, Mapping, NamedTuple, Optional, Union

from oss.src.core.shared.dtos import Data, Link, Meta, Reference, Tags, Windowing
from oss.src.core.tracing.dtos import (
    ComparisonOperator,
    Condition,
    Filtering,
    Focus,
    Format,
    Formatting,
    ListOperator,
    LogicalOperator,
    OTelFlatSpan,
    OTelLink,
    OTelLinks,
    SimpleTraceLinks,
    Trace,
    TracingQuery,
)

from .attributes import parse_from_attributes, parse_into_attributes


class ParsedSimpleTrace(NamedTuple):
    span: OTelFlatSpan
    flags: Optional[Dict[str, Any]]
    tags: Optional[Tags]
    meta: Optional[Meta]
    data: Data
    references: Dict[str, Reference]
    links: Dict[str, Link]


def build_simple_trace_attributes(
    *,
    trace_kind: str,
    flags: Optional[Mapping[str, Any]],
    tags: Optional[Tags],
    meta: Optional[Meta],
    data: Data,
    references: Mapping[str, Any],
) -> Dict[str, Any]:
    return parse_into_attributes(
        type={"trace": trace_kind, "span": "task"},
        flags=dict(flags) if flags else None,
        tags=tags,
        meta=meta,
        data=data,
        references=dict(references),
    )


def build_otel_links(links: Optional[SimpleTraceLinks]) -> Optional[OTelLinks]:
    if isinstance(links, dict):
        return [
            OTelLink(
                trace_id=link.trace_id,
                span_id=link.span_id,
                attributes={"key": key},  # type: ignore
            )
            for key, link in links.items()
            if link.trace_id and link.span_id
        ]

    if isinstance(links, list):
        return [
            OTelLink(
                trace_id=link.trace_id,
                span_id=link.span_id,
                attributes={"key": "key"},  # type: ignore
            )
            for link in links
            if link.trace_id and link.span_id
        ]

    return None


def first_link(links: Optional[OTelLinks]) -> Optional[Link]:
    if not links:
        return None

    link = links[0]
    if not link.trace_id or not link.span_id:
        return None

    return Link(trace_id=link.trace_id, span_id=link.span_id)


def extract_root_span(trace: Optional[Trace]) -> Optional[OTelFlatSpan]:
    if not trace or not trace.spans:
        return None

    spans = list(trace.spans.values())
    root_span = spans[0] if spans else None

    if not root_span or isinstance(root_span, list):
        return None

    return root_span


def parse_reference_map(
    references: Optional[Dict[str, Dict[str, Any]]],
) -> Dict[str, Reference]:
    return {
        key: Reference(
            id=ref.get("id"),
            slug=ref.get("slug"),
            version=ref.get("version"),
        )
        for key, ref in (references or {}).items()
        if isinstance(ref, dict)
    }


def parse_named_links(links: Optional[OTelLinks]) -> Dict[str, Link]:
    return {
        str(link.attributes["key"]): Link(
            trace_id=link.trace_id,
            span_id=link.span_id,
        )
        for link in links or []
        if link.attributes and "key" in link.attributes
    }


def parse_simple_trace(trace: Optional[Trace]) -> Optional[ParsedSimpleTrace]:
    root_span = extract_root_span(trace)
    if root_span is None:
        return None

    (
        _type,
        flags,
        tags,
        meta,
        data,
        references,
    ) = parse_from_attributes(root_span.attributes or {})

    if not data:
        return None

    return ParsedSimpleTrace(
        span=root_span,
        flags=flags,
        tags=tags,
        meta=meta,
        data=data,
        references=parse_reference_map(references),
        links=parse_named_links(root_span.links),
    )


def build_simple_trace_filtering(
    *,
    trace_kind: str,
    flags: Optional[Mapping[str, Any]] = None,
    tags: Optional[Tags] = None,
    meta: Optional[Meta] = None,
    references: Optional[Mapping[str, Any]] = None,
    links: Optional[SimpleTraceLinks] = None,
    trace_links: Optional[Union[List[Link], Dict[str, Link]]] = None,
) -> Filtering:
    conditions: List[Union[Condition, Filtering]] = [
        Condition(
            field="attributes",
            key="ag.type.trace",
            value=trace_kind,
            operator=ComparisonOperator.IS,
        )
    ]

    trace_scope_links = (
        list(trace_links.values()) if isinstance(trace_links, dict) else trace_links
    )
    trace_ids = (
        [trace_link.trace_id for trace_link in trace_scope_links if trace_link]
        if trace_scope_links
        else None
    )
    if trace_ids:
        conditions.append(
            Condition(
                field="trace_id",
                value=trace_ids,
                operator=ListOperator.IN,
            )
        )

    if flags:
        for key, value in flags.items():
            conditions.append(
                Condition(
                    field="attributes",
                    key=f"ag.flags.{key}",
                    value=value,
                    operator=ComparisonOperator.IS,
                )
            )

    if tags:
        for key, value in tags.items():
            conditions.append(
                Condition(
                    field="attributes",
                    key=f"ag.tags.{key}",
                    value=value,  # type:ignore
                    operator=ComparisonOperator.IS,
                )
            )

    if meta:
        for key, value in meta.items():
            conditions.append(
                Condition(
                    field="attributes",
                    key=f"ag.meta.{key}",
                    value=value,  # type:ignore
                    operator=ComparisonOperator.IS,
                )
            )

    if references:
        for reference in references.values():
            if reference:
                ref_id = str(reference.get("id")) if reference.get("id") else None
                ref_slug = str(reference.get("slug")) if reference.get("slug") else None
                conditions.append(
                    Condition(
                        field="references",
                        value=[{"id": ref_id, "slug": ref_slug}],
                        operator=ListOperator.IN,
                    )
                )

    if links:
        if isinstance(links, dict):
            for link in links.values():
                if link:
                    conditions.append(
                        Condition(
                            field="links",
                            value=[
                                {
                                    "trace_id": link.trace_id,
                                    "span_id": link.span_id,
                                },
                            ],
                            operator=ListOperator.IN,
                        )
                    )
        elif isinstance(links, list):
            link_conditions = []
            for link in links:
                if link:
                    link_conditions.append(
                        Condition(
                            field="links",
                            value=[
                                {
                                    "trace_id": link.trace_id,
                                    "span_id": link.span_id,
                                },
                            ],
                            operator=ListOperator.IN,
                        )
                    )

            if link_conditions:
                conditions.append(
                    Filtering(
                        operator=LogicalOperator.OR,
                        conditions=link_conditions,
                    )
                )

    return Filtering(
        operator=LogicalOperator.AND,
        conditions=conditions,
    )


def build_simple_trace_query(
    *,
    trace_kind: str,
    flags: Optional[Mapping[str, Any]] = None,
    tags: Optional[Tags] = None,
    meta: Optional[Meta] = None,
    references: Optional[Mapping[str, Any]] = None,
    links: Optional[SimpleTraceLinks] = None,
    trace_links: Optional[Union[List[Link], Dict[str, Link]]] = None,
    windowing: Optional[Windowing] = None,
) -> TracingQuery:
    return TracingQuery(
        formatting=Formatting(
            focus=Focus.TRACE,
            format=Format.AGENTA,
        ),
        filtering=build_simple_trace_filtering(
            trace_kind=trace_kind,
            flags=flags,
            tags=tags,
            meta=meta,
            references=references,
            links=links,
            trace_links=trace_links,
        ),
        windowing=windowing,
    )
