from uvicorn import run

import agenta
import app  # This will register the routes with the FastAPI application
from dotenv import load_dotenv  # Import the load_dotenv function

if __name__ == "__main__":
    load_dotenv()  # Load the environment variables from .env
    run("agenta:app", host="0.0.0.0", port=90, reload=True)
