from fastapi import FastAPI

app = FastAPI()


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
