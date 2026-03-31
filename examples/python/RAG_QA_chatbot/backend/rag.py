"""RAG logic: retrieve and generate."""

from dataclasses import dataclass
from typing import AsyncGenerator, List, Optional, Tuple

import agenta as ag
from agenta.sdk.managers.shared import SharedManager
from agenta.sdk.types import PromptTemplate
from litellm import acompletion, embedding
from qdrant_client import QdrantClient

from .config import settings


@dataclass
class RetrievedDoc:
    """A retrieved document with content and metadata."""

    content: str
    title: str
    url: str
    score: float


def get_qdrant_client() -> QdrantClient:
    """Create a Qdrant client."""
    return QdrantClient(url=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY)


def get_query_embedding(text: str, model: str = "openai") -> list[float]:
    """Get embedding for a query."""
    if model == "openai":
        response = embedding(model="text-embedding-ada-002", input=[text])
    elif model == "cohere":
        response = embedding(
            model="cohere/embed-english-v3.0",
            input=[text],
            input_type="search_query",
        )
    else:
        raise ValueError(f"Unknown embedding model: {model}")

    return response["data"][0]["embedding"]


@ag.instrument()
def retrieve(
    query: str,
    top_k: Optional[int] = None,
    collection_name: Optional[str] = None,
    embedding_model: Optional[str] = None,
) -> List[RetrievedDoc]:
    """
    Retrieve relevant documents from the vector store.

    Args:
        query: The search query
        top_k: Number of results to return
        collection_name: Qdrant collection name
        embedding_model: Which embedding to use (openai or cohere)

    Returns:
        List of retrieved documents with scores
    """
    top_k = top_k or settings.TOP_K
    collection_name = collection_name or settings.COLLECTION_NAME
    embedding_model = embedding_model or settings.EMBEDDING_MODEL

    # Get query embedding
    query_embedding = get_query_embedding(query, model=embedding_model)

    # Search Qdrant
    client = get_qdrant_client()
    results = client.query_points(
        collection_name=collection_name,
        query=query_embedding,
        using=embedding_model,
        limit=top_k,
    )

    # Format results
    docs = []
    for point in results.points:
        docs.append(
            RetrievedDoc(
                content=point.payload["content"],
                title=point.payload["title"],
                url=point.payload["url"],
                score=point.score,
            )
        )

    # Store retrieval metadata in trace
    ag.tracing.store_internals(
        {
            "retrieved_docs_count": len(docs),
            "top_k": top_k,
            "embedding_model": embedding_model,
            "collection_name": collection_name,
        }
    )

    return docs


def format_context(docs: List[RetrievedDoc]) -> str:
    """Format retrieved documents as context for the LLM."""
    context_parts = []
    for i, doc in enumerate(docs, 1):
        part = f"[{i}] {doc.title}\n"
        part += f"URL: {doc.url}\n"
        part += f"Content: {doc.content}\n"
        context_parts.append(part)

    return "\n---\n".join(context_parts)


# Fallback prompts if Agenta config is unavailable
SYSTEM_PROMPT = """You are a helpful assistant that answers questions based on the provided documentation.
Use the context below to answer the user's question. If the answer is not in the context, say so.
When referencing information, mention the source title."""

USER_PROMPT_TEMPLATE = """Context:
{context}

Question: {query}

Answer based on the context above:"""


@ag.instrument()
async def get_prompt_config() -> Optional[Tuple]:
    """
    Fetch prompt configuration from Agenta registry.

    Returns:
        Tuple of (config, refs) if successful, None otherwise.
    """
    try:
        config = await SharedManager.afetch(
            app_slug="support-rag-prompt",
            environment_slug="production",
        )

        refs = {
            ag.Reference.APPLICATION_ID.value: config.app_id,
            ag.Reference.APPLICATION_SLUG.value: config.app_slug,
            ag.Reference.VARIANT_ID.value: config.variant_id,
            ag.Reference.VARIANT_SLUG.value: config.variant_slug,
            ag.Reference.VARIANT_VERSION.value: str(config.variant_version),
            ag.Reference.ENVIRONMENT_ID.value: config.environment_id,
            ag.Reference.ENVIRONMENT_SLUG.value: config.environment_slug,
            ag.Reference.ENVIRONMENT_VERSION.value: str(config.environment_version),
        }

        return (config, refs)
    except Exception:
        import traceback

        traceback.print_exc()
        # Fallback to None if fetching fails
        return None


@ag.instrument()
async def generate(
    query: str,
    context: str,
    model: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """
    Generate a response using the LLM with streaming.

    Args:
        query: The user's question
        context: Retrieved documents formatted as context string
        model: LLM model to use

    Yields:
        Chunks of the generated response
    """
    model = model or settings.LLM_MODEL

    # Try to fetch prompt from Agenta, fallback to default if unavailable
    result = await get_prompt_config()
    if result:
        config, refs = result
        ag.tracing.store_refs(refs)
        params = config.params
    else:
        params = None

    if params and "prompt" in params:
        try:
            # Use PromptTemplate from Agenta
            prompt_template = PromptTemplate(**params["prompt"])
            # Format the prompt with context and query variables
            formatted_prompt = prompt_template.format(context=context, query=query)
            # Get OpenAI-compatible kwargs
            openai_kwargs = formatted_prompt.to_openai_kwargs()
            # Extract messages and update model if needed
            messages = openai_kwargs.get("messages", [])
            # Use model from prompt config if available, otherwise use the provided model
            prompt_model = openai_kwargs.get("model", model)

            response = await acompletion(
                model=prompt_model,
                messages=messages,
                stream=True,
            )
        except Exception:
            # Fallback to default prompts if formatting fails
            response = await acompletion(
                model=model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": USER_PROMPT_TEMPLATE.format(
                            context=context, query=query
                        ),
                    },
                ],
                stream=True,
            )
    else:
        # Fallback to default prompts if config fetch failed
        response = await acompletion(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": USER_PROMPT_TEMPLATE.format(
                        context=context, query=query
                    ),
                },
            ],
            stream=True,
        )

    async for chunk in response:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


async def rag_query(query: str) -> AsyncGenerator[str, None]:
    """
    Full RAG pipeline: retrieve then generate.

    Args:
        query: The user's question

    Yields:
        Chunks of the generated response
    """
    # Retrieve relevant docs
    docs = retrieve(query)

    # Generate response
    async for chunk in generate(query, format_context(docs)):
        yield chunk
