from fastapi import FastAPI
from routers import images, containers
from services.docker_registry import start_registry

app = FastAPI()

app.include_router(images.router, prefix='/images', tags=['Images'])
app.include_router(containers.router, prefix='/containers',
                   tags=['Containers'])


@app.on_event("startup")
async def startup_event():
    start_registry()
