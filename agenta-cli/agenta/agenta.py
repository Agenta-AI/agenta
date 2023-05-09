from fastapi import FastAPI

app = FastAPI()


def post(func):
    """post de

    Arguments:
        func -- _description_

    Returns:
        _description_
    """
    route = f"/{func.__name__}"
    app.post(route)(func)
    return func


def get(func):
    route = f"/{func.__name__}"
    app.get(route)(func)
    return func
