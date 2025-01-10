from uvicorn import run
import os

os.environ["AGENTA_UNAUTHORIZED_EXECUTION_ALLOWED"] = "True"
os.environ["AGENTA_HOST"] = "http://host.docker.internal"

import agenta
import _app  # This will register the routes with the FastAPI application


if __name__ == "__main__":
    run(
        "agenta:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=[".", "/Users/mahmoudmabrouk/agenta/code/agenta-core/agenta-cli"],
    )
