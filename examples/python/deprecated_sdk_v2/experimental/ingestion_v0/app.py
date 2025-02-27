from llama_index import (
    VectorStoreIndex,
    SimpleDirectoryReader,
    load_index_from_storage,
    StorageContext,
    Prompt,
)
import agenta as ag

import os


default_prompt = (
    "We have provided context information below. \n"
    "---------------------\n"
    "{context_str}"
    "\n---------------------\n"
    "Given this information, please answer the question: {query_str}\n"
)


@ag.post
def query(question: str, context: ag.Context) -> str:
    persist_dir = context.persist_dir
    storage_context = StorageContext.from_defaults(persist_dir=persist_dir)
    index = load_index_from_storage(storage_context)
    default_prompt = (
        "We have provided context information below. \n"
        "---------------------\n"
        "{context_str}"
        "\n---------------------\n"
        "Given this information, please answer the question: {query_str}\n"
    )

    QA_TEMPLATE = Prompt(default_prompt)
    query_engine = index.as_query_engine(text_qa_template=QA_TEMPLATE)
    response = query_engine.query(question)
    return str(response)
