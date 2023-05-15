from fastapi import FastAPI
from deploy_server.routers import app_variant

# this is the prefix in which we are reverse proxying the api
app = FastAPI()
app.include_router(app_variant.router, prefix='/app_variant')


@app.on_event("startup")
async def startup_event():
    # TOOD:: Add connection to registry
    pass
