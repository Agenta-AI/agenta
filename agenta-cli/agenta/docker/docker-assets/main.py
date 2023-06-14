from uvicorn import run
import agenta
import app  # This will register the routes with the FastAPI application
import os
try:
    import ingest
except ImportError:
    pass


if __name__ == "__main__":
    assert os.environ["ROOT_PATH"] != ""
    run("agenta:app", host="0.0.0.0", port=80, root_path=os.environ["ROOT_PATH"])
