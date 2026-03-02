"""FastAPI server for RAG chatbot."""

import json
import uuid
from typing import Any, Dict, List, Optional

import agenta as ag
import litellm
from opentelemetry.trace import format_trace_id
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, model_validator
from fastapi.responses import StreamingResponse

from .config import settings
from .rag import format_context, generate, retrieve

# Initialize Agenta for observability
ag.init(api_key=settings.AGENTA_API_KEY, host=settings.AGENTA_HOST)

# Set the Agenta LiteLLM callback for token/cost tracking
litellm.callbacks = [ag.callbacks.litellm_handler()]

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
    """A chat message. Accepts both AI SDK v3 (content string) and v4+ (parts array) formats."""

    role: str
    content: Optional[str] = None
    parts: Optional[List[Dict[str, Any]]] = None

    @model_validator(mode="after")
    def resolve_content(self) -> "ChatMessage":
        """Normalize parts-based messages (AI SDK v4+) to a content string."""
        if self.content is None and self.parts:
            texts = [p["text"] for p in self.parts if p.get("type") == "text"]
            self.content = " ".join(texts)
        return self

    def get_text(self) -> str:
        return self.content or ""


class ChatRequest(BaseModel):
    """Request body for chat endpoint."""

    messages: List[ChatMessage]

    model_config = {"extra": "ignore"}  # tolerate id, trigger, etc. from AI SDK v4+


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

    async def stream_generator():
        def event(obj) -> str:
            return f"data: {json.dumps(obj)}\n\n"

        user_messages = [m for m in request.messages if m.role == "user"]
        if not user_messages:
            yield event({"type": "finish"})
            yield "data: [DONE]\n\n"
            return

        query = user_messages[-1].get_text()
        message_id = str(uuid.uuid4())
        text_id = str(uuid.uuid4())

        yield event({"type": "start", "messageId": message_id})

        with ag.tracer.start_as_current_span("chat_request") as span:
            root = ag.tracing.get_current_span()
            root.set_attributes({"inputs": {"query": query}}, namespace="data")

            docs = retrieve(query)
            context = format_context(docs)

            # Source URLs
            for doc in docs[:5]:
                yield event({"type": "source-url", "sourceId": doc.url, "url": doc.url})

            # Streamed text
            full_response = ""
            yield event({"type": "text-start", "id": text_id})
            async for chunk in generate(query, context):
                full_response += chunk
                yield event({"type": "text-delta", "id": text_id, "delta": chunk})
            yield event({"type": "text-end", "id": text_id})

            root.set_attributes(
                {"outputs": {"response": full_response}}, namespace="data"
            )

            # Trace URL as custom data part
            ctx = span.get_span_context()
            if ctx.is_valid:
                trace_id = format_trace_id(ctx.trace_id)
                trace_url = f"{settings.AGENTA_HOST}/observability/traces/{trace_id}"
                yield event({"type": "data-trace", "data": {"url": trace_url}})

            yield event({"type": "finish"})
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        stream_generator(),
        media_type="text/event-stream",
        headers={
            "x-vercel-ai-ui-message-stream": "v1",
            "cache-control": "no-cache",
        },
    )


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
