"""Shared construction for the evaluations Redis Stream broker + worker.

Used by both the producer side (entrypoints/routers.py, enqueuing via
`.kiq()`) and the consumer side (entrypoints/worker_queues.py), so the
custom no-redelivery broker and task registration aren't duplicated.
"""

from taskiq import AsyncBroker

from oss.src.tasks.taskiq.shared.broker import TrimOnAckRedisStreamBroker
from oss.src.core.evaluations.runtime.runner import TaskiqEvaluationTaskRunner
from oss.src.core.evaluations.service import EvaluationsService
from oss.src.core.evaluators.service import SimpleEvaluatorsService
from oss.src.core.queries.service import QueriesService
from oss.src.core.testcases.service import TestcasesService
from oss.src.core.testsets.service import TestsetsService
from oss.src.core.tracing.service import TracingService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.tasks.taskiq.evaluations.worker import EvaluationsWorker
from oss.src.utils.env import env

MAXLEN_QUEUES_EVALUATIONS = 100_000


class NoRedeliveryRedisStreamBroker(TrimOnAckRedisStreamBroker):
    """Stream broker that never redelivers. `listen()` reads only NEW messages
    (`>`) and skips the XAUTOCLAIM pending-replay block, so a task that crashed
    mid-run is not re-served to later workers. Evaluation tasks are not safely
    re-runnable (`retry_on_error=False`); a stuck unacked entry replaying on every
    worker restart is worse than dropping it. Inherits XDEL-on-ack so completed
    entries leave the stream (XLEN = backlog).
    """

    async def listen(self):
        from taskiq import AckableMessage
        from redis.asyncio import Redis

        async with Redis(connection_pool=self.connection_pool) as redis_conn:
            while True:
                fetched = await redis_conn.xreadgroup(
                    self.consumer_group_name,
                    self.consumer_name,
                    {
                        self.queue_name: ">",
                        **self.additional_streams,
                    },
                    block=self.block,
                    noack=False,
                    count=self.count,
                )
                for stream, msg_list in fetched:
                    for msg_id, msg in msg_list:
                        yield AckableMessage(
                            data=msg[b"data"],
                            ack=self._ack_generator(id=msg_id, queue_name=stream),
                        )


def build_evaluations_broker(*, consumer_group_name: str) -> AsyncBroker:
    """Construct the durable evaluations broker (shared queue name/maxlen)."""
    return NoRedeliveryRedisStreamBroker(
        url=env.redis.uri_durable,
        queue_name="queues:evaluations",
        consumer_group_name=consumer_group_name,
        maxlen=MAXLEN_QUEUES_EVALUATIONS,
        approximate=True,
        # socket_timeout must be >= xread_block / 1000 to avoid connection errors.
        socket_timeout=30,
        socket_connect_timeout=30,
    )


def build_evaluations_worker(
    *,
    broker: AsyncBroker,
    tracing_service: TracingService,
    simple_evaluators_service: SimpleEvaluatorsService,
    testsets_service: TestsetsService,
    testcases_service: TestcasesService,
    queries_service: QueriesService,
    workflows_service: WorkflowsService,
    evaluations_service: EvaluationsService,
) -> EvaluationsWorker:
    """Construct the worker and wire it back into evaluations_service (circular dep)."""
    evaluations_worker = EvaluationsWorker(
        broker=broker,
        tracing_service=tracing_service,
        simple_evaluators_service=simple_evaluators_service,
        testsets_service=testsets_service,
        testcases_service=testcases_service,
        queries_service=queries_service,
        workflows_service=workflows_service,
        evaluations_service=evaluations_service,
    )
    evaluations_service.evaluations_worker = evaluations_worker
    evaluations_service.evaluations_task_runner = TaskiqEvaluationTaskRunner(
        worker=evaluations_worker
    )
    return evaluations_worker
