import agenta
import oss.src.service  # This will register the routes with the FastAPI application

# Expose the FastAPI app for Gunicorn
app = agenta.app

if __name__ == "__main__":
    # For development only - production should use Gunicorn
    from uvicorn import run

    run(
        "main:app",
        host="0.0.0.0",
        port=80,
        reload=True,
        reload_dirs=[".", "/sdk"],
    )
