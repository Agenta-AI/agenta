"""
worker_queues - list-parameterized entrypoint hosting the TaskIQ queue
consumers (webhooks, triggers, interactions, evaluations) in one process.

Reads AGENTA_WORKER_QUEUES (subset of {webhooks, triggers, interactions,
evaluations}); empty or unset selects all four. Each selected broker keeps its
own queue_name/consumer_group_name/maxlen/retry config unchanged.

Why this bypasses taskiq.cli.worker.run.run_worker: run_worker's
ProcessManager forks a new OS process per broker (spawn on darwin) and
start_listen() creates its own event loop + installs its own SIGINT/SIGTERM
handlers — it is not awaitable and cannot be asyncio.gather'd alongside
siblings in this process. The actual per-broker unit of async work is
taskiq.receiver.Receiver.listen(finish_event), a plain coroutine; start_listen
awaits exactly that after all the process/signal/executor setup. This
entrypoint does that setup itself (once, for the whole process) and drives one
Receiver per selected broker as a sibling asyncio task. See
docs/designs/workers-sprawl/specs.md for the full writeup.

Replaces the removed single-broker queue entrypoints; this is now the sole
queue-consumer entrypoint.
"""

import sys
import signal
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import List
from uuid import uuid4

from taskiq import AsyncBroker, TaskiqEvents
from taskiq.receiver import Receiver
from taskiq.cli.worker.run import shutdown_broker

from oss.src.tasks.taskiq.shared.broker import (
    TrimOnAckRedisStreamBroker,
    prune_idle_consumers,
    stable_consumer_name,
)

from oss.src.core.embeds.service import EmbedsService
from oss.src.core.environments.service import EnvironmentsService
from oss.src.core.evaluations.runtime.broker import (
    build_evaluations_broker,
    build_evaluations_worker,
)
from oss.src.core.evaluations.runtime.locks import run_worker_heartbeat
from oss.src.core.evaluations.service import EvaluationsService
from oss.src.core.evaluators.service import EvaluatorsService, SimpleEvaluatorsService
from oss.src.core.queries.service import QueriesService
from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.core.testcases.service import TestcasesService
from oss.src.core.testsets.service import SimpleTestsetsService, TestsetsService
from oss.src.core.tracing.service import TracingService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.dbs.postgres.blobs.dao import BlobsDAO
from oss.src.dbs.postgres.environments.dbes import (
    EnvironmentArtifactDBE,
    EnvironmentRevisionDBE,
    EnvironmentVariantDBE,
)
from oss.src.dbs.postgres.evaluations.dao import EvaluationsDAO
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.dbs.postgres.queries.dbes import (
    QueryArtifactDBE,
    QueryRevisionDBE,
    QueryVariantDBE,
)
from oss.src.dbs.postgres.sessions.interactions.dao import SessionInteractionsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.testcases.dbes import TestcaseBlobDBE
from oss.src.dbs.postgres.testsets.dbes import (
    TestsetArtifactDBE,
    TestsetRevisionDBE,
    TestsetVariantDBE,
)
from oss.src.dbs.postgres.triggers.dao import TriggersDAO
from oss.src.dbs.postgres.tracing.dao import TracingDAO
from oss.src.dbs.postgres.webhooks.dao import WebhooksDAO
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowRevisionDBE,
    WorkflowVariantDBE,
)
from oss.src.tasks.asyncio.sessions.interactions_dispatcher import (
    InteractionsDispatcher,
)
from oss.src.tasks.asyncio.triggers.dispatcher import TriggersDispatcher
from oss.src.tasks.taskiq.sessions.interactions_worker import InteractionsWorker
from oss.src.tasks.taskiq.triggers.worker import TriggersWorker
from oss.src.tasks.taskiq.webhooks.worker import WebhooksWorker
from oss.src.utils.common import is_ee
from oss.src.utils.env import env
from oss.src.utils.helpers import validate_required_env_vars, warn_deprecated_env_vars
from oss.src.utils.logging import get_module_logger

# Guard EE imports so an OSS build needn't import the ee.* package.
if is_ee():
    from ee.src.core.access.entitlements.service import bootstrap_entitlements_services

import agenta as ag

log = get_module_logger(__name__)

ag.init(api_url=env.agenta.api_url)

ALL_QUEUES = ("webhooks", "triggers", "interactions", "evaluations")

MAXLEN_QUEUES_WEBHOOKS = 100_000
MAXLEN_QUEUES_TRIGGERS = 100_000
MAXLEN_QUEUES_INTERACTIONS = 100_000

_WORKER_ID = str(uuid4())
_worker_heartbeat_task: "asyncio.Task | None" = None


def _selected_queues() -> List[str]:
    selected = env.agenta.workers.queues
    if not selected:
        return list(ALL_QUEUES)
    unknown = set(selected) - set(ALL_QUEUES)
    if unknown:
        raise ValueError(
            f"AGENTA_WORKER_QUEUES has unknown entries: {sorted(unknown)}; "
            f"expected a subset of {ALL_QUEUES}"
        )
    return selected


def _build_webhooks_broker() -> tuple[AsyncBroker, int]:
    broker = TrimOnAckRedisStreamBroker(
        url=env.redis.uri_durable,
        queue_name="queues:webhooks",
        consumer_group_name="worker-webhooks",
        consumer_name=stable_consumer_name("worker-webhooks"),
        maxlen=MAXLEN_QUEUES_WEBHOOKS,
        approximate=True,
    )
    WebhooksWorker(broker=broker, webhooks_dao=WebhooksDAO())
    return broker, 50  # max_async_tasks


def _build_triggers_broker() -> tuple[AsyncBroker, int]:
    broker = TrimOnAckRedisStreamBroker(
        url=env.redis.uri_durable,
        queue_name="queues:triggers",
        consumer_group_name="worker-triggers",
        consumer_name=stable_consumer_name("worker-triggers"),
        maxlen=MAXLEN_QUEUES_TRIGGERS,
        approximate=True,
    )

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
    workflows_service = WorkflowsService(workflows_dao=workflows_dao)
    environments_service = EnvironmentsService(environments_dao=environments_dao)
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
    TriggersWorker(
        broker=broker, dispatcher=triggers_dispatcher, triggers_dao=triggers_dao
    )
    return broker, 50  # max_async_tasks


def _build_interactions_broker() -> tuple[AsyncBroker, int]:
    broker = TrimOnAckRedisStreamBroker(
        url=env.redis.uri_durable,
        queue_name="queues:interactions",
        consumer_group_name="worker-interactions",
        consumer_name=stable_consumer_name("worker-interactions"),
        maxlen=MAXLEN_QUEUES_INTERACTIONS,
        approximate=True,
    )

    transactions_engine = get_transactions_engine()
    interactions_dao = SessionInteractionsDAO(engine=transactions_engine)
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
    workflows_service = WorkflowsService(workflows_dao=workflows_dao)
    environments_service = EnvironmentsService(environments_dao=environments_dao)
    embeds_service = EmbedsService(
        workflows_service=workflows_service,
        environments_service=environments_service,
    )
    workflows_service.environments_service = environments_service
    workflows_service.embeds_service = embeds_service
    environments_service.embeds_service = embeds_service

    interactions_service = SessionInteractionsService(interactions_dao=interactions_dao)

    async def _dispatch_detached_run(*, project_id, user_id, request) -> str:
        result = await workflows_service.invoke_workflow_detached(
            project_id=project_id,
            user_id=user_id,
            request=request,
        )
        return result.run_id

    interactions_dispatcher = InteractionsDispatcher(
        workflows_service=workflows_service,
        interactions_service=interactions_service,
        dispatch_fn=_dispatch_detached_run,
    )
    InteractionsWorker(broker=broker, dispatcher=interactions_dispatcher)
    return broker, 50  # max_async_tasks


def _build_evaluations_broker() -> tuple[AsyncBroker, int]:
    broker = build_evaluations_broker(consumer_group_name="worker-evaluations")

    tracing_dao = TracingDAO()
    testcases_dao = BlobsDAO(BlobDBE=TestcaseBlobDBE)
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

    tracing_service = TracingService(tracing_dao=tracing_dao)
    queries_service = QueriesService(queries_dao=queries_dao)
    testcases_service = TestcasesService(testcases_dao=testcases_dao)
    testsets_service = TestsetsService(
        testsets_dao=testsets_dao, testcases_service=testcases_service
    )
    SimpleTestsetsService(testsets_service=testsets_service)
    workflows_service = WorkflowsService(workflows_dao=workflows_dao)
    evaluators_service = EvaluatorsService(workflows_service=workflows_service)
    simple_evaluators_service = SimpleEvaluatorsService(
        evaluators_service=evaluators_service
    )
    evaluations_service = EvaluationsService(
        evaluations_dao=evaluations_dao,
        tracing_service=tracing_service,
        queries_service=queries_service,
        testsets_service=testsets_service,
        evaluators_service=evaluators_service,
    )

    build_evaluations_worker(
        broker=broker,
        tracing_service=tracing_service,
        simple_evaluators_service=simple_evaluators_service,
        testsets_service=testsets_service,
        testcases_service=testcases_service,
        queries_service=queries_service,
        workflows_service=workflows_service,
        evaluations_service=evaluations_service,
    )

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

    return broker, 10  # max_async_tasks


_BUILDERS = {
    "webhooks": _build_webhooks_broker,
    "triggers": _build_triggers_broker,
    "interactions": _build_interactions_broker,
    "evaluations": _build_evaluations_broker,
}


async def _run_receiver(
    name: str, broker: AsyncBroker, max_async_tasks: int, shutdown: asyncio.Event
):
    # Mirrors start_listen()'s setup for a single broker, minus the
    # process-forking/signal-handling parts (done once for the whole
    # process by main_async, not per-broker).
    broker.is_worker_process = True

    removed = await prune_idle_consumers(
        url=env.redis.uri_durable,
        queue_name=broker.queue_name,
        consumer_group_name=broker.consumer_group_name,
        keep=broker.consumer_name,
    )
    if removed:
        log.info(f"[QUEUES] Pruned {removed} idle consumers on queue={name}")

    executor = ThreadPoolExecutor()
    try:
        receiver = Receiver(
            broker=broker,
            executor=executor,
            max_async_tasks=max_async_tasks,
        )
        log.info(f"[QUEUES] Listening on queue={name}")
        await receiver.listen(shutdown)
    finally:
        await shutdown_broker(broker, timeout=5)
        executor.shutdown(wait=False)


async def main_async() -> int:
    try:
        queues = _selected_queues()
        log.info("[QUEUES] Initializing worker-queues", selected=queues)

        warn_deprecated_env_vars()
        validate_required_env_vars()

        if is_ee():
            bootstrap_entitlements_services()

        shutdown_event = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, shutdown_event.set)

        tasks = []
        for name in queues:
            broker, max_async_tasks = _BUILDERS[name]()
            tasks.append(_run_receiver(name, broker, max_async_tasks, shutdown_event))

        log.info("[QUEUES] Starting worker-queues", selected=queues)
        await asyncio.gather(*tasks)

        return 0

    except Exception:
        log.error("[QUEUES] Fatal error", exc_info=True)
        return 1


def main() -> int:
    try:
        return asyncio.run(main_async())
    except KeyboardInterrupt:
        log.info("[QUEUES] Shutdown requested")
        return 0
    except Exception:
        log.error("[QUEUES] Fatal error", exc_info=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
