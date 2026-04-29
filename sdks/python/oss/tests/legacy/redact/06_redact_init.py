import agenta as ag


def redact(name, field, io):
    print(">", name, field, io)

    if name == "embed" and field == "inputs":
        io = {key: value for key, value in io.items() if key not in ("description",)}

    if name == "embed" and field == "outputs":
        io = {key: value for key, value in io.items() if key not in ("embedding",)}

    print("<", io)

    return io


ag.init(redact=redact)


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
