from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
app = FastAPI()

origins = [
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def post(func):
    """post decorator

    Arguments:
        func -- _description_

    Returns:
        _description_
    """
    route = f"/{func.__name__}"
    app.post(route)(func)
    return func


def get(func):
    """get decorator

    Arguments:
        func -- _description_

    Returns:
        _description_
    """
    route = f"/{func.__name__}"
    app.get(route)(func)
    return func
