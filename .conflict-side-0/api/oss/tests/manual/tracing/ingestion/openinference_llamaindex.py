# /// script
# dependencies = ["agenta", "llama_index", "openinference-instrumentation-llama_index"]
# ///

from openinference.instrumentation.llama_index import LlamaIndexInstrumentor
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader

import agenta as ag
from dotenv import load_dotenv

load_dotenv(override=True)

ag.init()

LlamaIndexInstrumentor().instrument()


@ag.instrument()
def llama_index_app(query: str):
    documents = SimpleDirectoryReader("data").load_data()
    index = VectorStoreIndex.from_documents(documents)
    query_engine = index.as_query_engine()
    response = query_engine.query(query)
    print(response)


llama_index_app("What is Agenta?")
