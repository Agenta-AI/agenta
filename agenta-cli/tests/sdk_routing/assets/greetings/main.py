from os import getenv

from uvicorn import run  # type: ignore

import app  # type: ignore
import agenta  # pylint: disable=unused-import


HOST = getenv("HOST", "0.0.0.0")
PORT = int(getenv("PORT", "8888"))

if __name__ == "__main__":
    run("agenta:app", host=HOST, port=PORT)
