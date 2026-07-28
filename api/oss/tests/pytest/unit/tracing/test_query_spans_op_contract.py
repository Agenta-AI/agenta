"""The `query_spans` op's advertised contract, against the endpoint model it calls.

The op used to inline the endpoint's whole filtering DSL as `$defs`, and this test compared the
two structures. That inlining was ~1,150 tokens on every turn, so the DSL moved into
`references/span-queries.md` and the arguments are advertised as open objects whose descriptions
carry the vocabulary (see the progressive-tool-disclosure project).

That trade makes this test MORE load-bearing, not less: prose cannot be type-checked, so the
operator names the model is told about are only as good as this assertion. What is pinned here is
the vocabulary in BOTH directions — every operator the endpoint accepts must be advertised, and
every operator the prose advertises must still be accepted — plus the round trip that was always
here.
"""

import re

from agenta.sdk.agents.adapters.agenta_builtins import BUILD_AN_AGENT_SKILL
from agenta.sdk.agents.platform.op_catalog import PLATFORM_OPS
from oss.src.apis.fastapi.tracing.models import SpansQueryRequest

_OPERATOR_DEFS = (
    "ComparisonOperator",
    "NumericOperator",
    "StringOperator",
    "DictOperator",
    "ListOperator",
    "ExistenceOperator",
)

# Span fields the filtering description backticks. Not derivable from the endpoint model (`field`
# is a free string there), and needed to tell a field name from an operator when reading the prose
# back out.
_SPAN_FIELDS_NAMED_IN_PROSE = frozenset(
    {
        "trace_id",
        "span_id",
        "span_name",
        "span_type",
        "status_code",
        "attributes",
        "content",
    }
)


def _span_queries_reference() -> str:
    by_path = {file.path: file.content for file in BUILD_AN_AGENT_SKILL.files}
    return by_path["references/span-queries.md"]


def _filtering_description() -> str:
    return PLATFORM_OPS["query_spans"].resolved_input_schema()["properties"][
        "filtering"
    ]["description"]


def _accepted_operators() -> set:
    endpoint_defs = SpansQueryRequest.model_json_schema()["$defs"]
    return {
        value
        for name in _OPERATOR_DEFS + ("LogicalOperator",)
        for value in endpoint_defs[name]["enum"]
    }


def test_query_spans_op_argument_names_match_the_endpoint_model():
    schema = PLATFORM_OPS["query_spans"].resolved_input_schema()

    assert PLATFORM_OPS["query_spans"].path == "/api/spans/query"
    assert set(schema["properties"]) == set(SpansQueryRequest.model_fields)
    assert set(schema["properties"]) == set(
        SpansQueryRequest.model_json_schema()["properties"]
    )
    # The DSL is no longer inlined; nothing may re-expand it here.
    assert "$defs" not in schema


def test_advertised_dsl_vocabulary_covers_every_operator_the_endpoint_accepts():
    """A condition operator the endpoint accepts but nobody tells the model about is dead."""
    endpoint_defs = SpansQueryRequest.model_json_schema()["$defs"]
    filtering_description = PLATFORM_OPS["query_spans"].resolved_input_schema()[
        "properties"
    ]["filtering"]["description"]
    reference = _span_queries_reference()

    for name in _OPERATOR_DEFS:
        for operator in endpoint_defs[name]["enum"]:
            assert f"`{operator}`" in filtering_description, (
                f"{operator} ({name}) is missing from the advertised filtering description"
            )
            # Backticked, or short operators (`is`, `in`, `eq`) match inside ordinary prose and
            # the assertion passes whether or not the reference documents them.
            assert f"`{operator}`" in reference, (
                f"{operator} ({name}) is missing from the reference"
            )

    for logical in endpoint_defs["LogicalOperator"]["enum"]:
        assert f"`{logical}`" in filtering_description, logical


def test_advertised_dsl_vocabulary_names_no_operator_the_endpoint_dropped():
    """The reverse: an operator the endpoint stopped accepting must stop being advertised.

    Only the endpoint side is generated, so nothing but this catches prose outliving the model —
    the model would keep sending an operator the server now rejects at runtime."""
    accepted = _accepted_operators()
    description = _filtering_description()

    # Single-word backticked tokens only: the description also backticks JSON fragments and the
    # reference path, which are shape rather than vocabulary.
    tokens = {
        token
        for token in re.findall(r"`([^`]+)`", description)
        if re.fullmatch(r"[a-z_]+", token)
    }
    condition_keys = set(
        SpansQueryRequest.model_json_schema()["$defs"]["Condition"]["properties"]
    )
    named_operators = tokens - _SPAN_FIELDS_NAMED_IN_PROSE - condition_keys

    assert named_operators, (
        "no operator found in the description — the token scan went stale"
    )
    assert named_operators <= accepted, (
        f"advertised but no longer accepted by the endpoint: {sorted(named_operators - accepted)}"
    )


def test_advertised_condition_and_windowing_fields_match_the_endpoint_model():
    endpoint_defs = SpansQueryRequest.model_json_schema()["$defs"]
    properties = PLATFORM_OPS["query_spans"].resolved_input_schema()["properties"]
    reference = _span_queries_reference()

    for field in endpoint_defs["Condition"]["properties"]:
        assert f"`{field}`" in properties["filtering"]["description"] or (
            f"`{field}`" in reference
        ), f"condition field {field} is undocumented"

    for field in endpoint_defs["Windowing"]["properties"]:
        assert f"`{field}`" in properties["windowing"]["description"] or (
            f"`{field}`" in reference
        ), f"windowing field {field} is undocumented"


def test_query_spans_payload_round_trips_through_the_endpoint_model():
    schema = PLATFORM_OPS["query_spans"].resolved_input_schema()

    payload = {
        "filtering": {
            "operator": "and",
            "conditions": [
                {"field": "trace_id", "operator": "is", "value": "trace-123"}
            ],
        },
        "windowing": {
            "oldest": "2026-07-04T10:00:00Z",
            "newest": "2026-07-04T10:05:00Z",
            "next": "00000000-0000-0000-0000-000000000001",
            "limit": 25,
            "order": "descending",
            "interval": 60,
            "rate": 1.0,
        },
        "query_ref": {"slug": "recent-agent-runs"},
        "query_variant_ref": {"slug": "recent-agent-runs", "version": "latest"},
        "query_revision_ref": {"id": "00000000-0000-0000-0000-000000000002"},
    }

    assert set(payload) == set(schema["properties"])
    assert set(payload) <= set(SpansQueryRequest.model_fields)

    validated = SpansQueryRequest.model_validate(payload)

    assert validated.model_fields_set == set(payload)
    for key in payload:
        assert getattr(validated, key) is not None, f"{key} was silently dropped"
        assert key in validated.model_dump(exclude_unset=True)

    assert validated.filtering.conditions[0].field == "trace_id"
    assert validated.windowing.limit == 25
    assert validated.query_ref.slug == "recent-agent-runs"
