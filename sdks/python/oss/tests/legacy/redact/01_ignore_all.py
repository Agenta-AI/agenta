import agenta as ag

ag.init()


@ag.entrypoint
@ag.instrument(
    spankind="WORKFLOW",
    ignore_inputs=True,
    ignore_outputs=True,
)
def embed(description: str):
    return {
        "embedding": "somedata",
        "ignored": "ignored",
        "cost": 15,
        "usage": 20,
    }
