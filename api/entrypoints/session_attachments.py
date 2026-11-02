"""Session attachments, built for a composition root that has no API router
wiring of its own (the channels inbox worker stores inbound files with it)."""

from oss.src.core.mounts.service import MountsService
from oss.src.core.sessions.attachments.dtos import AttachmentLimits
from oss.src.core.sessions.attachments.service import SessionAttachmentsService
from oss.src.core.store.storage import ObjectStore
from oss.src.core.workflows.service import WorkflowsService
from oss.src.dbs.postgres.mounts.dao import MountsDAO
from oss.src.dbs.postgres.sessions.attachments.dao import SessionAttachmentsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.redis.shared.engine import get_lock_engine
from oss.src.utils.env import env


def attachment_limits() -> AttachmentLimits:
    limits = env.agenta.sessions.attachments
    return AttachmentLimits(
        max_image_bytes=limits.max_image_bytes,
        max_audio_bytes=limits.max_audio_bytes,
        max_document_bytes=limits.max_document_bytes,
        max_other_bytes=limits.max_other_bytes,
        max_per_session_count=limits.max_per_session_count,
        max_per_session_bytes=limits.max_per_session_bytes,
        max_pending_per_session=limits.max_pending_per_session,
        pending_ttl_seconds=limits.pending_ttl_seconds,
    )


def build_session_attachments_service(
    *, workflows_service: WorkflowsService
) -> SessionAttachmentsService:
    engine = get_transactions_engine()
    store = ObjectStore(
        endpoint_url=env.store.endpoint_url,
        access_key=env.store.access_key,
        secret_key=env.store.secret_key,
        region=env.store.region,
        sts_endpoint_url=env.store.sts_endpoint_url,
        signing_key=env.store.signing_key,
    )
    mounts_service = MountsService(
        mounts_dao=MountsDAO(engine=engine),
        mounts_store=store,
        bucket=env.store.bucket,
        namespace=env.store.namespace,
        workflows_service=workflows_service,
        lock_engine=get_lock_engine(),
    )
    return SessionAttachmentsService(
        attachments_dao=SessionAttachmentsDAO(engine=engine),
        original_store=mounts_service,
        limits=attachment_limits(),
    )
