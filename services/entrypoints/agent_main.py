"""Standalone entrypoint for the agent service (WP-2 local verification).

Mounts only the agent app plus a health check, so the agent ``/invoke`` can be
exercised with curl without bringing up the full services app. The real integration
point is ``entrypoints/main.py`` (one import + one mount), kept separate so this
isolated runner stays light.

Run locally (auth disabled for curl):

    cd services
    AGENTA_SERVICES_MIDDLEWARE_AUTH_ENABLED=false \\
        uv run uvicorn entrypoints.agent_main:app --host 0.0.0.0 --port 8090
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import agenta as ag
from oss.src.agent import agent_v0_app

ag.init()

app = FastAPI(
    openapi_url=None,
    docs_url=None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    # The playground invokes cross-origin (web on a different port) with credentials
    # (cookies + Authorization). Browsers reject a "*" origin on credentialed requests,
    # so echo the specific origin and allow credentials. Matches the dev box on any
    # port and localhost. Same-origin (served under /services) would avoid CORS entirely.
    allow_origin_regex=r"https?://(144\.76\.237\.122|localhost|0\.0\.0\.0)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


app.mount("/agent/v0", agent_v0_app)
