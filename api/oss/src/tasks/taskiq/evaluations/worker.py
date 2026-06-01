from typing import Any, Awaitable, Callable, Optional
from uuid import UUID, uuid4
from datetime import datetime, timedelta, timezone
from asyncio import FIRST_COMPLETED, CancelledError, create_task, wait

from taskiq import AsyncBroker, Context, TaskiqDepends

from oss.src.core.tracing.service import TracingService
from oss.src.core.testsets.service import TestsetsService

from oss.src.core.applications.service import ApplicationsService
from oss.src.core.testcases.service import TestcasesService
from oss.src.core.queries.service import QueriesService
from oss.src.core.evaluators.service import SimpleEvaluatorsService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.evaluations.service import EvaluationsService

from oss.src.core.evaluations.tasks.run import (
    EvaluationSliceSource,
    process_evaluation_run,
    process_evaluation_slice,
)
from oss.src.core.evaluations.runtime.locks import (
    acquire_job_lock,
    release_job_lock,
    has_mutation_lock,
    run_job_heartbeat,
)
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class JobLockSkippedError(RuntimeError):
    def __init__(self, *, run_id: str, job_id: str, lock_id: str):
        self.run_id = run_id
        self.job_id = job_id
        self.lock_id = lock_id
        super().__init__(
            f"Job lock not acquired for run {run_id}, job {job_id}, lock {lock_id}."
        )


class EvaluationsWorker:
    """
    Worker class for evaluation tasks.

    This class registers evaluation tasks with the Taskiq broker,
    following the same dependency injection pattern as FastAPI routers.
    """

    def __init__(
        self,
        *,
        broker: AsyncBroker,
        #
        tracing_service: TracingService,
        simple_evaluators_service: SimpleEvaluatorsService,
        #
        testsets_service: TestsetsService,
        testcases_service: TestcasesService,
        queries_service: QueriesService,
        workflows_service: WorkflowsService,
        applications_service: ApplicationsService,
        evaluations_service: EvaluationsService,
    ):
        """
        Initialize the evaluations worker.

        Args:
            broker: The Taskiq broker to register tasks with
        """
        self.broker = broker
        #
        self.tracing_service = tracing_service
        self.testsets_service = testsets_service
        self.testcases_service = testcases_service
        self.queries_service = queries_service
        self.workflows_service = workflows_service
        self.applications_service = applications_service
        self.evaluations_service = evaluations_service
        #
        self.simple_evaluators_service = simple_evaluators_service

        self._register_tasks()

    # -----------------------------------------------------------------------
    # Lock / heartbeat helpers
    # -----------------------------------------------------------------------

    @staticmethod
    async def _with_job_lock(
        run_id: UUID,
        *,
        job_id: str,
        job_type: str,
        allow_concurrency: bool,
        runner: Callable[[], Awaitable[Any]],
    ) -> Any:
        """
        Acquire a job lock for `run_id`, start a heartbeat, run `runner`, then
        release the lock in a finally block.

        Non-queue loops share a reserved singleton lock slot so concurrent
        executions on the same run are skipped. Queue loops use their concrete
        Taskiq job id as the lock id and may execute concurrently.
        """
        run_id_str = str(run_id)
        lock_id = job_id if allow_concurrency else "singleton"

        if await has_mutation_lock(run_id=run_id_str):
            log.error(
                "[LOCK] Mutation lock detected before job start — task failed, re-dispatch required",
                run_id=run_id_str,
                job_id=job_id,
            )
            raise RuntimeError(
                f"Mutation lock present for run {run_id_str}: "
                "execution blocked. Re-dispatch the job once the mutation completes."
            )

        payload = await acquire_job_lock(
            run_id=run_id_str,
            job_id=job_id,
            lock_id=lock_id,
            job_type=job_type,  # type: ignore[arg-type]
        )
        if payload is None:
            log.warning(
                "[LOCK] Could not acquire job lock — skipping concurrent execution",
                run_id=run_id_str,
                job_id=job_id,
                lock_id=lock_id,
            )
            raise JobLockSkippedError(
                run_id=run_id_str,
                job_id=job_id,
                lock_id=lock_id,
            )

        heartbeat = create_task(
            run_job_heartbeat(
                run_id=run_id_str,
                job_id=job_id,
                lock_id=lock_id,
                job_token=payload.job_token,
            )
        )
        runner_task = create_task(runner())
        try:
            done, _ = await wait(
                {runner_task, heartbeat},
                return_when=FIRST_COMPLETED,
            )

            if runner_task in done:
                return await runner_task

            runner_task.cancel()
            try:
                await runner_task
            except CancelledError:
                pass
            except Exception as exc:
                log.warning(
                    "[LOCK] Runner raised while cancelling after heartbeat failure",
                    run_id=run_id_str,
                    job_id=job_id,
                    lock_id=lock_id,
                    error=str(exc),
                )

            await heartbeat
            raise RuntimeError(
                f"Heartbeat for run {run_id_str} and job {job_id} exited unexpectedly."
            )
        finally:
            for task, task_name in (
                (runner_task, "runner"),
                (heartbeat, "heartbeat"),
            ):
                if task and not task.done():
                    task.cancel()

                try:
                    await task
                except CancelledError:
                    pass
                except Exception as exc:
                    log.warning(
                        "[LOCK] Task teardown failed",
                        run_id=run_id_str,
                        job_id=job_id,
                        lock_id=lock_id,
                        task_name=task_name,
                        error=str(exc),
                    )

            released = await release_job_lock(
                run_id=run_id_str,
                job_id=job_id,
                lock_id=lock_id,
                job_token=payload.job_token,
            )
            if released:
                log.debug(
                    "[LOCK] Job lock released",
                    run_id=run_id_str,
                    job_id=job_id,
                    lock_id=lock_id,
                )
            else:
                log.warning(
                    "[LOCK] Job lock release skipped or lost ownership",
                    run_id=run_id_str,
                    job_id=job_id,
                    lock_id=lock_id,
                )

    def _register_tasks(self):
        """Register all evaluation tasks with the broker."""

        @self.broker.task(
            task_name="evaluations.run.process",
            retry_on_error=False,
            max_retries=0,  # Never retry - handle errors in application logic
        )
        async def process_run(
            *,
            project_id: UUID,
            user_id: UUID,
            #
            run_id: UUID,
            #
            newest: Optional[datetime] = None,
            oldest: Optional[datetime] = None,
            context: Context = TaskiqDepends(),
        ) -> Any:
            """Process one evaluation run using the unified topology dispatcher."""
            log.info("[TASK] Starting process_run")

            if newest is None:
                newest = datetime.now(timezone.utc)
            if oldest is None:
                oldest = newest - timedelta(minutes=1)

            result = await self._with_job_lock(
                run_id,
                job_id=context.message.task_id or str(uuid4()),
                job_type="api",
                allow_concurrency=False,
                runner=lambda: process_evaluation_run(
                    project_id=project_id,
                    user_id=user_id,
                    run_id=run_id,
                    newest=newest,
                    oldest=oldest,
                    tracing_service=self.tracing_service,
                    testsets_service=self.testsets_service,
                    queries_service=self.queries_service,
                    workflows_service=self.workflows_service,
                    applications_service=self.applications_service,
                    evaluations_service=self.evaluations_service,
                    simple_evaluators_service=self.simple_evaluators_service,
                ),
            )
            log.info("[TASK] Completed process_run")
            return result

        @self.broker.task(
            task_name="evaluations.slice.process",
            retry_on_error=False,
            max_retries=0,
        )
        async def process_slice(
            *,
            project_id: UUID,
            user_id: UUID,
            #
            run_id: UUID,
            source_kind: EvaluationSliceSource,
            trace_ids: Optional[list[str]] = None,
            testcase_ids: Optional[list[UUID]] = None,
            input_step_key: Optional[str] = None,
            context: Context = TaskiqDepends(),
        ) -> Any:
            log.info("[TASK] Starting process_slice", source_kind=source_kind)
            result = await self._with_job_lock(
                run_id,
                job_id=context.message.task_id or str(uuid4()),
                job_type="api",
                allow_concurrency=True,
                runner=lambda: process_evaluation_slice(
                    project_id=project_id,
                    user_id=user_id,
                    run_id=run_id,
                    source_kind=source_kind,
                    trace_ids=trace_ids,
                    testcase_ids=testcase_ids,
                    input_step_key=input_step_key,
                    tracing_service=self.tracing_service,
                    testcases_service=self.testcases_service,
                    workflows_service=self.workflows_service,
                    evaluations_service=self.evaluations_service,
                ),
            )
            log.info("[TASK] Completed process_slice", source_kind=source_kind)
            return result

        # Store task references for external access
        self.process_run = process_run
        self.process_slice = process_slice
