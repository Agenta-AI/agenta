# Shared fixtures for unit tests - no external dependencies needed
import os
import pytest
from unittest.mock import MagicMock, patch


@pytest.fixture(scope="session", autouse=True)
def setup_test_env():
    """Set up required environment variables for tests before any imports."""
    # Set minimal required environment variables to prevent import errors
    os.environ.setdefault("POSTGRES_URI_CORE", "sqlite+aiosqlite:///:memory:")
    os.environ.setdefault("POSTGRES_URI_TRACING", "sqlite+aiosqlite:///:memory:")
    os.environ.setdefault("POSTGRES_URI_SUPERTOKENS", "sqlite+aiosqlite:///:memory:")
    os.environ.setdefault("SUPERTOKENS_CONNECTION_URI", "")
    os.environ.setdefault("SUPERTOKENS_API_KEY", "")
    os.environ.setdefault("REDIS_URL", "")
    os.environ.setdefault("CELERY_BROKER_URL", "")
    os.environ.setdefault("CELERY_RESULT_BACKEND", "")


@pytest.fixture
def mock_engine(monkeypatch):
    """Mock the database engine to avoid actual database connections."""
    mock_async_engine = MagicMock()
    mock_session_maker = MagicMock()
    mock_session = MagicMock()
    
    monkeypatch.setattr(
        "oss.src.dbs.postgres.shared.engine.create_async_engine",
        return_value=mock_async_engine
    )
    monkeypatch.setattr(
        "oss.src.dbs.postgres.shared.engine.async_sessionmaker",
        return_value=mock_session_maker
    )
    
    return {
        "engine": mock_async_engine,
        "session_maker": mock_session_maker,
        "session": mock_session
    }
