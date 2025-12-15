"""FastAPI server for RAG chatbot."""

import json
from typing import List

import agenta as ag
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from openinference.instrumentation.litellm import LiteLLMInstrumentor
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from .config import settings
from .rag import generate, retrieve

# Initialize Agenta for observability
ag.init(api_key=settings.AGENTA_API_KEY, host=settings.AGENTA_HOST)

# Instrument LiteLLM for tracing
LiteLLMInstrumentor().instrument()

app = FastAPI(
    title="RAG QA Chatbot API",
    description="A RAG-powered chatbot for documentation Q&A",
    version="0.1.0",
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatMessage(BaseModel):
    """A chat message."""

    role: str
    content: str


class ChatRequest(BaseModel):
    """Request body for chat endpoint."""

    messages: List[ChatMessage]


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.post("/api/chat")
async def chat(request: ChatRequest):
    """
    Chat endpoint that streams responses using Server-Sent Events.

    Compatible with the Vercel AI SDK useChat hook.
    """

    async def event_generator():
        # Get the last user message
        user_messages = [m for m in request.messages if m.role == "user"]
        if not user_messages:
            return

        query = user_messages[-1].content

        # Create a new trace for this request
        with ag.tracing.start_span(name="chat_request") as span:
            # First, retrieve relevant documents
            docs = retrieve(query)

            # Send sources as data parts
            for doc in docs[:5]:  # Limit to top 5 sources
                source_data = {
                    "type": "source-url",
                    "url": doc.url,
                }
                yield {"event": "data", "data": json.dumps([source_data])}

            # Stream the response using retrieved docs
            full_response = ""
            async for chunk in generate(query, docs):
                full_response += chunk
                # Format for Vercel AI SDK text streaming
                yield {"event": "data", "data": json.dumps(chunk)}

            # Send trace URL as data part
            trace_id = span.get_trace_id()
            if trace_id:
                trace_url = f"{settings.AGENTA_HOST}/observability/traces/{trace_id}"
                trace_data = {
                    "type": "data-trace",
                    "data": {"url": trace_url},
                }
                yield {"event": "data", "data": json.dumps([trace_data])}

            # Signal end of stream
            yield {"event": "data", "data": "[DONE]"}

    return EventSourceResponse(event_generator())


@app.get("/api/retrieve")
async def retrieve_docs(query: str, top_k: int = 5):
    """
    Retrieve relevant documents for a query.

    Useful for debugging or building custom UIs.
    """
    docs = retrieve(query, top_k=top_k)
    return {
        "query": query,
        "documents": [
            {
                "title": doc.title,
                "url": doc.url,
                "content": doc.content,
                "score": doc.score,
            }
            for doc in docs
        ],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
