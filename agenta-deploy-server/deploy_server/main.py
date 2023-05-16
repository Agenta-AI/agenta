from fastapi import FastAPI
from deploy_server.routers import app_variant
from fastapi.middleware.cors import CORSMiddleware

origins = [
    "http://localhost:3000",
]

# this is the prefix in which we are reverse proxying the api
app = FastAPI()
app.include_router(app_variant.router, prefix='/app_variant')


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
