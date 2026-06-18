"""Standalone, credential-free app that serves ONLY the contract-proving mock stream.

Run this to exercise the agent chat streaming contract (contract v1) without Qdrant,
OpenAI, or Agenta credentials:

    uvicorn backend.contract_main:app --port 8000 --reload

The frontend slice points `useChat` at POST /api/agent/chat. The real RAG service in
`backend/main.py` is unchanged and also mounts the same router (see main.py).
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .contract_stream import router as contract_router

app = FastAPI(title="Agent Chat Contract Mock", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(contract_router)


@app.get("/health")
async def health():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
