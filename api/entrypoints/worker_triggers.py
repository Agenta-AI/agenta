import sys

from taskiq.cli.worker.run import run_worker
from taskiq.cli.worker.args import WorkerArgs
from taskiq_redis import RedisStreamBroker

from oss.src.utils.logging import get_module_logger
from oss.src.utils.helpers import warn_deprecated_env_vars, validate_required_env_vars
from oss.src.utils.env import env

from oss.src.utils.common import is_ee
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.dbs.postgres.triggers.dao import TriggersDAO
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowVariantDBE,
    WorkflowRevisionDBE,
)
from oss.src.dbs.postgres.environments.dbes import (
    EnvironmentArtifactDBE,
    EnvironmentVariantDBE,
    EnvironmentRevisionDBE,
)
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.environments.service import EnvironmentsService
from oss.src.core.embeds.service import EmbedsService
from oss.src.tasks.asyncio.triggers.dispatcher import TriggersDispatcher
from oss.src.tasks.taskiq.triggers.worker import TriggersWorker

# Guard EE imports — see worker_tracing.py for the rationale.
if is_ee():
    from ee.src.core.access.entitlements.service import bootstrap_entitlements_services


import agenta as ag

log = get_module_logger(__name__)

# Initialize Agenta SDK
ag.init(
    api_url=env.agenta.api_url,
)

# Bound the stream so acked entries are trimmed; without this it grows unbounded.
MAXLEN_QUEUES_TRIGGERS = 100_000

# BROKER -------------------------------------------------------------------
broker = RedisStreamBroker(
    url=env.redis.uri_durable,
    queue_name="queues:triggers",
    consumer_group_name="worker-triggers",
    maxlen=MAXLEN_QUEUES_TRIGGERS,
    approximate=True,
)


# WORKERS ------------------------------------------------------------------
triggers_dao = TriggersDAO()

workflows_dao = GitDAO(
    ArtifactDBE=WorkflowArtifactDBE,
    VariantDBE=WorkflowVariantDBE,
    RevisionDBE=WorkflowRevisionDBE,
)

environments_dao = GitDAO(
    ArtifactDBE=EnvironmentArtifactDBE,
    VariantDBE=EnvironmentVariantDBE,
    RevisionDBE=EnvironmentRevisionDBE,
)

workflows_service = WorkflowsService(
    workflows_dao=workflows_dao,
)

environments_service = EnvironmentsService(
    environments_dao=environments_dao,
)

embeds_service = EmbedsService(
    workflows_service=workflows_service,
    environments_service=environments_service,
)

workflows_service.environments_service = environments_service
workflows_service.embeds_service = embeds_service
environments_service.embeds_service = embeds_service

triggers_dispatcher = TriggersDispatcher(
    triggers_dao=triggers_dao,
    workflows_service=workflows_service,
)

triggers_worker = TriggersWorker(
    broker=broker,
    dispatcher=triggers_dispatcher,
)


def main() -> int:
    """
    Main entry point for the worker.

    Returns:
        Exit code (0 for success, non-zero for failure)
    """
    try:
        log.info("[TRIGGERS] Initializing Taskiq worker")

        # Validate environment
        warn_deprecated_env_vars()
        validate_required_env_vars()

        # Wire EE entitlement services so `check_entitlements` works in
        # this worker process. Gated on `is_ee()` to match the import above.
        if is_ee():
            bootstrap_entitlements_services()

        log.info("[TRIGGERS] Starting Taskiq worker with Redis Streams")

        # Run Taskiq worker
        args = WorkerArgs(
            broker="entrypoints.worker_triggers:broker",  # Reference broker from this module
            modules=[],
            fs_discover=False,
            workers=1,
            max_async_tasks=50,
        )

        result = run_worker(args)
        return result if result is not None else 0

    except KeyboardInterrupt:
        log.info("[TRIGGERS] Shutdown requested")
        return 0
    except Exception as e:
        log.error("[TRIGGERS] Fatal error", error=str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
