"""The trace flush deletes old traces but keeps annotation records (`ag.annotation`)."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from oss.src.dbs.postgres.shared.engine import get_analytics_engine
from oss.src.dbs.postgres.tracing.dbes import SpanDBE

from ee.src.dbs.postgres.tracing.dao import TracingRetentionDAO


pytestmark = pytest.mark.integration

OLD = datetime.now(timezone.utc) - timedelta(days=400)


def _root(project_id, attributes, *, parent_id=None, trace_id=None):
    return SpanDBE(
        project_id=project_id,
        trace_id=trace_id or uuid.uuid4(),
        span_id=uuid.uuid4(),
        parent_id=parent_id,
        span_kind="SPAN_KIND_INTERNAL",
        span_name="span",
        start_time=OLD,
        end_time=OLD,
        status_code="STATUS_CODE_UNSET",
        attributes=attributes,
        created_at=OLD,
    )


async def test_flush_keeps_annotation_records_and_deletes_the_rest():
    project_id = uuid.uuid4()
    run = _root(project_id, {"ag": {"type": {"trace": "invocation"}}})
    run_child = _root(
        project_id, {"ag": {}}, parent_id=run.span_id, trace_id=run.trace_id
    )
    evaluator_trace = _root(project_id, {"ag": {"type": {"trace": "annotation"}}})
    old_annotation = _root(
        project_id, {"ag": {"type": {"trace": "annotation"}, "data": {"outputs": 1}}}
    )
    no_attributes = _root(project_id, None)
    record = _root(
        project_id,
        {
            "ag": {
                "type": {"trace": "annotation"},
                "annotation": {"author": {"type": "person", "user_id": "u-3"}},
            }
        },
    )
    spans = [run, run_child, evaluator_trace, old_annotation, no_attributes, record]

    engine = get_analytics_engine()
    async with engine.session() as session:
        session.add_all(spans)
        await session.commit()

    try:
        traces, deleted = await TracingRetentionDAO(
            analytics_engine=engine
        ).delete_traces_before_cutoff(
            cutoff=datetime.now(timezone.utc) - timedelta(days=30),
            project_ids=[project_id],
            max_traces=100,
        )

        async with engine.session() as session:
            left = (
                (
                    await session.execute(
                        select(SpanDBE.trace_id).where(SpanDBE.project_id == project_id)
                    )
                )
                .scalars()
                .all()
            )

        assert (traces, deleted) == (4, 5)
        assert left == [record.trace_id]
    finally:
        async with engine.session() as session:
            for span in (
                await session.execute(
                    select(SpanDBE).where(SpanDBE.project_id == project_id)
                )
            ).scalars():
                await session.delete(span)
            await session.commit()
