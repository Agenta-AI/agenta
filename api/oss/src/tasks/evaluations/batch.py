from typing import Dict, List, Optional
from uuid import UUID
import asyncio
import traceback
from json import dumps

from celery import shared_task, states, Task

from fastapi import Request

from oss.src.utils.helpers import parse_url, get_slug_from_name_and_id
from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import is_ee
from oss.src.services.auth_helper import sign_secret_token
from oss.src.services import llm_apps_service
from oss.src.models.shared_models import InvokationResult
from oss.src.services.db_manager import (
    fetch_app_by_id,
    fetch_app_variant_by_id,
    fetch_app_variant_revision_by_id,
    get_deployment_by_id,
    get_project_by_id,
)
from oss.src.core.secrets.utils import get_llm_providers_secrets

if is_ee():
    from ee.src.utils.entitlements import check_entitlements, Counter

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
from oss.src.apis.fastapi.evaluators.router import SimpleEvaluatorsRouter
from oss.src.apis.fastapi.annotations.router import AnnotationsRouter

from oss.src.core.annotations.types import (
    AnnotationOrigin,
    AnnotationKind,
    AnnotationChannel,
)
from oss.src.apis.fastapi.annotations.models import (
    AnnotationCreate,
    AnnotationCreateRequest,
)

from oss.src.core.evaluations.types import (
    EvaluationStatus,
    EvaluationRun,
    EvaluationRunCreate,
    EvaluationRunEdit,
    EvaluationScenarioCreate,
    EvaluationScenarioEdit,
    EvaluationResultCreate,
    EvaluationMetricsCreate,
)

from oss.src.core.shared.dtos import Reference
from oss.src.core.tracing.dtos import (
    Filtering,
    Windowing,
    Formatting,
    Format,
    Focus,
    TracingQuery,
)
from oss.src.core.workflows.dtos import (
    WorkflowServiceRequestData,
    WorkflowServiceResponseData,
    WorkflowServiceRequest,
    WorkflowServiceResponse,
    WorkflowServiceInterface,
    WorkflowRevisionData,
    WorkflowRevision,
    WorkflowVariant,
    Workflow,
)

from oss.src.core.queries.dtos import (
    QueryRevision,
    QueryVariant,
    Query,
)

from oss.src.core.workflows.dtos import Tree

from oss.src.core.evaluations.utils import get_metrics_keys_from_schema


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

testsets_service = TestsetsService(
    testsets_dao=testsets_dao,
    testcases_service=testcases_service,
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
)

# APIS -------------------------------------------------------------------------

tracing_router = TracingRouter(
    tracing_service=tracing_service,
)

simple_testsets_router = SimpleTestsetsRouter(
    simple_testsets_service=simple_testsets_service,
)  # TODO: REMOVE/REPLACE ONCE TRANSFER IS MOVED TO 'core'

simple_evaluators_router = SimpleEvaluatorsRouter(
    simple_evaluators_service=simple_evaluators_service,
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


@shared_task(
    name="src.tasks.evaluations.batch.evaluate_testsets",
    queue="src.tasks.evaluations.batch.evaluate_testsets",
    bind=True,
)
def evaluate_testsets(
    self,
    *,
    project_id: UUID,
    user_id: UUID,
    #
    run_id: UUID,
):
    pass


@shared_task(
    name="src.tasks.evaluations.batch.evaluate_queries",
    queue="src.tasks.evaluations.batch.evaluate_queries",
    bind=True,
)
def evaluate_queries(
    self: Task,
    *,
    project_id: UUID,
    user_id: UUID,
    #
    run_id: UUID,
):
    pass
