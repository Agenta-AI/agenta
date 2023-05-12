from fastapi import FastAPI
from deploy_server.routers import app_version

app = FastAPI()

app.include_router(app_version.router, prefix='/app_version')


@app.on_event("startup")
async def startup_event():
    # TOOD:: Add connection to registry
    pass
