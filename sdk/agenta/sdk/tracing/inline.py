############################
### services.shared.dtos ###
### -------------------- ###

from typing import Optional

from pydantic import BaseModel
from uuid import UUID
from datetime import datetime
from enum import Enum
from collections import OrderedDict


class ProjectScopeDTO(BaseModel):
    project_id: UUID


class LifecycleDTO(BaseModel):
    created_at: datetime
    updated_at: Optional[datetime] = None

    updated_by_id: Optional[UUID] = None


### -------------------- ###
### services.shared.dtos ###
############################


###################################
### services.observability.dtos ###
### --------------------------- ###

from typing import List, Dict, Any, Union, Optional

from enum import Enum
from datetime import datetime
from uuid import UUID


class TimeDTO(BaseModel):
    start: datetime
    end: datetime


class StatusCode(Enum):
    UNSET = "UNSET"
    OK = "OK"
    ERROR = "ERROR"


class StatusDTO(BaseModel):
    code: StatusCode
    message: Optional[str] = None
    stacktrace: Optional[str] = None


AttributeValueType = Any
Attributes = Dict[str, AttributeValueType]


class TreeType(Enum):
    # --- VARIANTS --- #
    INVOCATION = "invocation"
    # --- VARIANTS --- #


class NodeType(Enum):
    # --- VARIANTS --- #
    ## SPAN_KIND_SERVER
    AGENT = "agent"
    WORKFLOW = "workflow"
    CHAIN = "chain"
    ## SPAN_KIND_INTERNAL
    TASK = "task"
    ## SPAN_KIND_CLIENT
    TOOL = "tool"
    EMBEDDING = "embedding"
    QUERY = "query"
    COMPLETION = "completion"
    CHAT = "chat"
    RERANK = "rerank"
    # --- VARIANTS --- #


class RootDTO(BaseModel):
    id: UUID


class TreeDTO(BaseModel):
    id: UUID
    type: Optional[TreeType] = None


class NodeDTO(BaseModel):
    id: UUID
    type: Optional[NodeType] = None
    name: str


Data = Dict[str, Any]
Metrics = Dict[str, Any]
Metadata = Dict[str, Any]
Tags = Dict[str, Any]
Refs = Dict[str, Any]


class LinkDTO(BaseModel):
    type: str
    id: UUID
    tree_id: Optional[UUID] = None


class ParentDTO(BaseModel):
    id: UUID


class OTelSpanKind(Enum):
    SPAN_KIND_UNSPECIFIED = "SPAN_KIND_UNSPECIFIED"
    # INTERNAL
    SPAN_KIND_INTERNAL = "SPAN_KIND_INTERNAL"
    # SYNCHRONOUS
    SPAN_KIND_SERVER = "SPAN_KIND_SERVER"
    SPAN_KIND_CLIENT = "SPAN_KIND_CLIENT"
    # ASYNCHRONOUS
    SPAN_KIND_PRODUCER = "SPAN_KIND_PRODUCER"
    SPAN_KIND_CONSUMER = "SPAN_KIND_CONSUMER"


class OTelStatusCode(Enum):
    STATUS_CODE_OK = "STATUS_CODE_OK"
    STATUS_CODE_ERROR = "STATUS_CODE_ERROR"
    STATUS_CODE_UNSET = "STATUS_CODE_UNSET"


class OTelContextDTO(BaseModel):
    trace_id: str
    span_id: str


class OTelEventDTO(BaseModel):
    name: str
    timestamp: datetime

    attributes: Optional[Attributes] = None


class OTelLinkDTO(BaseModel):
    context: OTelContextDTO

    attributes: Optional[Attributes] = None


class OTelExtraDTO(BaseModel):
    kind: Optional[str] = None

    attributes: Optional[Attributes] = None
    events: Optional[List[OTelEventDTO]] = None
    links: Optional[List[OTelLinkDTO]] = None


class SpanDTO(BaseModel):
    trace_id: str
    span_id: str

    scope: Optional[ProjectScopeDTO] = None

    lifecycle: Optional[LifecycleDTO] = None

    root: RootDTO
    tree: TreeDTO
    node: NodeDTO

    parent: Optional[ParentDTO] = None

    time: TimeDTO
    status: StatusDTO

    data: Optional[Data] = None
    metrics: Optional[Metrics] = None
    meta: Optional[Metadata] = None
    tags: Optional[Tags] = None
    refs: Optional[Refs] = None

    links: Optional[List[LinkDTO]] = None

    otel: Optional[OTelExtraDTO] = None

    nodes: Optional[Dict[str, Union["SpanDTO", List["SpanDTO"]]]] = None


class OTelSpanDTO(BaseModel):
    context: OTelContextDTO

    name: str
    kind: OTelSpanKind = OTelSpanKind.SPAN_KIND_UNSPECIFIED

    start_time: datetime
    end_time: datetime

    status_code: OTelStatusCode = OTelStatusCode.STATUS_CODE_UNSET
    status_message: Optional[str] = None

    attributes: Optional[Attributes] = None
    events: Optional[List[OTelEventDTO]] = None

    parent: Optional[OTelContextDTO] = None
    links: Optional[List[OTelLinkDTO]] = None


### --------------------------- ###
### services.observability.dtos ###
###################################


####################################
### services.observability.utils ###
### ---------------------------- ###

from typing import List, Dict, OrderedDict


def parse_span_dtos_to_span_idx(
    span_dtos: List[SpanDTO],
) -> Dict[str, SpanDTO]:
    span_idx = {span_dto.node.id: span_dto for span_dto in span_dtos}

    return span_idx


def parse_span_idx_to_span_id_tree(
    span_idx: Dict[str, SpanDTO],
) -> OrderedDict:
    span_id_tree = OrderedDict()
    index = {}

    def push(span_dto: SpanDTO) -> None:
        if span_dto.parent is None:
            span_id_tree[span_dto.node.id] = OrderedDict()
            index[span_dto.node.id] = span_id_tree[span_dto.node.id]
        elif span_dto.parent.id in index:
            index[span_dto.parent.id][span_dto.node.id] = OrderedDict()
            index[span_dto.node.id] = index[span_dto.parent.id][span_dto.node.id]

    for span_dto in sorted(span_idx.values(), key=lambda span_dto: span_dto.time.start):
        push(span_dto)

    return span_id_tree


def cumulate_costs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, SpanDTO],
) -> None:
    def _get_unit(span: SpanDTO):
        if span.metrics is not None:
            return span.metrics.get("unit.costs.total", 0.0)

        return 0.0

    def _get_acc(span: SpanDTO):
        if span.metrics is not None:
            return span.metrics.get("acc.costs.total", 0.0)

        return 0.0

    def _acc(a: float, b: float):
        return a + b

    def _set(span: SpanDTO, cost: float):
        if span.metrics is None:
            span.metrics = {}

        if cost != 0.0:
            span.metrics["acc.costs.total"] = cost

    _cumulate_tree_dfs(spans_id_tree, spans_idx, _get_unit, _get_acc, _acc, _set)


def cumulate_tokens(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, dict],
) -> None:
    def _get_unit(span: SpanDTO):
        _tokens = {
            "prompt": 0.0,
            "completion": 0.0,
            "total": 0.0,
        }

        if span.metrics is not None:
            return {
                "prompt": span.metrics.get("unit.tokens.prompt", 0.0),
                "completion": span.metrics.get("unit.tokens.completion", 0.0),
                "total": span.metrics.get("unit.tokens.total", 0.0),
            }

        return _tokens

    def _get_acc(span: SpanDTO):
        _tokens = {
            "prompt": 0.0,
            "completion": 0.0,
            "total": 0.0,
        }

        if span.metrics is not None:
            return {
                "prompt": span.metrics.get("acc.tokens.prompt", 0.0),
                "completion": span.metrics.get("acc.tokens.completion", 0.0),
                "total": span.metrics.get("acc.tokens.total", 0.0),
            }

        return _tokens

    def _acc(a: dict, b: dict):
        return {
            "prompt": a.get("prompt", 0.0) + b.get("prompt", 0.0),
            "completion": a.get("completion", 0.0) + b.get("completion", 0.0),
            "total": a.get("total", 0.0) + b.get("total", 0.0),
        }

    def _set(span: SpanDTO, tokens: dict):
        if span.metrics is None:
            span.metrics = {}

        if tokens.get("prompt", 0.0) != 0.0:
            span.metrics["acc.tokens.prompt"] = tokens.get("prompt", 0.0)
        if tokens.get("completion", 0.0) != 0.0:
            span.metrics["acc.tokens.completion"] = (
                tokens.get("completion", 0.0)
                if tokens.get("completion", 0.0) != 0.0
                else None
            )
        if tokens.get("total", 0.0) != 0.0:
            span.metrics["acc.tokens.total"] = (
                tokens.get("total", 0.0) if tokens.get("total", 0.0) != 0.0 else None
            )

    _cumulate_tree_dfs(spans_id_tree, spans_idx, _get_unit, _get_acc, _acc, _set)


def _cumulate_tree_dfs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, SpanDTO],
    get_unit_metric,
    get_acc_metric,
    accumulate_metric,
    set_metric,
):
    for span_id, children_spans_id_tree in spans_id_tree.items():
        children_spans_id_tree: OrderedDict

        cumulated_metric = get_unit_metric(spans_idx[span_id])

        _cumulate_tree_dfs(
            children_spans_id_tree,
            spans_idx,
            get_unit_metric,
            get_acc_metric,
            accumulate_metric,
            set_metric,
        )

        for child_span_id in children_spans_id_tree.keys():
            marginal_metric = get_acc_metric(spans_idx[child_span_id])
            cumulated_metric = accumulate_metric(cumulated_metric, marginal_metric)

        set_metric(spans_idx[span_id], cumulated_metric)


def connect_children(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, dict],
) -> None:
    _connect_tree_dfs(spans_id_tree, spans_idx)


def _connect_tree_dfs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, SpanDTO],
):
    for span_id, children_spans_id_tree in spans_id_tree.items():
        children_spans_id_tree: OrderedDict

        parent_span = spans_idx[span_id]

        parent_span.nodes = dict()

        _connect_tree_dfs(children_spans_id_tree, spans_idx)

        for child_span_id in children_spans_id_tree.keys():
            child_span_name = spans_idx[child_span_id].node.name
            if child_span_name not in parent_span.nodes:
                parent_span.nodes[child_span_name] = spans_idx[child_span_id]
            else:
                if not isinstance(parent_span.nodes[child_span_name], list):
                    parent_span.nodes[child_span_name] = [
                        parent_span.nodes[child_span_name]
                    ]

                parent_span.nodes[child_span_name].append(spans_idx[child_span_id])

        if len(parent_span.nodes) == 0:
            parent_span.nodes = None


### ---------------------------- ###
### services.observability.utils ###
####################################


########################################################
### apis.fastapi.observability.opentelemetry.semconv ###
### ------------------------------------------------ ###

from json import loads

VERSION = "0.4.1"

V_0_4_1_ATTRIBUTES_EXACT = [
    # OPENLLMETRY
    ("gen_ai.system", "ag.meta.system"),
    ("gen_ai.request.base_url", "ag.meta.request.base_url"),
    ("gen_ai.request.endpoint", "ag.meta.request.endpoint"),
    ("gen_ai.request.headers", "ag.meta.request.headers"),
    ("gen_ai.request.type", "ag.type.node"),
    ("gen_ai.request.streaming", "ag.meta.request.streaming"),
    ("gen_ai.request.model", "ag.meta.request.model"),
    ("gen_ai.request.max_tokens", "ag.meta.request.max_tokens"),
    ("gen_ai.request.temperature", "ag.meta.request.temperature"),
    ("gen_ai.request.top_p", "ag.meta.request.top_p"),
    ("gen_ai.response.model", "ag.meta.response.model"),
    ("gen_ai.usage.prompt_tokens", "ag.metrics.unit.tokens.prompt"),
    ("gen_ai.usage.completion_tokens", "ag.metrics.unit.tokens.completion"),
    ("gen_ai.usage.total_tokens", "ag.metrics.unit.tokens.total"),
    ("llm.headers", "ag.meta.request.headers"),
    ("llm.request.type", "ag.type.node"),
    ("llm.top_k", "ag.meta.request.top_k"),
    ("llm.is_streaming", "ag.meta.request.streaming"),
    ("llm.usage.total_tokens", "ag.metrics.unit.tokens.total"),
    ("gen_ai.openai.api_base", "ag.meta.request.base_url"),
    ("db.system", "ag.meta.system"),
    ("db.vector.query.top_k", "ag.meta.request.top_k"),
    ("pinecone.query.top_k", "ag.meta.request.top_k"),
    ("traceloop.span.kind", "ag.type.node"),
    ("traceloop.entity.name", "ag.node.name"),
    # OPENINFERENCE
    ("output.value", "ag.data.outputs"),
    ("input.value", "ag.data.inputs"),
    ("embedding.model_name", "ag.meta.request.model"),
    ("llm.invocation_parameters", "ag.meta.request"),
    ("llm.model_name", "ag.meta.request.model"),
    ("llm.provider", "ag.meta.provider"),
    ("llm.system", "ag.meta.system"),
]
V_0_4_1_ATTRIBUTES_PREFIX = [
    # OPENLLMETRY
    ("gen_ai.prompt", "ag.data.inputs.prompt"),
    ("gen_ai.completion", "ag.data.outputs.completion"),
    ("llm.request.functions", "ag.data.inputs.functions"),
    ("llm.request.tools", "ag.data.inputs.tools"),
    # OPENINFERENCE
    ("llm.token_count", "ag.metrics.unit.tokens"),
    ("llm.input_messages", "ag.data.inputs.prompt"),
    ("llm.output_messages", "ag.data.outputs.completion"),
]

V_0_4_1_ATTRIBUTES_DYNAMIC = [
    # OPENLLMETRY
    ("traceloop.entity.input", lambda x: ("ag.data.inputs", loads(x).get("inputs"))),
    ("traceloop.entity.output", lambda x: ("ag.data.outputs", loads(x).get("outputs"))),
]


V_0_4_1_MAPS = {
    "attributes": {
        "exact": {
            "from": {otel: agenta for otel, agenta in V_0_4_1_ATTRIBUTES_EXACT[::-1]},
            "to": {agenta: otel for otel, agenta in V_0_4_1_ATTRIBUTES_EXACT[::-1]},
        },
        "prefix": {
            "from": {otel: agenta for otel, agenta in V_0_4_1_ATTRIBUTES_PREFIX[::-1]},
            "to": {agenta: otel for otel, agenta in V_0_4_1_ATTRIBUTES_PREFIX[::-1]},
        },
        "dynamic": {
            "from": {otel: agenta for otel, agenta in V_0_4_1_ATTRIBUTES_DYNAMIC[::-1]}
        },
    },
}
V_0_4_1_KEYS = {
    "attributes": {
        "exact": {
            "from": list(V_0_4_1_MAPS["attributes"]["exact"]["from"].keys()),
            "to": list(V_0_4_1_MAPS["attributes"]["exact"]["to"].keys()),
        },
        "prefix": {
            "from": list(V_0_4_1_MAPS["attributes"]["prefix"]["from"].keys()),
            "to": list(V_0_4_1_MAPS["attributes"]["prefix"]["to"].keys()),
        },
        "dynamic": {
            "from": list(V_0_4_1_MAPS["attributes"]["dynamic"]["from"].keys()),
        },
    },
}


MAPS = {
    "0.4.1": V_0_4_1_MAPS,  # LATEST
}
KEYS = {
    "0.4.1": V_0_4_1_KEYS,  # LATEST
}

CODEX = {"maps": MAPS[VERSION], "keys": KEYS[VERSION]}


### ------------------------------------------------ ###
### apis.fastapi.observability.opentelemetry.semconv ###
########################################################


########################################
### apis.fastapi.observability.utils ###
### -------------------------------- ###

from typing import Optional, Union, Tuple, Any, List, Dict
from uuid import UUID
from collections import OrderedDict
from json import loads, JSONDecodeError, dumps
from copy import copy


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

            for dynamic_key in CODEX["keys"]["attributes"]["dynamic"]["from"]:
                if old_key == dynamic_key:
                    try:
                        new_key, new_value = CODEX["maps"]["attributes"]["dynamic"][
                            "from"
                        ][dynamic_key](value)

                        attributes[new_key] = new_value

                    except:  # pylint: disable=bare-except
                        pass


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

    # TAGS
    _tags = _get_attributes(otel_span_dto.attributes, "tags")

    for key in _tags.keys():
        del otel_span_dto.attributes[_encode_key("tags", key)]

    _tags = _tags if _tags else None

    # REFS
    _refs = _get_attributes(otel_span_dto.attributes, "refs")

    for key in _refs.keys():
        del otel_span_dto.attributes[_encode_key("refs", key)]

    _refs = _refs if _refs else None

    if len(otel_span_dto.attributes.keys()) < 1:
        otel_span_dto.attributes = None

    return _data, _metrics, _meta, _tags, _refs


def parse_from_otel_span_dto(
    otel_span_dto: OTelSpanDTO,
) -> SpanDTO:
    trace_id = str(otel_span_dto.context.trace_id[2:])
    span_id = str(otel_span_dto.context.span_id[2:])

    lifecyle = LifecycleDTO(
        created_at=datetime.now(),
    )

    _parse_from_semconv(otel_span_dto.attributes)

    types = _parse_from_types(otel_span_dto)

    tree_id = UUID(trace_id)

    tree_type: str = types.get("tree")

    tree = TreeDTO(
        id=tree_id,
        type=tree_type.lower() if tree_type else None,
    )

    node_id = UUID(trace_id[16:] + span_id)

    node_type = NodeType.TASK
    try:
        node_type = NodeType(types.get("node", "").lower())
    except:  # pylint: disable=bare-except
        pass

    node = NodeDTO(
        id=node_id,
        type=node_type,
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

    data, metrics, meta, tags, refs = _parse_from_attributes(otel_span_dto)

    duration = (otel_span_dto.end_time - otel_span_dto.start_time).total_seconds()

    if metrics is None:
        metrics = dict()

    metrics["acc.duration.total"] = round(duration * 1_000, 3)  # milliseconds

    root_id = str(tree_id)
    if refs is not None:
        root_id = refs.get("scenario.id", root_id)

    root = RootDTO(id=UUID(root_id))

    otel = OTelExtraDTO(
        kind=otel_span_dto.kind.value,
        attributes=otel_span_dto.attributes,
        events=otel_span_dto.events,
        links=otel_span_dto.links,
    )

    span_dto = SpanDTO(
        trace_id=trace_id,
        span_id=span_id,
        lifecycle=lifecyle,
        root=root,
        tree=tree,
        node=node,
        parent=parent,
        time=time,
        status=status,
        data=data,
        metrics=metrics,
        meta=meta,
        tags=tags,
        refs=refs,
        links=links,
        otel=otel,
    )

    return span_dto


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

    # TAGS
    if span_dto.tags:
        span_dto.tags = _unmarshal_attributes(span_dto.tags)

    # REFS
    if span_dto.refs:
        span_dto.refs = _unmarshal_attributes(span_dto.refs)

    if isinstance(span_dto.links, list):
        for link in span_dto.links:
            link.tree_id = None

    if span_dto.nodes:
        for v in span_dto.nodes.values():
            if isinstance(v, list):
                for n in v:
                    parse_to_agenta_span_dto(n)
            else:
                parse_to_agenta_span_dto(v)

    # MASK LINKS FOR NOW
    span_dto.links = None
    # ------------------

    # MASK LIFECYCLE FOR NOW
    # span_dto.lifecycle = None
    if span_dto.lifecycle:
        span_dto.lifecycle.updated_at = None
        span_dto.lifecycle.updated_by_id = None
    # ----------------------

    return span_dto


### -------------------------------- ###
### apis.fastapi.observability.utils ###
########################################


from litellm import cost_calculator
from opentelemetry.sdk.trace import ReadableSpan

from agenta.sdk.types import AgentaNodeDto, AgentaNodesResponse


def parse_inline_trace(
    spans: Dict[str, ReadableSpan],
):
    otel_span_dtos = _parse_readable_spans(spans)

    ############################################################
    ### apis.fastapi.observability.api.otlp_collect_traces() ###
    ### ---------------------------------------------------- ###
    span_dtos = [
        parse_from_otel_span_dto(otel_span_dto) for otel_span_dto in otel_span_dtos
    ]
    ### ---------------------------------------------------- ###
    ### apis.fastapi.observability.api.otlp_collect_traces() ###
    ############################################################

    #####################################################
    ### services.observability.service.ingest/query() ###
    ### --------------------------------------------- ###
    span_idx = parse_span_dtos_to_span_idx(span_dtos)
    span_id_tree = parse_span_idx_to_span_id_tree(span_idx)
    ### --------------------------------------------- ###
    ### services.observability.service.ingest/query() ###
    #####################################################

    ###############################################
    ### services.observability.service.ingest() ###
    ### --------------------------------------- ###
    calculate_costs(span_idx)
    cumulate_costs(span_id_tree, span_idx)
    cumulate_tokens(span_id_tree, span_idx)
    ### --------------------------------------- ###
    ### services.observability.service.ingest() ###
    ###############################################

    ##############################################
    ### services.observability.service.query() ###
    ### -------------------------------------- ###
    connect_children(span_id_tree, span_idx)
    root_span_dtos = [span_idx[span_id] for span_id in span_id_tree.keys()]
    agenta_span_dtos = [
        parse_to_agenta_span_dto(span_dto) for span_dto in root_span_dtos
    ]
    ### -------------------------------------- ###
    ### services.observability.service.query() ###
    ##############################################

    spans = [
        loads(
            span_dto.model_dump_json(
                exclude_none=True,
                exclude_defaults=True,
            )
        )
        for span_dto in agenta_span_dtos
    ]
    inline_trace = AgentaNodesResponse(
        version="1.0.0",
        nodes=[AgentaNodeDto(**span) for span in spans],
    ).model_dump(exclude_none=True, exclude_unset=True)
    return inline_trace


def _parse_readable_spans(
    spans: List[ReadableSpan],
) -> List[OTelSpanDTO]:
    otel_span_dtos = list()

    for span in spans:
        otel_events = [
            OTelEventDTO(
                name=event.name,
                timestamp=_timestamp_ns_to_datetime(event.timestamp),
                attributes=event.attributes,
            )
            for event in span.events
        ]
        otel_links = [
            OTelLinkDTO(
                context=OTelContextDTO(
                    trace_id=_int_to_hex(link.context.trace_id, 128),
                    span_id=_int_to_hex(link.context.span_id, 64),
                ),
                attributes=link.attributes,
            )
            for link in span.links
        ]
        otel_span_dto = OTelSpanDTO(
            context=OTelContextDTO(
                trace_id=_int_to_hex(span.get_span_context().trace_id, 128),
                span_id=_int_to_hex(span.get_span_context().span_id, 64),
            ),
            name=span.name,
            kind=OTelSpanKind(
                "SPAN_KIND_"
                + (span.kind if isinstance(span.kind, str) else span.kind.name)
            ),
            start_time=_timestamp_ns_to_datetime(span.start_time),
            end_time=_timestamp_ns_to_datetime(span.end_time),
            status_code=OTelStatusCode("STATUS_CODE_" + span.status.status_code.name),
            status_message=span.status.description,
            attributes=span.attributes,
            events=otel_events if len(otel_events) > 0 else None,
            parent=(
                OTelContextDTO(
                    trace_id=_int_to_hex(span.parent.trace_id, 128),
                    span_id=_int_to_hex(span.parent.span_id, 64),
                )
                if span.parent and not span.parent.is_remote
                else None
            ),
            links=otel_links if len(otel_links) > 0 else None,
        )

        otel_span_dtos.append(otel_span_dto)

    return otel_span_dtos


def _int_to_hex(integer, bits):
    _hex = hex(integer)[2:]

    _hex = _hex.zfill(bits // 4)

    _hex = "0x" + _hex

    return _hex


def _timestamp_ns_to_datetime(timestamp_ns):
    _datetime = datetime.fromtimestamp(
        timestamp_ns / 1_000_000_000,
    ).isoformat(
        timespec="microseconds",
    )

    return _datetime


class LlmTokens(BaseModel):
    prompt_tokens: Optional[int] = 0
    completion_tokens: Optional[int] = 0
    total_tokens: Optional[int] = 0


TYPES_WITH_COSTS = [
    "embedding",
    "query",
    "completion",
    "chat",
    "rerank",
]


def calculate_costs(span_idx: Dict[str, SpanDTO]):
    for span in span_idx.values():
        if (
            span.node.type
            and span.node.type.name.lower() in TYPES_WITH_COSTS
            and span.meta
            and span.metrics
        ):
            model = span.meta.get("response.model") or span.meta.get(
                "configuration.model"
            )
            prompt_tokens = span.metrics.get("unit.tokens.prompt", 0.0)
            completion_tokens = span.metrics.get("unit.tokens.completion", 0.0)

            try:
                costs = cost_calculator.cost_per_token(
                    model=model,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                )

                if not costs:
                    continue

                prompt_cost, completion_cost = costs
                total_cost = prompt_cost + completion_cost

                span.metrics["unit.costs.prompt"] = prompt_cost
                span.metrics["unit.costs.completion"] = completion_cost
                span.metrics["unit.costs.total"] = total_cost

            except:  # pylint: disable=bare-except
                pass
