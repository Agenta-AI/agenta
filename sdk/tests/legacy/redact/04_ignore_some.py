import agenta as ag

ag.init()


@ag.entrypoint
@ag.instrument(
    spankind="WORKFLOW",
    ignore_inputs=["description"],
    ignore_outputs=["embedding", "ignored"],
)
def embed(description: str, theme: str):
    return {
        "embedding": "somedata",
        "ignored": "ignored",
        "cost": 15,
        "usage": 20,
    }
