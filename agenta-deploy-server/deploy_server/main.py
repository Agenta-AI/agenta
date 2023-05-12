from fastapi import FastAPI
from deploy_server.routers import app_version
from deploy_server.services.docker_registry import start_registry

app = FastAPI()

app.include_router(app_version, prefix='/app_version')


@app.on_event("startup")
async def startup_event():
    start_registry()
