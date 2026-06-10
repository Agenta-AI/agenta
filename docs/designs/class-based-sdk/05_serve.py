"""Serving class workflows over HTTP. (POC, does not run.)

Workflows plug into FastAPI the FastAPI way: each class exposes a standard
APIRouter, and you mount it with app.include_router like any other router.
No custom registration call, no hidden sub-app mounting.

router() carries two endpoints:
- POST /invoke    Typed from the class: the request body model is generated
                  from Inputs + Parameters, the response model from Outputs.
                  So /docs shows the real schemas, and clients get validation
                  errors from FastAPI like on any other endpoint. Streams
                  (SSE/NDJSON) when the Accept header asks for it and the
                  class declares stream().
- POST /inspect   Returns the interface: schemas, parameters, identity.

The playground talks to these endpoints to render the config form and run
the app.
"""

import agenta as ag
import uvicorn
from fastapi import Depends, FastAPI

from application import HotelAgent  # 01_application.py
from evaluators import RubricJudge  # 02_evaluators.py

ag.init()

app = FastAPI()


# Plain FastAPI composition.
app.include_router(HotelAgent.router(), prefix="/hotel", tags=["hotel"])

# Evaluators are workflows too, so a custom evaluator can run as its own
# service and be registered on the platform by URL.
app.include_router(RubricJudge.router(), prefix="/evaluators/rubric-judge")


# Everything FastAPI gives you keeps working: dependencies, auth, middleware,
# versioned prefixes. The router does not care where it is mounted.
def verify_internal_token():  # noqa: D103
    ...


app.include_router(
    HotelAgent.router(),
    prefix="/internal/hotel",
    dependencies=[Depends(verify_internal_token)],
)

# A configured instance serves with its pinned parameters as defaults.
boutique = HotelAgent(parameters={"hotel_name": "Hotel California"})
app.include_router(boutique.router(), prefix="/boutique")


# Your own routes live next to them, as usual.
@app.get("/healthz")
def healthz():
    return {"ok": True}


# No FastAPI app of your own? A class is directly servable as an ASGI app:
#
#   asgi = HotelAgent.asgi()        # then: uvicorn 05_serve:asgi
#
# or from the CLI, without writing a server file at all:
#
#   agenta serve application:HotelAgent --port 8000


if __name__ == "__main__":
    # Resulting endpoints:
    #   POST /hotel/invoke                      POST /hotel/inspect
    #   POST /evaluators/rubric-judge/invoke    POST /evaluators/rubric-judge/inspect
    #   POST /internal/hotel/invoke             (token-protected)
    #   POST /boutique/invoke                   (pinned parameters)
    uvicorn.run(app, host="0.0.0.0", port=8000)
