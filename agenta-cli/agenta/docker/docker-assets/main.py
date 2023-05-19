from uvicorn import run

import agenta
import app  # This will register the routes with the FastAPI application
from dotenv import load_dotenv  # I∑mport the load_dotenv function

if __name__ == "__main__":
    run("agenta:app", host="0.0.0.0", port=80)
