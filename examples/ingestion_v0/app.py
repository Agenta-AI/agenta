from llama_index import VectorStoreIndex, SimpleDirectoryReader, load_index_from_storage, StorageContext, Prompt
from agenta import post, FloatParam, TextParam
import os


default_prompt = (
    "We have provided context information below. \n"
    "---------------------\n"
    "{context_str}"
    "\n---------------------\n"
    "Given this information, please answer the question: {query_str}\n"
)


@post
def query(question: str, prompt: TextParam = default_prompt) -> str:

    QA_TEMPLATE = Prompt(prompt)
    #
    query_engine = index.as_query_engine(text_qa_template=QA_TEMPLATE)
    response = query_engine.query(question)
    return str(response)
