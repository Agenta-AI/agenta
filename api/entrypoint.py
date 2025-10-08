from contextlib import asynccontextmanager

from celery import Celery, signals
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from supertokens_python import get_all_cors_headers as get_all_supertokens_cors_headers
from supertokens_python.framework.fastapi import (
    get_middleware as get_supertokens_middleware,
)

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.helpers import warn_deprecated_env_vars, validate_required_env_vars

from oss.src.open_api import open_api_tags_metadata

from oss.databases.postgres.migrations.core.utils import (
    check_for_new_migrations as check_for_new_core_migrations,
)
from oss.databases.postgres.migrations.tracing.utils import (
    check_for_new_migrations as check_for_new_tracing_migrations,
)

from oss.src.services.auth_helper import authentication_middleware
from oss.src.services.analytics_service import analytics_middleware

# DBEs
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

# DAOs
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.dbs.postgres.observability.dao import ObservabilityDAO
from oss.src.dbs.postgres.tracing.dao import TracingDAO
from oss.src.dbs.postgres.blobs.dao import BlobsDAO
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.dbs.postgres.evaluations.dao import EvaluationsDAO

# Services
from oss.src.core.secrets.services import VaultService
from oss.src.core.observability.service import ObservabilityService
from oss.src.core.tracing.service import TracingService
from oss.src.core.invocations.service import InvocationsService
from oss.src.core.annotations.service import AnnotationsService
from oss.src.core.testcases.service import TestcasesService
from oss.src.core.testsets.service import TestsetsService
from oss.src.core.testsets.service import SimpleTestsetsService
from oss.src.core.queries.service import QueriesService
from oss.src.core.queries.service import SimpleQueriesService
from oss.src.core.applications.service import LegacyApplicationsService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.evaluators.service import EvaluatorsService
from oss.src.core.evaluators.service import SimpleEvaluatorsService
from oss.src.core.evaluations.service import EvaluationsService
from oss.src.core.evaluations.service import SimpleEvaluationsService

# Routers
from oss.src.apis.fastapi.vault.router import VaultRouter
from oss.src.apis.fastapi.observability.router import ObservabilityRouter
from oss.src.apis.fastapi.tracing.router import TracingRouter
from oss.src.apis.fastapi.invocations.router import InvocationsRouter
from oss.src.apis.fastapi.annotations.router import AnnotationsRouter
from oss.src.apis.fastapi.testcases.router import TestcasesRouter
from oss.src.apis.fastapi.testsets.router import TestsetsRouter
from oss.src.apis.fastapi.testsets.router import SimpleTestsetsRouter
from oss.src.apis.fastapi.queries.router import QueriesRouter
from oss.src.apis.fastapi.queries.router import SimpleQueriesRouter
from oss.src.apis.fastapi.applications.router import LegacyApplicationsRouter
from oss.src.apis.fastapi.workflows.router import WorkflowsRouter
from oss.src.apis.fastapi.evaluators.router import EvaluatorsRouter
from oss.src.apis.fastapi.evaluators.router import SimpleEvaluatorsRouter
from oss.src.apis.fastapi.evaluations.router import EvaluationsRouter
from oss.src.apis.fastapi.evaluations.router import SimpleEvaluationsRouter


from oss.src.routers import (
    admin_router,
    app_router,
    environment_router,
    evaluators_router,
    testset_router,
    user_profile,
    variants_router,
    bases_router,
    configs_router,
    health_router,
    permissions_router,
    projects_router,
    api_key_router,
    organization_router,
    workspace_router,
    container_router,
)

import agenta as ag

ag.init()

ee = None
if is_ee():
    import ee.src.main as ee  # type: ignore


log = get_module_logger(__name__)


@signals.setup_logging.connect
def on_celery_setup_logging(**kwargs):
    pass  # effectively no-op, preventing celery from reconfiguring logging


@asynccontextmanager
async def lifespan(*args, **kwargs):
    """
    Lifespan initializes the database engine and load the default llm services.

    Args:
        application: FastAPI application.
        cache: A boolean value that indicates whether to use the cached data or not.
    """

    await check_for_new_core_migrations()
    await check_for_new_tracing_migrations()

    warn_deprecated_env_vars()
    validate_required_env_vars()

    yield


celery_app = Celery("agenta_app")

celery_app.config_from_object("oss.src.celery_config")

app = FastAPI(
    lifespan=lifespan,
    openapi_tags=open_api_tags_metadata,
    root_path="/api",
)
# MIDDLEWARE -------------------------------------------------------------------

app.middleware("http")(authentication_middleware)

app.middleware("http")(analytics_middleware)

app.add_middleware(
    get_supertokens_middleware(),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://0.0.0.0:3000",
        "http://0.0.0.0:3001",
        "https://docs.agenta.ai",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Content-Type"] + get_all_supertokens_cors_headers(),
)

if ee and is_ee():
    app = ee.extend_main(app)

# DAOS -------------------------------------------------------------------------

secrets_dao = SecretsDAO()

observability_dao = ObservabilityDAO()

tracing_dao = TracingDAO()

testcases_dao = BlobsDAO(
    BlobDBE=TestcaseBlobDBE,
)

testsets_dao = GitDAO(
    ArtifactDBE=TestsetArtifactDBE,
    VariantDBE=TestsetVariantDBE,
    RevisionDBE=TestsetRevisionDBE,
)

queries_dao = GitDAO(
    ArtifactDBE=QueryArtifactDBE,
    VariantDBE=QueryVariantDBE,
    RevisionDBE=QueryRevisionDBE,
)

workflows_dao = GitDAO(
    ArtifactDBE=WorkflowArtifactDBE,
    VariantDBE=WorkflowVariantDBE,
    RevisionDBE=WorkflowRevisionDBE,
)

evaluations_dao = EvaluationsDAO()

# SERVICES ---------------------------------------------------------------------

vault_service = VaultService(
    secrets_dao=secrets_dao,
)

observability_service = ObservabilityService(
    observability_dao=observability_dao,
)

tracing_service = TracingService(
    tracing_dao=tracing_dao,
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

queries_service = QueriesService(
    queries_dao=queries_dao,
)

simple_queries_service = SimpleQueriesService(
    queries_service=queries_service,
)

legacy_applications_service = LegacyApplicationsService()

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

simple_evaluations_service = SimpleEvaluationsService(
    queries_service=queries_service,
    testsets_service=testsets_service,
    evaluators_service=evaluators_service,
    evaluations_service=evaluations_service,
    simple_testsets_service=simple_testsets_service,
    simple_evaluators_service=simple_evaluators_service,
)

# ROUTERS ----------------------------------------------------------------------

secrets = VaultRouter(
    vault_service=vault_service,
)

observability = ObservabilityRouter(
    observability_service=observability_service,
    tracing_service=tracing_service,
)

tracing = TracingRouter(
    tracing_service=tracing_service,
)

testcases = TestcasesRouter(
    testcases_service=testcases_service,
)

testsets = TestsetsRouter(
    testsets_service=testsets_service,
)

simple_testsets = SimpleTestsetsRouter(
    simple_testsets_service=simple_testsets_service,
)

queries = QueriesRouter(
    queries_service=queries_service,
)

simple_queries = SimpleQueriesRouter(
    simple_queries_service=simple_queries_service,
)

legacy_applications = LegacyApplicationsRouter(
    legacy_applications_service=legacy_applications_service,
)

workflows = WorkflowsRouter(
    workflows_service=workflows_service,
)

evaluators = EvaluatorsRouter(
    evaluators_service=evaluators_service,
)

simple_evaluators = SimpleEvaluatorsRouter(
    simple_evaluators_service=simple_evaluators_service,
)

evaluations = EvaluationsRouter(
    evaluations_service=evaluations_service,
    queries_service=queries_service,
)

simple_evaluations = SimpleEvaluationsRouter(
    simple_evaluations_service=simple_evaluations_service,
)

invocations_service = InvocationsService(
    legacy_applications_service=legacy_applications_service,
    tracing_router=tracing,
)

annotations_service = AnnotationsService(
    tracing_router=tracing,
    evaluators_service=evaluators_service,
    simple_evaluators_service=simple_evaluators_service,
)

invocations = InvocationsRouter(
    invocations_service=invocations_service,
)

annotations = AnnotationsRouter(
    annotations_service=annotations_service,
)

# MOUNTING ROUTERS TO APP ROUTES -----------------------------------------------

app.include_router(
    secrets.router,
    prefix="/vault/v1",
    tags=["Secrets"],
)

app.include_router(
    router=observability.otlp,
    prefix="/otlp",
    tags=["Observability"],
)

app.include_router(
    router=observability.router,
    prefix="/observability/v1",
    tags=["Observability"],
)

app.include_router(
    router=tracing.router,
    prefix="/preview/tracing",
    tags=["Tracing"],
)

app.include_router(
    router=invocations.router,
    prefix="/preview/invocations",
    tags=["Invocations"],
)

app.include_router(
    router=annotations.router,
    prefix="/preview/annotations",
    tags=["Annotations"],
)

app.include_router(
    router=testcases.router,
    prefix="/preview/testcases",
    tags=["Testcases"],
)

app.include_router(
    router=testsets.router,
    prefix="/preview/testsets",
    tags=["Testsets"],
)

app.include_router(
    router=simple_testsets.router,
    prefix="/preview/simple/testsets",
    tags=["Testsets"],
)

app.include_router(
    router=queries.router,
    prefix="/preview/queries",
    tags=["Queries"],
)

app.include_router(
    router=simple_queries.router,
    prefix="/preview/simple/queries",
    tags=["Queries"],
)

app.include_router(
    router=legacy_applications.router,
    prefix="/preview/legacy/applications",
    tags=["Applications"],
)

app.include_router(
    router=workflows.router,
    prefix="/preview/workflows",
    tags=["Workflows"],
)

app.include_router(
    router=evaluators.router,
    prefix="/preview/evaluators",
    tags=["Evaluators"],
)

app.include_router(
    router=simple_evaluators.router,
    prefix="/preview/simple/evaluators",
    tags=["Evaluators"],
)

app.include_router(
    router=evaluations.admin_router,
    prefix="/admin/evaluations",
    tags=["Evaluations", "Admin"],
)

app.include_router(
    router=evaluations.router,
    prefix="/preview/evaluations",
    tags=["Evaluations"],
)

app.include_router(
    router=simple_evaluations.router,
    prefix="/preview/simple/evaluations",
    tags=["Evaluations"],
)

app.include_router(
    admin_router.router,
    prefix="/admin",
    tags=["Admin"],
)

app.include_router(
    health_router.router,
    prefix="/health",
)

app.include_router(
    permissions_router.router,
    prefix="/permissions",
    tags=["Access Control"],
)

app.include_router(
    projects_router.router,
    prefix="/projects",
    tags=["Scopes"],
)

app.include_router(
    user_profile.router,
    prefix="/profile",
)

app.include_router(
    app_router.router,
    prefix="/apps",
    tags=["Apps"],
)

app.include_router(
    variants_router.router,
    prefix="/variants",
    tags=["Variants"],
)

app.include_router(
    container_router.router,
    prefix="/containers",
    tags=["Containers"],
)

app.include_router(
    evaluators_router.router,
    prefix="/evaluators",
    tags=["Evaluators"],
)

app.include_router(
    testset_router.router,
    prefix="/testsets",
    tags=["Testsets"],
)

app.include_router(
    environment_router.router,
    prefix="/environments",
    tags=["Environments"],
)

app.include_router(
    bases_router.router,
    prefix="/bases",
    tags=["Bases"],
)

app.include_router(
    configs_router.router,
    prefix="/configs",
    tags=["Configs"],
)

app.include_router(
    api_key_router.router,
    prefix="/keys",
    tags=["Api Keys"],
)

app.include_router(
    organization_router.router,
    prefix="/organizations",
    tags=["Organization"],
)

app.include_router(
    workspace_router.router,
    prefix="/workspaces",
    tags=["Workspace"],
)

# ------------------------------------------------------------------------------

if ee and is_ee():
    app = ee.extend_app_schema(app)

    ee.load_tasks()
