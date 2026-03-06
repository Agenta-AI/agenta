from oss.src.core.tracing.dtos import OTelLink, OTelReference, OTelSpan
from oss.src.core.tracing.utils.hashing import (
    extract_references_and_links_from_span,
    make_hash_id,
)


TRACE_UUID = "31d6cfe0-4b90-11ec-8001-42010a8000b0"
SPAN_UUID = "31d6cfe0-4b90-11ec-31d6-cfe04b9011ec"
CHILD_UUID = "41d6cfe0-4b90-11ec-41d6-cfe04b9011ec"


def _make_span() -> OTelSpan:
    return OTelSpan(
        trace_id=TRACE_UUID,
        span_id=SPAN_UUID,
        span_name="root",
        references=[
            OTelReference(
                id=TRACE_UUID,
                slug="app",
                version="v1",
                attributes={"key": "application"},
            ),
            OTelReference(
                id=TRACE_UUID,
                attributes={"key": "not_supported"},
            ),
        ],
        links=[
            OTelLink(
                trace_id=TRACE_UUID,
                span_id=CHILD_UUID,
                attributes={"key": "parent"},
            ),
            OTelLink(
                trace_id=TRACE_UUID,
                span_id=CHILD_UUID,
                attributes={"missing": "key"},
            ),
        ],
        attributes={"ag": {}},
    )


def test_extract_references_and_links_from_span_filters_and_normalizes_ids():
    references, links = extract_references_and_links_from_span(_make_span())

    assert references == {
        "application": {
            "id": TRACE_UUID,
            "slug": "app",
            "version": "v1",
        }
    }
    assert links == {
        "parent": {
            "trace_id": "31d6cfe04b9011ec800142010a8000b0",
            "span_id": "41d6cfe04b9011ec",
        }
    }


def test_make_hash_id_returns_none_for_empty_payload():
    assert make_hash_id() is None
    assert make_hash_id(references={}, links={}) is None


def test_make_hash_id_is_deterministic_and_ignores_unknown_reference_keys():
    references_a = {
        "application": {"id": "a", "slug": "b", "version": "c"},
        "unknown": {"id": "x", "slug": "y", "version": "z"},
    }
    references_b = {
        "unknown": {"id": "x", "slug": "y", "version": "z"},
        "application": {"slug": "b", "id": "a", "version": "c"},
    }
    links = {"parent": {"trace_id": "t", "span_id": "s"}}

    hash_a = make_hash_id(references=references_a, links=links)
    hash_b = make_hash_id(references=references_b, links=links)

    assert hash_a == hash_b


def test_make_hash_id_changes_when_payload_changes():
    left = make_hash_id(
        references={"application": {"id": "a", "slug": "b", "version": "c"}},
        links={"parent": {"trace_id": "t1", "span_id": "s1"}},
    )
    right = make_hash_id(
        references={"application": {"id": "a", "slug": "b", "version": "c"}},
        links={"parent": {"trace_id": "t2", "span_id": "s1"}},
    )

    assert left != right
