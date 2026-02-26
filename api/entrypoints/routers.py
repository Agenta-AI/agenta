from contextlib import asynccontextmanager

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

from oss.src.services.auth_service import authentication_middleware
from oss.src.services.analytics_service import analytics_middleware

from oss.src.core.auth.supertokens.config import init_supertokens

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
from oss.src.dbs.postgres.environments.dbes import (
    EnvironmentArtifactDBE,
    EnvironmentVariantDBE,
    EnvironmentRevisionDBE,
)

# DAOs
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.dbs.postgres.tracing.dao import TracingDAO
from oss.src.dbs.postgres.blobs.dao import BlobsDAO
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.dbs.postgres.evaluations.dao import EvaluationsDAO
from oss.src.dbs.postgres.folders.dao import FoldersDAO

# Services
from oss.src.core.secrets.services import VaultService
from oss.src.core.tracing.service import TracingService
from oss.src.core.invocations.service import InvocationsService
from oss.src.core.annotations.service import AnnotationsService
from oss.src.core.testcases.service import TestcasesService
from oss.src.core.testsets.service import TestsetsService
from oss.src.core.testsets.service import SimpleTestsetsService
from oss.src.core.queries.service import QueriesService
from oss.src.core.queries.service import SimpleQueriesService
from oss.src.core.applications.services import ApplicationsService
from oss.src.core.applications.services import SimpleApplicationsService
from oss.src.core.folders.service import FoldersService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.evaluators.service import EvaluatorsService
from oss.src.core.evaluators.service import SimpleEvaluatorsService
from oss.src.core.environments.service import EnvironmentsService
from oss.src.core.environments.service import SimpleEnvironmentsService
from oss.src.core.evaluations.service import EvaluationsService
from oss.src.core.evaluations.service import SimpleEvaluationsService

# Routers
from oss.src.apis.fastapi.vault.router import VaultRouter
from oss.src.apis.fastapi.auth.router import auth_router
from oss.src.apis.fastapi.otlp.router import OTLPRouter
from oss.src.apis.fastapi.tracing.router import TracingRouter
from oss.src.apis.fastapi.invocations.router import InvocationsRouter
from oss.src.apis.fastapi.annotations.router import AnnotationsRouter
from oss.src.apis.fastapi.testcases.router import TestcasesRouter
from oss.src.apis.fastapi.testsets.router import TestsetsRouter
from oss.src.apis.fastapi.testsets.router import SimpleTestsetsRouter
from oss.src.apis.fastapi.queries.router import QueriesRouter
from oss.src.apis.fastapi.queries.router import SimpleQueriesRouter
from oss.src.apis.fastapi.applications.router import ApplicationsRouter
from oss.src.apis.fastapi.applications.router import SimpleApplicationsRouter
from oss.src.apis.fastapi.folders.router import FoldersRouter
from oss.src.apis.fastapi.workflows.router import WorkflowsRouter
from oss.src.apis.fastapi.evaluators.router import EvaluatorsRouter
from oss.src.apis.fastapi.evaluators.router import SimpleEvaluatorsRouter
from oss.src.apis.fastapi.environments.router import EnvironmentsRouter
from oss.src.apis.fastapi.environments.router import SimpleEnvironmentsRouter
from oss.src.apis.fastapi.evaluations.router import EvaluationsRouter
from oss.src.apis.fastapi.evaluations.router import SimpleEvaluationsRouter

from oss.src.core.ai_services.service import AIServicesService
from oss.src.apis.fastapi.ai_services.router import AIServicesRouter
from oss.src.dbs.postgres.tools.dao import ToolsDAO
from oss.src.core.tools.providers.composio import ComposioToolsAdapter
from oss.src.core.tools.registry import ToolsGatewayRegistry
from oss.src.core.tools.service import ToolsService
from oss.src.apis.fastapi.tools.router import ToolsRouter


from oss.src.routers import (
    admin_router,
    app_router,
    environment_router,
    user_profile,
    variants_router,
    configs_router,
    health_router,
    permissions_router,
    projects_router,
    api_key_router,
    organization_router,
    workspace_router,
    container_router,
)

from oss.src.utils.env import env
from entrypoints.worker_evaluations import evaluations_worker
import oss.src.core.evaluations.tasks.live  # noqa: F401
import oss.src.core.evaluations.tasks.legacy  # noqa: F401
import oss.src.core.evaluations.tasks.batch  # noqa: F401

from redis.asyncio import Redis
from oss.src.tasks.asyncio.tracing.worker import TracingWorker

import agenta as ag

ag.init(
    api_url=env.agenta.api_url,
)

ee = None
if is_ee():
    import ee.src.main as ee  # type: ignore


log = get_module_logger(__name__)

init_supertokens()


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

    for adapter in _composio_adapters.values():
        await adapter.close()


app = FastAPI(
    lifespan=lifespan,
    openapi_tags=open_api_tags_metadata,
    root_path="/api",
)
# MIDDLEWARE -------------------------------------------------------------------


if is_ee():
    from ee.src.services.throttling_service import throttling_middleware

    app.middleware("http")(throttling_middleware)

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
        "https://agenta.ai",
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

environments_dao = GitDAO(
    ArtifactDBE=EnvironmentArtifactDBE,
    VariantDBE=EnvironmentVariantDBE,
    RevisionDBE=EnvironmentRevisionDBE,
)

evaluations_dao = EvaluationsDAO()
folders_dao = FoldersDAO()

tools_dao = ToolsDAO()

# SERVICES ---------------------------------------------------------------------

vault_service = VaultService(
    secrets_dao=secrets_dao,
)

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

folders_service = FoldersService(
    folders_dao=folders_dao,
)

workflows_service = WorkflowsService(
    workflows_dao=workflows_dao,
)

applications_service = ApplicationsService(
    workflows_service=workflows_service,
)

simple_applications_service = SimpleApplicationsService(
    applications_service=applications_service,
)

evaluators_service = EvaluatorsService(
    workflows_service=workflows_service,
)

simple_evaluators_service = SimpleEvaluatorsService(
    evaluators_service=evaluators_service,
)

environments_service = EnvironmentsService(
    environments_dao=environments_dao,
)

simple_environments_service = SimpleEnvironmentsService(
    environments_service=environments_service,
)

evaluations_service = EvaluationsService(
    evaluations_dao=evaluations_dao,
    tracing_service=tracing_service,
    queries_service=queries_service,
    testsets_service=testsets_service,
    evaluators_service=evaluators_service,
    evaluations_worker=evaluations_worker,
)

simple_evaluations_service = SimpleEvaluationsService(
    testsets_service=testsets_service,
    queries_service=queries_service,
    applications_service=applications_service,
    evaluators_service=evaluators_service,
    evaluations_service=evaluations_service,
    evaluations_worker=evaluations_worker,
)

# Tools adapter + service
_composio_adapters = {}
if env.composio.enabled:
    _composio_adapters["composio"] = ComposioToolsAdapter(
        api_key=env.composio.api_key,  # type: ignore[arg-type]  # guarded by .enabled
        api_url=env.composio.api_url,
    )
else:
    log.warning("Composio not enabled — set COMPOSIO_API_KEY to activate gateway tools")

tools_adapter_registry = ToolsGatewayRegistry(
    adapters=_composio_adapters,
)

tools_service = ToolsService(
    tools_dao=tools_dao,
    adapter_registry=tools_adapter_registry,
)

# ROUTERS ----------------------------------------------------------------------

secrets = VaultRouter(
    vault_service=vault_service,
)

otlp = OTLPRouter(
    tracing_worker=tracing_worker,
)

tracing = TracingRouter(
    tracing_service=tracing_service,
    tracing_worker=tracing_worker,
)

testcases = TestcasesRouter(
    testcases_service=testcases_service,
    testsets_service=testsets_service,
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

applications = ApplicationsRouter(
    applications_service=applications_service,
)

simple_applications = SimpleApplicationsRouter(
    simple_applications_service=simple_applications_service,
)

folders = FoldersRouter(
    folders_service=folders_service,
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

environments = EnvironmentsRouter(
    environments_service=environments_service,
)

simple_environments = SimpleEnvironmentsRouter(
    simple_environments_service=simple_environments_service,
)

evaluations = EvaluationsRouter(
    evaluations_service=evaluations_service,
    queries_service=queries_service,
)

simple_evaluations = SimpleEvaluationsRouter(
    simple_evaluations_service=simple_evaluations_service,
)

tools = ToolsRouter(
    tools_service=tools_service,
)

invocations_service = InvocationsService(
    tracing_router=tracing,
    applications_service=applications_service,
    simple_applications_service=simple_applications_service,
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

# AI SERVICES ------------------------------------------------------------------

ai_services_service = AIServicesService.from_env()
ai_services = AIServicesRouter(
    ai_services_service=ai_services_service,
)

# MOUNTING ROUTERS TO APP ROUTES -----------------------------------------------

app.include_router(
    secrets.router,
    prefix="/vault/v1",
    tags=["Secrets"],
)

app.include_router(
    router=otlp.router,
    prefix="/otlp/v1",
    tags=["Observability"],
)

app.include_router(
    router=auth_router,
    prefix="/auth",
    tags=["Auth"],
)

## DEPRECATED
app.include_router(
    router=tracing.router,
    prefix="/preview/tracing",
    tags=["Deprecated"],
    include_in_schema=False,
)
## DEPRECATED

app.include_router(
    router=tracing.router,
    prefix="/tracing",
    tags=["Observability"],
)

app.include_router(
    router=invocations.router,
    prefix="/invocations",
    tags=["Invocations"],
)

app.include_router(
    router=invocations.router,
    prefix="/preview/invocations",
    tags=["Invocations"],
    include_in_schema=False,
)

app.include_router(
    router=annotations.router,
    prefix="/annotations",
    tags=["Annotations"],
)

app.include_router(
    router=annotations.router,
    prefix="/preview/annotations",
    tags=["Annotations"],
    include_in_schema=False,
)

app.include_router(
    router=testcases.router,
    prefix="/testcases",
    tags=["Testcases"],
)

app.include_router(
    router=testcases.router,
    prefix="/preview/testcases",
    tags=["Testcases"],
    include_in_schema=False,
)

app.include_router(
    router=testsets.router,
    prefix="/testsets",
    tags=["Testsets"],
)

app.include_router(
    router=testsets.router,
    prefix="/preview/testsets",
    tags=["Testsets"],
    include_in_schema=False,
)

app.include_router(
    router=simple_testsets.router,
    prefix="/simple/testsets",
    tags=["Testsets"],
)

app.include_router(
    router=simple_testsets.router,
    prefix="/preview/simple/testsets",
    tags=["Testsets"],
    include_in_schema=False,
)

app.include_router(
    router=queries.router,
    prefix="/queries",
    tags=["Queries"],
)

app.include_router(
    router=queries.router,
    prefix="/preview/queries",
    tags=["Queries"],
    include_in_schema=False,
)

app.include_router(
    router=simple_queries.router,
    prefix="/simple/queries",
    tags=["Queries"],
)

app.include_router(
    router=simple_queries.router,
    prefix="/preview/simple/queries",
    tags=["Queries"],
    include_in_schema=False,
)

app.include_router(
    router=folders.router,
    prefix="/folders",
    tags=["Folders"],
)

app.include_router(
    router=applications.router,
    prefix="/applications",
    tags=["Applications"],
)

app.include_router(
    router=applications.router,
    prefix="/preview/applications",
    tags=["Applications"],
    include_in_schema=False,
)

app.include_router(
    router=simple_applications.router,
    prefix="/simple/applications",
    tags=["Applications"],
)

app.include_router(
    router=simple_applications.router,
    prefix="/preview/simple/applications",
    tags=["Applications"],
    include_in_schema=False,
)

app.include_router(
    router=workflows.router,
    prefix="/workflows",
    tags=["Workflows"],
)

app.include_router(
    router=workflows.router,
    prefix="/preview/workflows",
    tags=["Workflows"],
    include_in_schema=False,
)

app.include_router(
    router=ai_services.router,
    prefix="/ai/services",
    tags=["AI Services"],
)

app.include_router(
    router=evaluators.router,
    prefix="/evaluators",
    tags=["Evaluators"],
)

app.include_router(
    router=evaluators.router,
    prefix="/preview/evaluators",
    tags=["Evaluators"],
    include_in_schema=False,
)

app.include_router(
    router=simple_evaluators.router,
    prefix="/simple/evaluators",
    tags=["Evaluators"],
)

app.include_router(
    router=simple_evaluators.router,
    prefix="/preview/simple/evaluators",
    tags=["Evaluators"],
    include_in_schema=False,
)

app.include_router(
    router=environments.router,
    prefix="/preview/environments",
    tags=["Environments"],
)

app.include_router(
    router=simple_environments.router,
    prefix="/preview/simple/environments",
    tags=["Environments"],
)

app.include_router(
    router=tools.router,
    prefix="/preview/tools",
    tags=["Tools"],
)

app.include_router(
    router=evaluations.admin_router,
    prefix="/admin/evaluations",
    tags=["Evaluations", "Admin"],
)

app.include_router(
    router=evaluations.router,
    prefix="/evaluations",
    tags=["Evaluations"],
)

app.include_router(
    router=evaluations.router,
    prefix="/preview/evaluations",
    tags=["Evaluations"],
    include_in_schema=False,
)

app.include_router(
    router=simple_evaluations.router,
    prefix="/simple/evaluations",
    tags=["Evaluations"],
)

app.include_router(
    router=simple_evaluations.router,
    prefix="/preview/simple/evaluations",
    tags=["Evaluations"],
    include_in_schema=False,
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
    environment_router.router,
    prefix="/environments",
    tags=["Environments"],
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
