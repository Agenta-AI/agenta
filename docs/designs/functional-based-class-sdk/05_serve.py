"""Serving — class-based example on the functional core. (POC, does not run.)

Diff against ../function-based-sdk/05_serve.py and ../class-based-sdk/05_serve.py.
Identical to the class version: HotelAgent/RubricJudge are the shim classes from
01/02, and .router() delegates to the functional handle. Consuming a router is
the same regardless of how the workflow was authored.
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

# Evaluators are workflows too.
app.include_router(RubricJudge.router(), prefix="/evaluators/rubric-judge")


# Dependencies, auth, middleware, versioned prefixes all keep working.
def verify_internal_token():  # noqa: D103
    ...


app.include_router(
    HotelAgent.router(),
    prefix="/internal/hotel",
    dependencies=[Depends(verify_internal_token)],
)

# A pinned instance serves with its baked-in parameters as defaults.
boutique = HotelAgent(parameters={"hotel_name": "Hotel California"})
app.include_router(boutique.router(), prefix="/boutique")


@app.get("/healthz")
def healthz():
    return {"ok": True}


# No FastAPI app of your own? A class is directly servable as an ASGI app:
#   asgi = HotelAgent.asgi()        # then: uvicorn 05_serve:asgi
# or from the CLI:
#   agenta serve application:HotelAgent --port 8000


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
