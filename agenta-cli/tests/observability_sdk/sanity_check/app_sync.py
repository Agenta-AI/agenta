
import agenta as ag
from pydantic import BaseModel, Field

ag.init()

class MyConfig(BaseModel):
    prompt: str = Field(default="somevalue")

@ag.instrument(
    spankind="EMBEDDING",
    ignore_outputs=["ignored", "cost", "usage"],
)
def embed(description: str):
    print("embed")
    return {
        "embedding": "somedata",
        "ignored": "ignored",
        "cost": 15,
        "usage": 20,
    }


@ag.instrument(spankind="GENERATOR", ignore_inputs=True)
async def summarizer(topic: str, genre: str, report: dict) -> dict:

    return {"report": report}


@ag.entrypoint
@ag.instrument(spankind="WORKFLOW")
async def rag(topic: str, genre: str, count: int = 5):
    count = int(count)

    result = await embed("something")


    result = await summarizer("topic", "genre", "report")


    return result["report"]
