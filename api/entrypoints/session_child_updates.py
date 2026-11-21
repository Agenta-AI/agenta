"""The producer of child updates, built for the worker-streams composition root, which
has no API router wiring of its own.

It needs the session queue the API composition has (`enqueue_session_input`), so it
builds a `WorkflowsService`, the run admission, the commands service for the
recoverable-continuation check and the Stop-versus-Steer read, and the mounts service for
the result file.
"""

from typing import Optional, Tuple
from uuid import UUID

from oss.src.core.access.service import get_access_service
from oss.src.core.embeds.service import EmbedsService
from oss.src.core.environments.service import EnvironmentsService
from oss.src.core.mounts.service import MountsService
from oss.src.core.sessions.child_updates.dtos import ChildTurnAgent
from oss.src.core.sessions.child_updates.service import SessionChildUpdatesService
from oss.src.core.sessions.commands.delivery import (
    deliver_continue_input,
    deliver_continue_interaction,
)
from oss.src.core.sessions.commands.service import SessionCommandsService
from oss.src.core.sessions.context import make_session_context_resolver
from oss.src.core.sessions.inputs.service import SessionInputsService
from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.starts.service import SessionStartsService
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.turns.service import SessionTurnsService
from oss.src.core.shared.dtos import Reference
from oss.src.core.sharing.admission import RunAdmission
from oss.src.core.sharing.service import get_sharing_service
from oss.src.core.store.storage import ObjectStore
from oss.src.core.triggers.utils import purge_hidden_schedule
from oss.src.core.workflows.service import WorkflowsService
from oss.src.dbs.http.sessions.control_delivery_direct import DirectControlDelivery
from oss.src.dbs.postgres.environments.dbes import (
    EnvironmentArtifactDBE,
    EnvironmentRevisionDBE,
    EnvironmentVariantDBE,
)
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.dbs.postgres.mounts.dao import MountsDAO
from oss.src.dbs.postgres.sessions.commands.dao import SessionCommandsDAO
from oss.src.dbs.postgres.sessions.executions.dao import SessionExecutionsDAO
from oss.src.dbs.postgres.sessions.inputs.dao import SessionInputsDAO
from oss.src.dbs.postgres.sessions.interactions.dao import SessionInteractionsDAO
from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO
from oss.src.dbs.postgres.sessions.turns.dao import SessionTurnsDAO
from oss.src.dbs.postgres.triggers.dao import TriggersDAO
from oss.src.dbs.postgres.shared.engine import (
    get_analytics_engine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.workflows.dao import WorkflowsDAO
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowRevisionDBE,
    WorkflowVariantDBE,
)
from oss.src.dbs.redis.sessions.watch import SessionsWatchPublisher
from oss.src.dbs.redis.shared.engine import get_lock_engine
from oss.src.tasks.asyncio.sessions.interactions_dispatcher import (
    InteractionsDispatcher,
)
from oss.src.utils.env import env


def _workflows_service(
    *, transactions_engine, mounts_store
) -> Tuple[WorkflowsService, MountsService]:
    """The workflows service and the mounts service it looks mounts up in; the
    producer writes result files through the same mounts service."""
    workflows_service = WorkflowsService(
        workflows_dao=WorkflowsDAO(
            ArtifactDBE=WorkflowArtifactDBE,
            VariantDBE=WorkflowVariantDBE,
            RevisionDBE=WorkflowRevisionDBE,
        ),
        watch_publisher=SessionsWatchPublisher(),
    )
    mounts_service = MountsService(
        mounts_dao=MountsDAO(engine=transactions_engine),
        mounts_store=mounts_store,
        bucket=env.store.bucket,
        namespace=env.store.namespace,
        workflows_service=workflows_service,
        lock_engine=get_lock_engine(),
    )
    workflows_service.set_mount_lookup(mounts_service)
    environments_service = EnvironmentsService(
        environments_dao=GitDAO(
            ArtifactDBE=EnvironmentArtifactDBE,
            VariantDBE=EnvironmentVariantDBE,
            RevisionDBE=EnvironmentRevisionDBE,
        )
    )
    embeds_service = EmbedsService(
        workflows_service=workflows_service,
        environments_service=environments_service,
    )
    workflows_service.environments_service = environments_service
    workflows_service.embeds_service = embeds_service
    environments_service.embeds_service = embeds_service
    workflows_service.set_session_context_resolver(
        make_session_context_resolver(
            streams_service=SessionStreamsService(
                streams_dao=SessionStreamsDAO(engine=transactions_engine),
                lock_engine=get_lock_engine(),
            ),
            turns_service=SessionTurnsService(
                turns_dao=SessionTurnsDAO(engine=transactions_engine),
            ),
        )
    )
    return workflows_service, mounts_service


def build_session_child_updates_service() -> SessionChildUpdatesService:
    """Built after `bootstrap_access()`, which the run admission reads."""
    transactions_engine = get_transactions_engine()
    lock_engine = get_lock_engine()
    store = ObjectStore(
        endpoint_url=env.store.endpoint_url,
        access_key=env.store.access_key,
        secret_key=env.store.secret_key,
        region=env.store.region,
        sts_endpoint_url=env.store.sts_endpoint_url,
        signing_key=env.store.signing_key,
    )
    workflows_service, mounts_service = _workflows_service(
        transactions_engine=transactions_engine, mounts_store=store
    )
    run_admission = RunAdmission(
        access_service=get_access_service(),
        workflows_service=workflows_service,
    )

    async def _dispatch_detached_run(
        *, project_id, user_id, request, envelope, run_id=None
    ) -> str:
        result = await workflows_service.invoke_workflow_detached(
            project_id=project_id,
            user_id=user_id,
            request=request,
            envelope=envelope,
            run_id=run_id,
        )
        return result.run_id

    streams_dao = SessionStreamsDAO(engine=transactions_engine)
    streams_service = SessionStreamsService(
        streams_dao=streams_dao, lock_engine=lock_engine
    )
    executions_dao = SessionExecutionsDAO(engine=transactions_engine)
    inputs_dao = SessionInputsDAO(engine=transactions_engine)
    interactions_dao = SessionInteractionsDAO(engine=transactions_engine)
    turns_dao = SessionTurnsDAO(engine=transactions_engine)
    records_service = RecordsService(
        records_dao=RecordsDAO(engine=get_analytics_engine()),
        executions_dao=executions_dao,
    )
    interactions_dispatcher = InteractionsDispatcher(
        workflows_service=workflows_service,
        run_admission=run_admission,
        interactions_service=SessionInteractionsService(
            interactions_dao=interactions_dao,
            watch_publisher=SessionsWatchPublisher(),
        ),
        records_service=records_service,
        turns_service=SessionTurnsService(turns_dao=turns_dao),
        streams_service=streams_service,
        dispatch_fn=_dispatch_detached_run,
    )
    commands_service = SessionCommandsService(
        commands_dao=SessionCommandsDAO(engine=transactions_engine),
        streams_service=streams_service,
        interactions_service=interactions_dispatcher.interactions_service,
        lock_engine=lock_engine,
        delivery=DirectControlDelivery(
            continue_interaction=lambda command: deliver_continue_interaction(
                command=command,
                interactions_dispatcher=interactions_dispatcher,
            ),
            continue_input=lambda command: deliver_continue_input(
                command=command,
                workflows_service=workflows_service,
                run_admission=run_admission,
            ),
        ),
        executions_dao=executions_dao,
        inputs_dao=inputs_dao,
    )
    triggers_dao = TriggersDAO(engine=transactions_engine)
    starts_service = SessionStartsService(
        inputs_service=SessionInputsService(
            inputs_dao=inputs_dao,
            interactions_dao=interactions_dao,
            streams_service=streams_service,
            executions_dao=executions_dao,
            continuation_resumer=commands_service.resume_recoverable_continuation,
        ),
        run_admission=run_admission,
        executions_dao=executions_dao,
        streams_dao=streams_dao,
        inputs_dao=inputs_dao,
        turns_dao=turns_dao,
        cancelled_by_steer=commands_service.cancelled_by_steer,
        workflows_service=workflows_service,
        lock_engine=lock_engine,
    )

    async def _agent_lookup(
        project_id: UUID, workflow_id: UUID
    ) -> Optional[ChildTurnAgent]:
        workflow = await workflows_service.fetch_workflow(
            project_id=project_id, workflow_ref=Reference(id=workflow_id)
        )
        if workflow is None or workflow.id is None:
            return None
        return ChildTurnAgent(id=workflow.id, slug=workflow.slug, name=workflow.name)

    return SessionChildUpdatesService(
        streams_dao=streams_dao,
        inputs_dao=inputs_dao,
        executions_dao=executions_dao,
        turns_dao=turns_dao,
        records_service=records_service,
        starts_service=starts_service,
        session_readers=lambda project_id, session_id: (
            get_sharing_service().session_readers(
                project_id=project_id, session_id=session_id
            )
        ),
        result_files=mounts_service,
        agent_lookup=_agent_lookup,
        # The start and send handlers create the still-running schedule; the producer
        # deletes it by its derived id, as `TriggersService.purge_session_schedule` does.
        delete_still_running_schedule=lambda project_id, schedule_id: (
            purge_hidden_schedule(
                dao=triggers_dao, project_id=project_id, schedule_id=schedule_id
            )
        ),
        cancel_cause=commands_service.cancel_cause,
    )
