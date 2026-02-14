import os
from typing import List, Dict
from qdrant_client import QdrantClient
from litellm import embedding, completion, rerank
import agenta as ag
from pydantic import BaseModel, Field
from agenta.sdk.types import MCField
from agenta.sdk.assets import supported_llm_models

system_prompt = """
    You are a helpful assistant that answers questions based on the documentation.
    """
user_prompt = """
    Here is the query: {query}

    Here is the context: {context}
    """
ag.init()

# litellm.callbacks = [ag.callbacks.litellm_handler()]

# Initialize Qdrant client
qdrant_client = QdrantClient(
    url=os.getenv("QDRANT_URL"), api_key=os.getenv("QDRANT_API_KEY")
)


class Config(BaseModel):
    system_prompt: str = Field(default=system_prompt)
    user_prompt: str = Field(default=user_prompt)
    embedding_model: str = MCField(default="openai", choices=["openai", "cohere"])
    llm_model: str = MCField(default="gpt-5", choices=supported_llm_models)
    top_k: int = Field(default=10, ge=1, le=25)
    rerank_top_k: int = Field(default=3, ge=1, le=10)
    use_rerank: bool = Field(default=True)


def get_embeddings(text: str, model: str) -> Dict[str, List[float]]:
    """Get embeddings using both OpenAI and Cohere models via LiteLLM."""
    if model == "openai":
        return embedding(model="text-embedding-ada-002", input=[text])["data"][0][
            "embedding"
        ]
    elif model == "cohere":
        return embedding(
            model="cohere/embed-english-v3.0",
            input=[text],
            input_type="search_query",  # Use search_query for queries
        )["data"][0]["embedding"]

    raise ValueError(f"Unknown model: {model}")


@ag.instrument()
def search_docs(
    query: str, collection_name: str = os.getenv("COLLECTION_NAME", "docs_collection")
) -> List[Dict]:
    """
    Search the documentation using both OpenAI and Cohere embeddings.

    Args:
        query: The search query
        limit: Maximum number of results to return
        score_threshold: Minimum similarity score (0-1) for results
        collection_name: Name of the Qdrant collection to search

    Returns:
        List of dictionaries containing matched documents and their metadata
    """
    # Get embeddings for the query
    config = ag.ConfigManager.get_from_route(Config)

    # Search using both embeddings
    results = qdrant_client.query_points(
        collection_name=collection_name,
        query=get_embeddings(query, config.embedding_model),
        using=config.embedding_model,
        limit=config.top_k,
    )
    # Format results
    formatted_results = []
    for result in results.points:
        formatted_result = {
            "content": result.payload["content"],
            "metadata": {
                "title": result.payload["title"],
                "url": result.payload["url"],
                "score": result.score,
            },
        }
        formatted_results.append(formatted_result)

    return formatted_results


@ag.instrument()
def llm(query: str, results: List[Dict]):
    config = ag.ConfigManager.get_from_route(Config)
    context = []
    for i, result in enumerate(results, 1):
        score = result["metadata"].get("rerank_score", result["metadata"]["score"])
        item = f"Result {i} (Score: {score:.3f})\n"
        item += f"Title: {result['metadata']['title']}\n"
        item += f"URL: {result['metadata']['url']}\n"
        item += f"Content: {result['content']}\n"
        item += "-" * 80 + "\n"
        context.append(item)

    ag.tracing.store_internals({"context": context})
    response = completion(
        model=config.llm_model,
        messages=[
            {"role": "system", "content": config.system_prompt},
            {
                "role": "user",
                "content": config.user_prompt.format(
                    query=query, context="".join(context)
                ),
            },
        ],
    )
    return response.choices[0].message.content


@ag.instrument()
def rerank_results(query: str, results: List[Dict]) -> List[Dict]:
    """Rerank the search results using Cohere's reranker."""
    config = ag.ConfigManager.get_from_route(Config)
    # Format documents for reranking
    documents = [result["content"] for result in results]

    # Perform reranking
    reranked = rerank(
        model="cohere/rerank-english-v3.0",
        query=query,
        documents=documents,
        top_n=config.rerank_top_k,
    )
    # Reorder the original results based on reranking
    reranked_results = []
    for item in reranked.results:
        # The rerank function returns dictionaries with 'document' and 'index' keys
        reranked_results.append(results[item["index"]])
        # Add rerank score to metadata
        reranked_results[-1]["metadata"]["rerank_score"] = item["relevance_score"]

    return reranked_results


@ag.route("/", config_schema=Config)
@ag.instrument()
def generate(query: str):
    config = ag.ConfigManager.get_from_route(Config)
    results = search_docs(query)
    if config.use_rerank:
        reranked_results = rerank_results(query, results)
        return llm(query, reranked_results)
    else:
        return llm(query, results)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("agenta:app", host="0.0.0.0", port=8000, reload=True)
