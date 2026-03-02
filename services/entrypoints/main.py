from fastapi import FastAPI

import agenta as ag

from oss.src.chat import chat_app
from oss.src.completion import completion_app


ag.init()

# Create main app that will mount sub-applications
app = FastAPI()

# Mount both apps under their respective paths
app.mount("/chat", chat_app)
app.mount("/completion", completion_app)


# Health check endpoint
@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    from uvicorn import run

    run(
        "entrypoints.main:app",
        host="0.0.0.0",
        port=80,
        reload=True,
        reload_dirs=[".", "/sdk"],
    )
