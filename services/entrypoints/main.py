from fastapi import FastAPI

import agenta as ag

from oss.src.canonical import (
    builtin_agent_app,
    builtin_match_app,
    builtin_prompt_app,
    custom_code_app,
    custom_hook_app,
    custom_trace_app,
)
from oss.src.chat import chat_app
from oss.src.completion import completion_app


ag.init()

# Create main app that will mount sub-applications
app = FastAPI()

# Mount both apps under their respective paths
app.mount("/chat", chat_app)
app.mount("/completion", completion_app)
app.mount("/custom/code/v0", custom_code_app)
app.mount("/custom/hook/v0", custom_hook_app)
app.mount("/custom/trace/v0", custom_trace_app)
app.mount("/builtin/match/v0", builtin_match_app)
app.mount("/builtin/prompt/v0", builtin_prompt_app)
app.mount("/builtin/agent/v0", builtin_agent_app)


# Health check endpoint
@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    from uvicorn import run

    run(
        "entrypoints.main:app",
        host="0.0.0.0",
        port=8080,
        reload=True,
        reload_dirs=[".", "/sdk"],
    )
