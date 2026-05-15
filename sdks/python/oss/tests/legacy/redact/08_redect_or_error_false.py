import agenta as ag


def redact(name, field, io):
    raise Exception("error")


ag.init(
    redact=redact,
    redact_on_error=False,
)


@ag.entrypoint
@ag.instrument(
    spankind="WORKFLOW",
)
def embed(description: str, theme: str):
    return {
        "embedding": "somedata",
        "ignored": "ignored",
        "cost": 15,
        "usage": 20,
    }
