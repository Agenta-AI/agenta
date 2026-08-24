"""Process lifespan: migrate -> open storage -> recover -> wire services."""

import sys
from contextlib import asynccontextmanager
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

from agenta_local.core.agents.service import AgentsService
from agenta_local.core.execution.service import ExecutionService
from agenta_local.core.providers.service import ProvidersService
from agenta_local.core.sessions.service import SessionsService
from agenta_local.dbs.sqlite.agents.dao import AgentsDAO
from agenta_local.dbs.sqlite.sessions.dao import SessionsDAO
from agenta_local.dbs.sqlite.shared.engine import build_engine
from agenta_local.execution.sdk.adapter import SDKAgentExecutor
from agenta_local.stores.files.providers import ProviderCredentialFileStore

from .config import Settings


def _load_migration_runner(migrations_dir: Path):
    name = "agenta_local_migration_runner"
    if name in sys.modules:
        return sys.modules[name]
    spec = spec_from_file_location(name, migrations_dir / "runner.py")
    module = module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _migrations_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "databases" / "sqlite" / "migrations"


@asynccontextmanager
async def lifespan(app):
    settings: Settings = app.state.settings
    settings.data_dir.mkdir(parents=True, exist_ok=True)

    runner = _load_migration_runner(_migrations_dir())
    schema_version = runner.upgrade_database(settings.database_path)

    engine, factory = build_engine(settings.database_path)
    agents = AgentsService(AgentsDAO(factory))
    sessions = SessionsService(SessionsDAO(factory))
    providers = ProvidersService(
        ProviderCredentialFileStore(path=settings.providers_path)
    )
    execution = ExecutionService(
        sessions=sessions,
        agents=agents,
        credentials=providers,
        executor=SDKAgentExecutor(runner_url=settings.runner_url),
    )

    recovered = await execution.recover_interrupted_turns()
    app.state.engine = engine
    app.state.agents = agents
    app.state.sessions = sessions
    app.state.providers = providers
    app.state.execution = execution
    app.state.version = "0.1.0"
    app.state.schema_version = schema_version
    app.state.recovered_turns = recovered
    try:
        yield
    finally:
        await engine.dispose()
