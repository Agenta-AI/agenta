from contextlib import asynccontextmanager
from asyncio import create_task

from celery import Celery, signals
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from supertokens_python import get_all_cors_headers as get_all_supertokens_cors_headers
from supertokens_python.framework.fastapi import (
    get_middleware as get_supertokens_middleware,
)

from oss.src.utils.logging import get_module_logger
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
from oss.src.apis.fastapi.middleware.request import request_id_middleware
from oss.src.utils.common import is_ee
from oss.src.open_api import open_api_tags_metadata
from oss.databases.postgres.migrations.core.utils import (
    check_for_new_migrations as check_for_new_entities_migratons,
)
from oss.databases.postgres.migrations.tracing.utils import (
    check_for_new_migrations as check_for_new_tracing_migrations,
)
from oss.src.utils.helpers import warn_deprecated_env_vars, validate_required_env_vars
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.core.secrets.services import VaultService
from oss.src.apis.fastapi.vault.router import VaultRouter
from oss.src.services.auth_helper import authentication_middleware
from oss.src.services.analytics_service import analytics_middleware
from oss.src.dbs.postgres.observability.dao import ObservabilityDAO
from oss.src.core.observability.service import ObservabilityService
from oss.src.apis.fastapi.observability.router import ObservabilityRouter

from oss.src.dbs.postgres.tracing.dao import TracingDAO
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.dbs.postgres.blobs.dao import BlobsDAO

from oss.src.apis.fastapi.workflows.router import WorkflowsRouter
from oss.src.core.workflows.service import WorkflowsService
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowVariantDBE,
    WorkflowRevisionDBE,
)
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.core.workflows.service import WorkflowsService
from oss.src.apis.fastapi.workflows.router import WorkflowsRouter
from oss.src.apis.fastapi.evaluators.router import SimpleEvaluatorsRouter


from oss.src.apis.fastapi.tracing.router import TracingRouter
from oss.src.core.tracing.service import TracingService

from oss.src.apis.fastapi.annotations.router import AnnotationsRouter


from oss.src.apis.fastapi.testsets.router import SimpleTestsetsRouter
from oss.src.core.testsets.service import TestsetsService
from oss.src.core.testcases.service import TestcasesService
from oss.src.dbs.postgres.testcases.dbes import TestcaseBlobDBE
from oss.src.dbs.postgres.testsets.dbes import (
    TestsetArtifactDBE,
    TestsetVariantDBE,
    TestsetRevisionDBE,
)


from oss.src.apis.fastapi.evaluations.router import EvaluationsRouter
from oss.src.core.evaluations.service import EvaluationsService
from oss.src.dbs.postgres.evaluations.dao import EvaluationsDAO

AGENTA_OBSERVABILITY_WORKERS = 1  # TODO: ADJUST ME
AGENTA_TRACING_WORKERS = 1  # TODO: ADJUST ME

origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://0.0.0.0:3000",
    "http://0.0.0.0:3001",
    "https://docs.agenta.ai",
]


celery_app = Celery("agenta_app")
celery_app.config_from_object("oss.src.celery_config")


@signals.setup_logging.connect
def on_celery_setup_logging(**kwargs):
    pass  # effectively no-op, preventing celery from reconfiguring logging


log = get_module_logger(__name__)


@asynccontextmanager
async def lifespan(application: FastAPI, cache=True):
    """
    Lifespan initializes the database engine,
    checks migrations, starts background workers.
    """
    global observability

    await check_for_new_entities_migratons()
    await check_for_new_tracing_migrations()

    warn_deprecated_env_vars()
    validate_required_env_vars()

    for _ in range(AGENTA_OBSERVABILITY_WORKERS):
        create_task(observability.store_nodes())

    for _ in range(AGENTA_TRACING_WORKERS):
        create_task(observability.store_spans())

    # TODO: CONSIDER SENDING A SHUTDOWN EVENT AND FLUSHING THE QUEUE !!!

    yield


app = FastAPI(
    lifespan=lifespan,
    openapi_tags=open_api_tags_metadata,
    root_path="/api",
)

app.middleware("http")(authentication_middleware)
app.middleware("http")(analytics_middleware)
# app.middleware("http")(request_id_middleware)

if is_ee():
    import ee.src.main as ee

    app = ee.extend_main(app)

app.add_middleware(get_supertokens_middleware())
allow_headers = ["Content-Type"] + get_all_supertokens_cors_headers()

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=allow_headers,
)

app.include_router(admin_router.router, prefix="/admin", tags=["Admin"])
app.include_router(health_router.router, prefix="/health")
app.include_router(
    permissions_router.router, prefix="/permissions", tags=["Access Control"]
)
app.include_router(projects_router.router, prefix="/projects", tags=["Scopes"])
app.include_router(user_profile.router, prefix="/profile")
app.include_router(app_router.router, prefix="/apps", tags=["Apps"])
app.include_router(variants_router.router, prefix="/variants", tags=["Variants"])
app.include_router(container_router.router, prefix="/containers", tags=["Containers"])

app.include_router(evaluators_router.router, prefix="/evaluators", tags=["Evaluators"])
app.include_router(testset_router.router, prefix="/testsets", tags=["Testsets"])
app.include_router(
    environment_router.router, prefix="/environments", tags=["Environments"]
)
app.include_router(bases_router.router, prefix="/bases", tags=["Bases"])
app.include_router(configs_router.router, prefix="/configs", tags=["Configs"])
app.include_router(api_key_router.router, prefix="/keys", tags=["Api Keys"])
app.include_router(
    organization_router.router, prefix="/organizations", tags=["Organization"]
)
app.include_router(workspace_router.router, prefix="/workspaces", tags=["Workspace"])

vault_service = VaultService(
    secrets_dao=SecretsDAO(),
)

vault_router = VaultRouter(
    vault_service=vault_service,
)

tracing_service = TracingService(
    tracing_dao=TracingDAO(),
)

observability_service = ObservabilityService(
    observability_dao=ObservabilityDAO(),
)

observability = ObservabilityRouter(
    observability_service=observability_service,
    tracing_service=tracing_service,
)


tracing = TracingRouter(
    tracing_service=tracing_service,
)

workflow_service = WorkflowsService(
    workflows_dao=GitDAO(
        ArtifactDBE=WorkflowArtifactDBE,
        VariantDBE=WorkflowVariantDBE,
        RevisionDBE=WorkflowRevisionDBE,
    ),
    tracing_router=tracing.router,
)

simple_evaluators = SimpleEvaluatorsRouter(
    workflows_service=workflow_service,
)


annotations = AnnotationsRouter(
    tracing_service=tracing_service,
    workflows_service=workflow_service,
)

workflows = WorkflowsRouter(
    workflows_service=workflow_service,
)

testcases_service = TestcasesService(
    blobs_dao=BlobsDAO(
        BlobDBE=TestcaseBlobDBE,
    )
)

testsets_service = TestsetsService(
    testsets_dao=GitDAO(
        ArtifactDBE=TestsetArtifactDBE,
        VariantDBE=TestsetVariantDBE,
        RevisionDBE=TestsetRevisionDBE,
    ),
    testcases_service=testcases_service,
)

simple_testsets = SimpleTestsetsRouter(
    testsets_service=testsets_service,
)

evaluations_service = EvaluationsService(
    evaluations_dao=EvaluationsDAO(),
)

evaluations = EvaluationsRouter(
    evaluations_service=evaluations_service,
)


app.include_router(
    router=tracing.router,
    prefix="/preview/tracing",
    tags=["Tracing"],
)

app.include_router(
    router=simple_evaluators.router,
    prefix="/preview/simple/evaluators",
    tags=["Evals"],
)

app.include_router(
    router=annotations.router,
    prefix="/preview/annotations",
    tags=["Evals"],
)

app.include_router(
    router=workflows.router,
    prefix="/preview/workflows",
    tags=["Workflows"],
)

app.include_router(
    router=simple_testsets.router,
    prefix="/preview/simple/testsets",
    tags=["Testsets"],
)

app.include_router(
    router=evaluations.router,
    prefix="/preview/evaluations",
    tags=["Evaluations"],
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
    vault_router.router,
    prefix="/vault/v1",
    tags=["Vault"],
)

if is_ee():
    import ee.src.main as ee

    app = ee.extend_app_schema(app)
