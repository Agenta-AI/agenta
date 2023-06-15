from fastapi import FastAPI, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from agenta_backend.routers import app_variant
from agenta_backend.routers import app_evaluation_router
from agenta_backend.routers import dataset_router
import os
from agenta_backend.routers import container_manager

origins = os.getenv('ALLOW_ORIGINS').split(',')

app = FastAPI()

api_router = APIRouter()

api_router.include_router(app_variant.router, prefix='/app_variant')
api_router.include_router(app_evaluation_router.router, prefix='/app_evaluations')
api_router.include_router(dataset_router.router, prefix='/datasets')
api_router.include_router(container_manager.router, prefix='/containers')
app.include_router(api_router, prefix="/api")


app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    # TOOD:: Add connection to registry
    pass
