import os

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI  # noqa: E402

os.environ["AGENTA_SERVICE_MIDDLEWARE_AUTH_ENABLED"] = "false"

import agenta as ag  # noqa: E402

ag.init()


from agenta.sdk.models.workflows import (  # noqa: E402
    WorkflowServiceBatchResponse,
    WorkflowServiceStreamResponse,
    WorkflowServiceResponseData,
)
from agenta.sdk.decorators.routing import (  # noqa: E402
    route,
    default_app,
    create_app,
)
from agenta.sdk.decorators.running import (  # noqa: E402
    WorkflowServiceRequest,
    workflow,
)

custom_app = create_app()

public_app = FastAPI()

public_app.mount("/services", app=default_app)

app = public_app


@route("/tokens-async", app=default_app)
async def async_gen(request: WorkflowServiceRequest):
    for i in range((request.data.inputs or {}).get("count", 3)):
        yield {"async_token": chr(97 + i)}


"""
curl -i -N \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"prompt": "hello"}}}' \
  http://127.0.0.1:8000/services/tokens-async/invoke
"""

"""
curl -i -N \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"prompt": "hello"}}}' \
  http://127.0.0.1:8000/services/tokens-async/invoke
"""


@route("/tokens-sync", app=default_app)
def sync_tokens(request: WorkflowServiceRequest):
    for i in range((request.data.inputs or {}).get("count", 2)):
        yield {"async_token": chr(120 + i)}


"""
curl -i -N \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"prompt": "hello"}}}' \
  http://127.0.0.1:8000/services/tokens-sync/invoke
"""

"""
curl -i -N \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"prompt": "hello"}}}' \
  http://127.0.0.1:8000/services/tokens-sync/invoke
"""


@route("/tokens-batch", app=default_app)
@workflow(aggregate=True)
def batch_tokens(request: WorkflowServiceRequest):
    for i in range((request.data.inputs or {}).get("count", 2)):
        yield {"token": chr(ord("A") + i)}


"""
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"prompt": "hello"}}}' \
  http://127.0.0.1:8000/services/tokens-batch/invoke
"""


@route("/greet-async", app=default_app)
async def greet(request: WorkflowServiceRequest):
    name = (request.data.inputs or {}).get("name", "world")
    return {"message": f"Hello, {name}!"}


"""
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"name": "Agenta"}}}' \
  http://127.0.0.1:8000/services/greet-async/invoke
"""


@route("/echo-sync", app=default_app)
def echo(request: WorkflowServiceRequest):
    return {"echo": request.data.inputs}


"""
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"aloha": "mahalo"}}}' \
  http://127.0.0.1:8000/services/echo-sync/invoke
"""


@route("/already-batch", app=default_app)
def already_batch(request: WorkflowServiceRequest):
    return WorkflowServiceBatchResponse(
        data=WorkflowServiceResponseData(outputs={"ready": True})
    )


"""
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"aloha": "mahalo"}}}' \
  http://127.0.0.1:8000/services/already-batch/invoke
"""


@route("/already-stream", app=default_app)
def already_stream(request: WorkflowServiceRequest):
    async def iterator():
        yield {"ready": "no"}
        yield {"ready": "go"}

    return WorkflowServiceStreamResponse(generator=iterator)


"""
curl -i -N \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"aloha": "mahalo"}}}' \
  http://127.0.0.1:8000/services/already-stream/invoke
"""


@route("/kwargs", app=default_app)
def kwargs_handler(**kwargs):
    return {"got": sorted(kwargs.keys())}


"""
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"aloha": "mahalo"}}}' \
  http://127.0.0.1:8000/services/kwargs/invoke
"""


@route("/unknown", app=default_app)
def unknown_handler(unknown: str):
    return {"got": unknown}


"""
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"aloha": "mahalo"}}}' \
  http://127.0.0.1:8000/services/unknown/invoke
"""


@route("/echo_custom", app=default_app)
def echo_custom(aloha: str):
    return {"got": aloha}


"""
curl -i http://127.0.0.1:8000/services/echo_custom/inspect
"""

"""
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"aloha": "mahalo"}}}' \
  http://127.0.0.1:8000/services/echo_custom/invoke
"""
