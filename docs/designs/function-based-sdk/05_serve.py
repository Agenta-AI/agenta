"""Serving function workflows over HTTP. (POC, does not run.)

Workflows plug into FastAPI the FastAPI way: each handle exposes a standard
APIRouter via `.router()`, and you mount it with app.include_router like any
other router. No custom registration call, no hidden sub-app mounting.

router() carries two endpoints:
- POST /invoke    Typed from the handle: the request body model is generated
                  from inputs + parameters, the response model from outputs.
                  So /docs shows the real schemas, and clients get validation
                  errors from FastAPI like on any other endpoint. Streams
                  (SSE/NDJSON) when the Accept header asks for it and the
                  handle has a registered streamer.
- POST /inspect   Returns the interface: schemas, parameters, identity.

The playground talks to these endpoints to render the config form and run the
app. This file is line-for-line equivalent to the class version, except a
"configured instance" is a pinned handle, not a constructed object.
"""

import agenta as ag
import uvicorn
from fastapi import Depends, FastAPI

from application import hotel_agent  # 01_application.py
from evaluators import rubric_judge  # 02_evaluators.py

ag.init()

app = FastAPI()


# Plain FastAPI composition.
app.include_router(hotel_agent.router(), prefix="/hotel", tags=["hotel"])

# Evaluators are workflows too, so a custom evaluator can run as its own
# service and be registered on the platform by URL.
app.include_router(rubric_judge.router(), prefix="/evaluators/rubric-judge")


# Everything FastAPI gives you keeps working: dependencies, auth, middleware,
# versioned prefixes. The router does not care where it is mounted.
def verify_internal_token():  # noqa: D103
    ...


app.include_router(
    hotel_agent.router(),
    prefix="/internal/hotel",
    dependencies=[Depends(verify_internal_token)],
)

# A pinned handle serves with its baked-in parameters as defaults.
boutique = hotel_agent.pin(hotel_name="Hotel California")
app.include_router(boutique.router(), prefix="/boutique")


# Your own routes live next to them, as usual.
@app.get("/healthz")
def healthz():
    return {"ok": True}


# No FastAPI app of your own? A handle is directly servable as an ASGI app:
#
#   asgi = hotel_agent.asgi()        # then: uvicorn 05_serve:asgi
#
# or from the CLI, without writing a server file at all:
#
#   agenta serve application:hotel_agent --port 8000


if __name__ == "__main__":
    # Resulting endpoints:
    #   POST /hotel/invoke                      POST /hotel/inspect
    #   POST /evaluators/rubric-judge/invoke    POST /evaluators/rubric-judge/inspect
    #   POST /internal/hotel/invoke             (token-protected)
    #   POST /boutique/invoke                   (pinned parameters)
    uvicorn.run(app, host="0.0.0.0", port=8000)
