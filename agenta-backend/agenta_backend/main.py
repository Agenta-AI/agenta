from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from agenta_backend.routers import app_variant
from agenta_backend.routers import evaluation_router
from agenta_backend.routers import testset_router
from agenta_backend.routers import container_router

origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://0.0.0.0:3000",
    "http://0.0.0.0:3001",
]

# this is the prefix in which we are reverse proxying the api
app = FastAPI()
app.include_router(app_variant.router, prefix="/app_variant")
app.include_router(evaluation_router.router, prefix="/evaluations")
app.include_router(testset_router.router, prefix="/testsets")
app.include_router(container_router.router, prefix="/containers")

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
