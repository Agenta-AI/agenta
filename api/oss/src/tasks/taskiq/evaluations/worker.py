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

from oss.src.core.evaluations.tasks.legacy import (
    evaluate_batch_testset as evaluate_batch_testset_impl,
    evaluate_batch_invocation as evaluate_batch_invocation_impl,
    evaluate_batch_testcases as evaluate_batch_testcases_impl,
    evaluate_batch_traces as evaluate_batch_traces_impl,
)
from oss.src.core.evaluations.tasks.live import (
    evaluate_live_query as evaluate_live_query_impl,
)
from oss.src.core.evaluations.runtime.locks import (
    acquire_job_lock,
    release_job_lock,
    has_mutation_lock,
    run_job_heartbeat,
)
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


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
            return None

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
            task_name="evaluations.legacy.annotate",
            retry_on_error=False,
            max_retries=0,  # Never retry - handle errors in application logic
        )
        async def evaluate_batch_testset(
            *,
            project_id: UUID,
            user_id: UUID,
            #
            run_id: UUID,
            context: Context = TaskiqDepends(),
        ) -> Any:
            """Legacy annotation task - wraps the existing annotate function."""
            log.info(
                "[TASK] Starting evaluate_batch_testset",
                project_id=str(project_id),
                user_id=str(user_id),
            )

            result = await self._with_job_lock(
                run_id,
                job_id=context.message.task_id or str(uuid4()),
                job_type="api",
                allow_concurrency=False,
                runner=lambda: evaluate_batch_testset_impl(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    run_id=run_id,
                    #
                    tracing_service=self.tracing_service,
                    testsets_service=self.testsets_service,
                    queries_service=self.queries_service,
                    workflows_service=self.workflows_service,
                    applications_service=self.applications_service,
                    evaluations_service=self.evaluations_service,
                    #
                    simple_evaluators_service=self.simple_evaluators_service,
                ),
            )
            log.info("[TASK] Completed evaluate_batch_testset")
            return result

        @self.broker.task(
            task_name="evaluations.live.evaluate",
            retry_on_error=False,
            max_retries=0,  # Never retry - handle errors in application logic
        )
        async def evaluate_live_query(
            project_id: UUID,
            user_id: UUID,
            #
            run_id: UUID,
            #
            newest: Optional[datetime] = None,
            oldest: Optional[datetime] = None,
            context: Context = TaskiqDepends(),
        ) -> Any:
            """Live evaluation task - evaluates traces against evaluators."""
            log.info("[TASK] Starting evaluate_live_query")

            if newest is None:
                newest = datetime.now(timezone.utc)
            if oldest is None:
                oldest = newest - timedelta(minutes=1)

            result = await self._with_job_lock(
                run_id,
                job_id=context.message.task_id or str(uuid4()),
                job_type="api",
                allow_concurrency=False,
                runner=lambda: evaluate_live_query_impl(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    run_id=run_id,
                    #
                    newest=newest,
                    oldest=oldest,
                ),
            )
            log.info("[TASK] Completed evaluate_live_query")
            return result

        @self.broker.task(
            task_name="evaluations.queries.batch",
            retry_on_error=False,
            max_retries=0,
        )
        async def evaluate_batch_query(
            *,
            project_id: UUID,
            user_id: UUID,
            #
            run_id: UUID,
            context: Context = TaskiqDepends(),
        ) -> Any:
            """One-shot query evaluation task for non-live runs."""
            log.info("[TASK] Starting evaluate_batch_query")

            result = await self._with_job_lock(
                run_id,
                job_id=context.message.task_id or str(uuid4()),
                job_type="api",
                allow_concurrency=False,
                runner=lambda: evaluate_live_query_impl(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    run_id=run_id,
                    #
                    newest=None,
                    oldest=None,
                    #
                    use_windowing=True,
                ),
            )
            log.info("[TASK] Completed evaluate_batch_query")
            return result

        @self.broker.task(
            task_name="evaluations.invocations.batch",
            retry_on_error=False,
            max_retries=0,
        )
        async def evaluate_batch_invocation(
            *,
            project_id: UUID,
            user_id: UUID,
            #
            run_id: UUID,
            context: Context = TaskiqDepends(),
        ) -> Any:
            log.info("[TASK] Starting evaluate_batch_invocation")
            result = await self._with_job_lock(
                run_id,
                job_id=context.message.task_id or str(uuid4()),
                job_type="api",
                allow_concurrency=False,
                runner=lambda: evaluate_batch_invocation_impl(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    run_id=run_id,
                    #
                    tracing_service=self.tracing_service,
                    testsets_service=self.testsets_service,
                    applications_service=self.applications_service,
                    evaluations_service=self.evaluations_service,
                ),
            )
            log.info("[TASK] Completed evaluate_batch_invocation")
            return result

        @self.broker.task(
            task_name="evaluations.traces.batch",
            retry_on_error=False,
            max_retries=0,
        )
        async def evaluate_batch_traces(
            *,
            project_id: UUID,
            user_id: UUID,
            #
            run_id: UUID,
            trace_ids: list[str],
            context: Context = TaskiqDepends(),
        ) -> Any:
            log.info("[TASK] Starting evaluate_batch_traces")
            result = await self._with_job_lock(
                run_id,
                job_id=context.message.task_id or str(uuid4()),
                job_type="api",
                allow_concurrency=True,
                runner=lambda: evaluate_batch_traces_impl(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    run_id=run_id,
                    trace_ids=trace_ids,
                    #
                    tracing_service=self.tracing_service,
                    workflows_service=self.workflows_service,
                    evaluations_service=self.evaluations_service,
                ),
            )
            log.info("[TASK] Completed evaluate_batch_traces")
            return result

        @self.broker.task(
            task_name="evaluations.testcases.batch",
            retry_on_error=False,
            max_retries=0,
        )
        async def evaluate_batch_testcases(
            *,
            project_id: UUID,
            user_id: UUID,
            #
            run_id: UUID,
            testcase_ids: list[UUID],
            context: Context = TaskiqDepends(),
        ) -> Any:
            log.info("[TASK] Starting evaluate_batch_testcases")
            result = await self._with_job_lock(
                run_id,
                job_id=context.message.task_id or str(uuid4()),
                job_type="api",
                allow_concurrency=True,
                runner=lambda: evaluate_batch_testcases_impl(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    run_id=run_id,
                    testcase_ids=testcase_ids,
                    #
                    tracing_service=self.tracing_service,
                    testcases_service=self.testcases_service,
                    workflows_service=self.workflows_service,
                    evaluations_service=self.evaluations_service,
                ),
            )
            log.info("[TASK] Completed evaluate_batch_testcases")
            return result

        # Store task references for external access
        self.evaluate_batch_testset = evaluate_batch_testset
        self.evaluate_live_query = evaluate_live_query
        self.evaluate_batch_query = evaluate_batch_query
        self.evaluate_batch_invocation = evaluate_batch_invocation
        self.evaluate_batch_traces = evaluate_batch_traces
        self.evaluate_batch_testcases = evaluate_batch_testcases
