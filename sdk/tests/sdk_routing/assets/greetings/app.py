from importlib.metadata import version

import agenta as ag


ag.init(host="http://localhost")
ag.config.default(
    flag=ag.BinaryParam(value=True),
)


class CustomException(Exception):
    def __init__(self, message):
        self.message = message
        self.status_code = 401

    def __str__(self):
        return self.message


@ag.entrypoint
@ag.instrument(spankind="workflow")
async def greetings(name: str):
    message = "Hello, World!"

    if ag.config.flag:
        message = f"Hello, {name}! (version={version('agenta')})"

    return message
