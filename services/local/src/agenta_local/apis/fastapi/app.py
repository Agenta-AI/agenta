"""FastAPI application factory: security boundary, routers, static seam."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from starlette.staticfiles import StaticFiles

from agenta_local.apis.fastapi.agents.router import router as agents_router
from agenta_local.apis.fastapi.errors import install_error_handlers
from agenta_local.apis.fastapi.providers.router import router as providers_router
from agenta_local.apis.fastapi.runtime.router import router as runtime_router
from agenta_local.apis.fastapi.security import (
    BrowserBoundary,
    BrowserBoundaryMiddleware,
    issue_browser_cookie,
)
from agenta_local.apis.fastapi.sessions.router import router as sessions_router
from agenta_local.config import Settings
from agenta_local.lifespan import lifespan


def create_app(
    settings: Settings | None = None,
    *,
    migrations_dir: Path | None = None,
) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(
        title="Agenta Local", lifespan=lifespan, docs_url=None, redoc_url=None
    )
    if migrations_dir is not None:
        settings.migrations_dir = migrations_dir
    app.state.settings = settings
    app.state.shutting_down = False

    boundary = BrowserBoundary(
        host=settings.host,
        port=settings.port,
        **(
            {"cookie_value": settings.browser_session}
            if settings.browser_session is not None
            else {}
        ),
    )
    app.state.boundary = boundary
    app.add_middleware(BrowserBoundaryMiddleware, boundary=boundary)

    install_error_handlers(app)

    @app.get("/health")
    async def health() -> dict:
        return {
            "ok": True,
            "version": app.state.version,
            "schema_version": app.state.schema_version,
            "recovered_turns": app.state.recovered_turns,
        }

    for router in (agents_router, sessions_router, providers_router, runtime_router):
        app.include_router(router)

    # The renderer is last so /health and /api routes always win. StaticFiles'
    # HTML mode resolves exported route directories such as /agents/.
    if settings.static_dir is not None and settings.static_dir.is_dir():
        app.mount(
            "/",
            StaticFiles(directory=settings.static_dir, html=True),
            name="renderer",
        )
    else:

        @app.get("/", include_in_schema=False)
        async def shell() -> HTMLResponse:
            return _shell_response(settings, boundary)

    return app


_PLACEHOLDER = """<!doctype html>
<html><head><title>Agenta Local</title></head>
<body><div id="root"></div><p>Renderer bundle not installed; API is live.</p></body>
</html>"""


def _shell_response(settings: Settings, boundary) -> HTMLResponse:
    index = settings.static_dir / "index.html" if settings.static_dir else None
    html = (
        index.read_text(encoding="utf-8") if index and index.exists() else _PLACEHOLDER
    )
    response = HTMLResponse(html)
    issue_browser_cookie(boundary, response)
    return response
