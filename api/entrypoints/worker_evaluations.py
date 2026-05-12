import sys
import asyncio
from uuid import uuid4

from taskiq import TaskiqEvents
from taskiq.cli.worker.run import run_worker
from taskiq.cli.worker.args import WorkerArgs
from taskiq_redis import RedisStreamBroker

from oss.src.utils.logging import get_module_logger
from oss.src.utils.helpers import warn_deprecated_env_vars, validate_required_env_vars
from oss.src.utils.env import env
from oss.src.tasks.taskiq.evaluations.worker import EvaluationsWorker
from oss.src.core.evaluations.runtime.locks import run_worker_heartbeat

from oss.src.dbs.postgres.queries.dbes import (
    QueryArtifactDBE,
    QueryVariantDBE,
    QueryRevisionDBE,
)
from oss.src.dbs.postgres.testcases.dbes import TestcaseBlobDBE
from oss.src.dbs.postgres.testsets.dbes import (
    TestsetArtifactDBE,
    TestsetVariantDBE,
    TestsetRevisionDBE,
)
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowVariantDBE,
    WorkflowRevisionDBE,
)
from oss.src.dbs.postgres.tracing.dao import TracingDAO
from oss.src.dbs.postgres.blobs.dao import BlobsDAO
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.dbs.postgres.evaluations.dao import EvaluationsDAO
from oss.src.core.tracing.service import TracingService
from oss.src.core.queries.service import QueriesService
from oss.src.core.testcases.service import TestcasesService
from oss.src.core.testsets.service import TestsetsService, SimpleTestsetsService
from oss.src.core.applications.service import ApplicationsService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.evaluators.service import EvaluatorsService, SimpleEvaluatorsService
from oss.src.core.evaluations.service import EvaluationsService

import agenta as ag

log = get_module_logger(__name__)

# Initialize Agenta SDK for workflow invocation in evaluation tasks
# Idempotent - safe to call multiple times
ag.init(
    api_url=env.agenta.api_url,
)

# BROKER -------------------------------------------------------------------
# Create broker with durable Redis Streams for task queues
broker = RedisStreamBroker(
    url=env.redis.uri_durable,
    queue_name="queues:evaluations",
    consumer_group_name="worker-evaluations",
    # Disable automatic redelivery for long-running evaluation tasks
    # Evaluations can run for hours, so we set idle_timeout to effectively infinity
    # to prevent XAUTOCLAIM from redelivering tasks that are still processing.
    # Default is 600,000ms (10 min) which causes duplicate processing every 10 minutes.
    idle_timeout=1209600000,  # 14 days in milliseconds - effectively disabled for long evaluations
    # Ensure socket doesn't timeout during blocking reads (xread_block defaults to 2000ms)
    # socket_timeout must be >= xread_block / 1000 to avoid connection errors
    socket_timeout=30,  # seconds - safely covers the 2000ms block time
    socket_connect_timeout=30,  # seconds
)


# EVALS -------------------------------------------------------------------
# Instantiate workers (analogous to router instantiation in routers.py)

tracing_dao = TracingDAO()

testcases_dao = BlobsDAO(
    BlobDBE=TestcaseBlobDBE,
)

queries_dao = GitDAO(
    ArtifactDBE=QueryArtifactDBE,
    VariantDBE=QueryVariantDBE,
    RevisionDBE=QueryRevisionDBE,
)

testsets_dao = GitDAO(
    ArtifactDBE=TestsetArtifactDBE,
    VariantDBE=TestsetVariantDBE,
    RevisionDBE=TestsetRevisionDBE,
)

workflows_dao = GitDAO(
    ArtifactDBE=WorkflowArtifactDBE,
    VariantDBE=WorkflowVariantDBE,
    RevisionDBE=WorkflowRevisionDBE,
)

evaluations_dao = EvaluationsDAO()

tracing_service = TracingService(
    tracing_dao=tracing_dao,
)

queries_service = QueriesService(
    queries_dao=queries_dao,
)

testcases_service = TestcasesService(
    testcases_dao=testcases_dao,
)

testsets_service = TestsetsService(
    testsets_dao=testsets_dao,
    testcases_service=testcases_service,
)

simple_testsets_service = SimpleTestsetsService(
    testsets_service=testsets_service,
)

workflows_service = WorkflowsService(
    workflows_dao=workflows_dao,
)

applications_service = ApplicationsService(
    workflows_service=workflows_service,
)

evaluators_service = EvaluatorsService(
    workflows_service=workflows_service,
)

simple_evaluators_service = SimpleEvaluatorsService(
    evaluators_service=evaluators_service,
)

evaluations_service = EvaluationsService(
    evaluations_dao=evaluations_dao,
    tracing_service=tracing_service,
    queries_service=queries_service,
    testsets_service=testsets_service,
    evaluators_service=evaluators_service,
    #
)

evaluations_worker = EvaluationsWorker(
    broker=broker,
    #
    tracing_service=tracing_service,
    simple_evaluators_service=simple_evaluators_service,
    #
    testsets_service=testsets_service,
    testcases_service=testcases_service,
    queries_service=queries_service,
    workflows_service=workflows_service,
    applications_service=applications_service,
    evaluations_service=evaluations_service,
)

# Wire evaluations_worker into evaluations_service (circular dependency)
evaluations_service.evaluations_worker = evaluations_worker

# Worker identity (stable for the lifetime of this process)
_WORKER_ID = str(uuid4())
_worker_heartbeat_task: asyncio.Task = None  # type: ignore[assignment]


@broker.on_event(TaskiqEvents.WORKER_STARTUP)
async def _start_worker_heartbeat(state) -> None:
    global _worker_heartbeat_task
    _worker_heartbeat_task = asyncio.create_task(
        run_worker_heartbeat(worker_id=_WORKER_ID)
    )
    log.info("[EVAL] Worker heartbeat started", worker_id=_WORKER_ID)


@broker.on_event(TaskiqEvents.WORKER_SHUTDOWN)
async def _stop_worker_heartbeat(state) -> None:
    global _worker_heartbeat_task
    if _worker_heartbeat_task and not _worker_heartbeat_task.done():
        _worker_heartbeat_task.cancel()
        try:
            await _worker_heartbeat_task
        except asyncio.CancelledError:
            pass
    log.info("[EVAL] Worker heartbeat stopped", worker_id=_WORKER_ID)


def main() -> int:
    """
    Main entry point for the worker.

    Returns:
        Exit code (0 for success, non-zero for failure)
    """
    try:
        log.info("[EVAL] Initializing Taskiq worker")

        # Validate environment
        warn_deprecated_env_vars()
        validate_required_env_vars()

        log.info("[EVAL] Starting Taskiq worker with Redis Streams")

        # Run Taskiq worker
        # Broker and workers are instantiated above (like routes.py does for FastAPI)
        args = WorkerArgs(
            broker="entrypoints.worker_evaluations:broker",  # Reference broker from this module
            modules=[],  # Workers already registered, no auto-discovery needed
            fs_discover=False,
            workers=1,  # Number of worker processes
            max_async_tasks=10,  # Max concurrent async tasks per worker
        )

        result = run_worker(args)
        return result if result is not None else 0

    except KeyboardInterrupt:
        log.info("[EVAL] Shutdown requested")
        return 0
    except Exception as e:
        log.error("[EVAL] Fatal error", error=str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
