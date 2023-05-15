from uvicorn import run

import agenta
import app  # This will register the routes with the FastAPI application

if __name__ == "__main__":
    run("agenta:app", host="0.0.0.0", port=80)
