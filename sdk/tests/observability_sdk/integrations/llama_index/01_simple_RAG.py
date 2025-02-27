import chromadb

from llama_index.core import (
    VectorStoreIndex,
    SimpleDirectoryReader,
    StorageContext,
)
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.embeddings.openai import OpenAIEmbedding
import agenta as ag
from opentelemetry.instrumentation.llamaindex import LlamaIndexInstrumentor

LlamaIndexInstrumentor().instrument()

ag.init()


@ag.instrument(spankind="WORKFLOW")
def rag_with_chroma():
    # Create persistent client to save embeddings
    chroma_client = chromadb.PersistentClient(path="./chroma_db")
    chroma_collection = chroma_client.get_or_create_collection("quickstart")

    # Set up vector store and storage context
    vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)

    # Configure embedding model
    embed_model = OpenAIEmbedding(model="text-embedding-3-large")

    # Load documents and create index
    documents = SimpleDirectoryReader("./data/paul_graham/").load_data()
    index = VectorStoreIndex.from_documents(
        documents, storage_context=storage_context, embed_model=embed_model
    )

    # Query the index
    query_engine = index.as_query_engine()
    return query_engine.query("What did the author do growing up?")


if __name__ == "__main__":
    rag_with_chroma()
