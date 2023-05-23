from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from agenta_backend.routers import app_variant
from agenta_backend.routers import app_evaluation_router

origins = [
    "http://localhost:3000",
]

# this is the prefix in which we are reverse proxying the api
app = FastAPI()
app.include_router(app_variant.router, prefix='/app_variant')
app.include_router(app_evaluation_router.router, prefix='/app_evaluations')

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
