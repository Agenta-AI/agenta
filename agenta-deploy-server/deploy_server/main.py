from fastapi import FastAPI
from deploy_server.routers import app_variant

app = FastAPI()

app.include_router(app_variant.router, prefix='/app_variant')


@app.on_event("startup")
async def startup_event():
    # TOOD:: Add connection to registry
    pass
