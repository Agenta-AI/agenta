from oss.src.core.tracing.dtos import AgAttributes
from oss.src.core.tracing.utils.attributes import (
    ensure_nested_dict,
    initialize_ag_attributes,
    marshall,
    parse_from_attributes,
    parse_into_attributes,
    unmarshall,
    unmarshall_attributes,
)


def test_ensure_nested_dict_creates_and_reuses_nested_paths():
    payload = {"ag": "not-a-dict"}

    nested = ensure_nested_dict(payload, "ag", "metrics", "duration")
    nested["incremental"] = {"total": 1}

    assert payload["ag"]["metrics"]["duration"]["incremental"]["total"] == 1


def test_initialize_ag_attributes_cleans_known_fields_and_tracks_unsupported():
    attributes = {
        "ag": {
            "type": {"trace": "invocation", "span": "task", "legacy": "x"},
            "data": {"extra": "ignored"},
            "metrics": {
                "duration": {
                    "incremental": {"total": 1},
                    "legacy": "x",
                },
                "legacy_metric": {"foo": "bar"},
            },
            "references": {
                "application": {
                    "id": "31d6cfe0-4b90-11ec-8001-42010a8000b0",
                    "slug": "ok_slug",
                    "version": "v1",
                },
                "query": {"slug": "bad slug"},
                "unsupported": {"id": "x"},
            },
            "meta": {"configuration": {"model": "gpt-4o"}},
            "session": {"id": "session-1", "legacy": True},
            "user": {"id": "user-1", "legacy": True},
            "flags": {"f": True},
            "tags": {"t": "v"},
            "refs": {"legacy": "ignored-key"},
            "random": "value",
        }
    }

    cleaned = initialize_ag_attributes(attributes)
    ag = cleaned["ag"]

    assert ag["type"] == {"trace": "invocation", "span": "task"}
    assert ag["data"]["parameters"] == {"model": "gpt-4o"}
    assert ag["references"]["application"]["slug"] == "ok_slug"
    assert ag["references"]["query"] == {}
    assert ag["session"] == {"id": "session-1"}
    assert ag["user"] == {"id": "user-1"}

    assert ag["unsupported"]["type"] == {"legacy": "x"}
    assert ag["unsupported"]["data"] == {"extra": "ignored"}
    assert ag["metrics"]["duration"]["incremental"] == 1
    assert ag["unsupported"]["metrics"]["duration"] == {"legacy": "x"}
    assert ag["unsupported"]["metrics"]["legacy_metric"] == {"foo": "bar"}
    assert ag["unsupported"]["random"] == "value"
    assert "refs" not in ag["unsupported"]


def test_ag_metrics_accept_scalar_duration_errors_and_vector_tokens_costs():
    attrs = AgAttributes.model_validate(
        {
            "metrics": {
                "duration": {"cumulative": 123.4},
                "errors": {"incremental": 1},
                "tokens": {"incremental": {"prompt": 2, "completion": 3, "total": 5}},
                "costs": {"cumulative": {"prompt": 0.1, "completion": 0.2}},
            }
        }
    )

    metrics = attrs.model_dump(mode="json", exclude_none=True)["metrics"]

    assert metrics["duration"]["cumulative"] == 123.4
    assert metrics["errors"]["incremental"] == 1
    assert metrics["tokens"]["incremental"]["total"] == 5
    assert metrics["costs"]["cumulative"]["prompt"] == 0.1


def test_initialize_ag_attributes_normalizes_legacy_dict_duration_errors_to_scalars():
    cleaned = initialize_ag_attributes(
        {
            "ag": {
                "metrics": {
                    "duration": {"cumulative": {"total": 123.4}},
                    "errors": {"incremental": {"total": 2}},
                }
            }
        }
    )

    metrics = cleaned["ag"]["metrics"]

    assert metrics["duration"]["cumulative"] == 123.4
    assert metrics["errors"]["incremental"] == 2
    assert "unsupported" not in cleaned["ag"]


def test_marshall_and_unmarshall_round_trip_nested_dict_and_lists():
    nested = {
        "ag": {
            "metrics": {
                "tokens": {"incremental": {"prompt": 3, "completion": 2, "total": 5}}
            },
            "items": [{"name": "a"}, {"name": "b"}],
        }
    }

    flat = marshall(nested)
    rebuilt = unmarshall(flat)

    assert rebuilt == nested


def test_unmarshall_attributes_expands_dot_notation_to_nested_structures():
    marshalled = {
        "ag.type.trace": "invocation",
        "ag.node.children.0.name": "child1",
        "ag.node.children.1.name": "child2",
    }

    unmarshalled = unmarshall_attributes(marshalled)

    assert unmarshalled["ag"]["type"]["trace"] == "invocation"
    assert unmarshalled["ag"]["node"]["children"][0]["name"] == "child1"
    assert unmarshalled["ag"]["node"]["children"][1]["name"] == "child2"


def test_parse_into_and_from_attributes_round_trip():
    attributes = parse_into_attributes(
        type={"trace": "invocation", "span": "task"},
        flags={"is_web": True},
        tags={"env": "dev"},
        meta={"origin": "api"},
        data={"inputs": {"q": "hello"}, "outputs": {"a": "world"}},
        references={"application": {"id": "31d6cfe0-4b90-11ec-8001-42010a8000b0"}},
    )

    parsed = parse_from_attributes(attributes)

    assert parsed[0] == {"trace": "invocation", "span": "task"}
    assert parsed[1] == {"is_web": True}
    assert parsed[2] == {"env": "dev"}
    assert parsed[3] == {"origin": "api"}
    assert parsed[4] == {"inputs": {"q": "hello"}, "outputs": {"a": "world"}}
    assert parsed[5] == {"application": {"id": "31d6cfe0-4b90-11ec-8001-42010a8000b0"}}
