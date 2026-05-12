import os
from typing import List, Dict
import litellm
from agenta.sdk.litellm import mockllm
from agenta.sdk.contexts.routing import RoutingContext

# Set up mockllm to use litellm
mockllm.litellm = litellm
import agenta as ag  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402
from agenta.sdk.types import PromptTemplate, MCField  # noqa: E402

system_prompt = """
    You are a helpful assistant that answers questions based on the documentation.
    """
user_prompt = """
    Here is the query: {query}

    Here is the context: {context}
    """
ag.init(host="http://localhost")

litellm.callbacks = [ag.callbacks.litellm_handler()]


class Config(BaseModel):
    my_prompt_1: PromptTemplate = Field(
        default=PromptTemplate(
            system_prompt="This is my system prompt 1 it uses {{context}}",
            user_prompt="And here is the user prompt",
        )
    )
    my_prompt_2: PromptTemplate = Field(
        default=PromptTemplate(
            system_prompt="This is my system prompt 2 it uses {{output_1}}",
            user_prompt="And here is the user prompt",
        )
    )
    multiselect: str = MCField(
        default="Option A", choices=["Option A", "Option B", "Option C"]
    )
    grouped_multiselect: str = MCField(
        default="Option A",
        choices={"Group 1": ["Option A", "Option B"], "Group 2": ["Option C"]},
    )
    bool_option: bool = Field(default=False)
    int_option: int = Field(default=10, lt=200, gt=0)
    float_option: float = Field(default=0.5, lt=1.0, gt=0.0)
    text_area: str = Field(default="my text area")


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
    config = ag.ConfigManager.get_from_route(Config)  # noqa: F841

    # Return dummy JSON output for testing
    formatted_results = [
        {
            "content": "This is sample document content for testing purposes.",
            "metadata": {
                "title": "Sample Document 1",
                "url": "https://example.com/doc1",
                "score": 0.95,
            },
        },
        {
            "content": "Another example document with different content.",
            "metadata": {
                "title": "Sample Document 2",
                "url": "https://example.com/doc2",
                "score": 0.87,
            },
        },
    ]

    return formatted_results


@ag.instrument()
async def llm(query: str, results: List[Dict]):
    # Set the mock in the routing context to use the 'hello' mock
    # You can replace 'hello' with any mock defined in the MOCKS dictionary
    ctx = RoutingContext.get()
    ctx.mock = "hello"

    config = ag.ConfigManager.get_from_route(Config)
    context = []
    for i, result in enumerate(results, 1):
        item = f"Result {i} (Score: {result['metadata']['score']:.3f})\n"
        item += f"Title: {result['metadata']['title']}\n"
        item += f"URL: {result['metadata']['url']}\n"
        item += f"Content: {result['content']}\n"
        item += "-" * 80 + "\n"
        context.append(item)

    ag.tracing.store_internals({"context": context})
    response = await mockllm.acompletion(
        **config.my_prompt_1.to_openai_kwargs(),
    )
    return response.choices[0].message.content


@ag.route("/", config_schema=Config)
@ag.instrument()
async def generate(query: str):
    results = search_docs(query)
    return await llm(query, results)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "agenta.sdk.decorators.routing:app", host="0.0.0.0", port=803, reload=True
    )
