from fastapi import FastAPI
from deploy_server.routers import models, containers
from deploy_server.services.docker_registry import start_registry

app = FastAPI()

app.include_router(models.router, prefix='/models', tags=['Models'])
# app.include_router(containers.router, prefix='/containers',
#                    tags=['Containers'])


@app.on_event("startup")
async def startup_event():
    start_registry()
