import sys

from taskiq import TaskiqEvents
from taskiq.cli.worker.run import run_worker
from taskiq.cli.worker.args import WorkerArgs
from taskiq_redis import RedisStreamBroker

from oss.src.utils.logging import get_module_logger
from oss.src.utils.helpers import warn_deprecated_env_vars, validate_required_env_vars
from oss.src.utils.env import env
from oss.src.tasks.taskiq.evaluations.worker import EvaluationsWorker

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
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.evaluators.service import EvaluatorsService, SimpleEvaluatorsService
from oss.src.core.evaluations.service import EvaluationsService
from oss.src.apis.fastapi.tracing.router import TracingRouter
from oss.src.apis.fastapi.testsets.router import SimpleTestsetsRouter
from oss.src.apis.fastapi.evaluators.router import SimpleEvaluatorsRouter

import agenta as ag

log = get_module_logger(__name__)

# Initialize Agenta SDK
ag.init(
    api_url=env.AGENTA_API_URL,
)

# BROKER -------------------------------------------------------------------
# Create broker with durable Redis Streams for task queues
# Valkey 7+ compatible
broker = RedisStreamBroker(
    url=env.REDIS_QUEUE_URL,
    queue_name="queues:taskiq:evaluations",
    consumer_group_name="taskiq-workers",
)


@broker.on_event(TaskiqEvents.WORKER_STARTUP)
async def on_startup(state: dict) -> None:
    """Initialize worker on startup."""
    log.info("[TASKIQ] Worker starting up")


@broker.on_event(TaskiqEvents.WORKER_SHUTDOWN)
async def on_shutdown(state: dict) -> None:
    """Cleanup on worker shutdown."""
    log.info("[TASKIQ] Worker shutting down")


# WORKERS ------------------------------------------------------------------
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

tracing_router = TracingRouter(
    tracing_service=tracing_service,
)

simple_testsets_router = SimpleTestsetsRouter(
    simple_testsets_service=simple_testsets_service,
)

simple_evaluators_router = SimpleEvaluatorsRouter(
    simple_evaluators_service=simple_evaluators_service,
)

evaluations_worker = EvaluationsWorker(
    broker=broker,
    evaluations_service=evaluations_service,
    queries_service=queries_service,
    workflows_service=workflows_service,
    simple_testsets_router=simple_testsets_router,
    simple_evaluators_router=simple_evaluators_router,
    tracing_router=tracing_router,
)


def main() -> int:
    """
    Main entry point for the worker.

    Returns:
        Exit code (0 for success, non-zero for failure)
    """
    try:
        log.info("[WORKER] Initializing Taskiq worker")

        # Validate environment
        warn_deprecated_env_vars()
        validate_required_env_vars()

        log.info("[WORKER] Starting Taskiq worker with Redis Streams")

        # Run Taskiq worker
        # Broker and workers are instantiated above (like routes.py does for FastAPI)
        args = WorkerArgs(
            broker="queues:broker",  # Reference broker from this module
            modules=[],  # Workers already registered, no auto-discovery needed
            fs_discover=False,
            workers=1,  # Number of worker processes
            max_async_tasks=10,  # Max concurrent async tasks per worker
        )

        result = run_worker(args)
        return result if result is not None else 0

    except KeyboardInterrupt:
        log.info("[WORKER] Shutdown requested")
        return 0
    except Exception as e:
        log.error("[WORKER] Fatal error", error=str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
