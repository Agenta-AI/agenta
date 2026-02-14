from uuid import UUID

from redis.asyncio import Redis


from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env
from oss.src.utils.common import is_ee

if is_ee():
    pass

from oss.src.dbs.postgres.queries.dbes import (
    QueryArtifactDBE,
    QueryVariantDBE,
    QueryRevisionDBE,
)
from oss.src.dbs.postgres.testcases.dbes import (
    TestcaseBlobDBE,
)
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
from oss.src.core.testsets.service import TestsetsService
from oss.src.core.testsets.service import SimpleTestsetsService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.evaluators.service import EvaluatorsService
from oss.src.core.evaluators.service import SimpleEvaluatorsService
from oss.src.core.evaluations.service import EvaluationsService
from oss.src.core.annotations.service import AnnotationsService

# from oss.src.apis.fastapi.tracing.utils import make_hash_id
from oss.src.apis.fastapi.tracing.router import TracingRouter
from oss.src.apis.fastapi.testsets.router import SimpleTestsetsRouter
from oss.src.apis.fastapi.annotations.router import AnnotationsRouter
from oss.src.tasks.asyncio.tracing.worker import TracingWorker


log = get_module_logger(__name__)


# DBS --------------------------------------------------------------------------

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

# CORE -------------------------------------------------------------------------

tracing_service = TracingService(
    tracing_dao=tracing_dao,
)

# Redis client and TracingWorker for publishing spans to Redis Streams
if env.redis.uri_durable:
    redis_client = Redis.from_url(env.redis.uri_durable, decode_responses=False)
    tracing_worker = TracingWorker(
        service=tracing_service,
        redis_client=redis_client,
        stream_name="streams:tracing",
        consumer_group="worker-tracing",
    )
else:
    raise RuntimeError("REDIS_URI_DURABLE is required for tracing worker")

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

# APIS -------------------------------------------------------------------------

tracing_router = TracingRouter(
    tracing_service=tracing_service,
    tracing_worker=tracing_worker,
)

simple_testsets_router = SimpleTestsetsRouter(
    simple_testsets_service=simple_testsets_service,
)  # TODO: REMOVE/REPLACE ONCE TRANSFER IS MOVED TO 'core'

annotations_service = AnnotationsService(
    tracing_router=tracing_router,
    evaluators_service=evaluators_service,
    simple_evaluators_service=simple_evaluators_service,
)

annotations_router = AnnotationsRouter(
    annotations_service=annotations_service,
)  # TODO: REMOVE/REPLACE ONCE ANNOTATE IS MOVED TO 'core'

# ------------------------------------------------------------------------------


def evaluate_testsets(
    self,
    *,
    project_id: UUID,
    user_id: UUID,
    #
    run_id: UUID,
):
    pass


def evaluate_queries(
    self,
    *,
    project_id: UUID,
    user_id: UUID,
    #
    run_id: UUID,
):
    pass
