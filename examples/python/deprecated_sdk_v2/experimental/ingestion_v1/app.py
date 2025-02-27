import os
import agenta as ag
from llama_index import (
    VectorStoreIndex,
    SimpleDirectoryReader,
    load_index_from_storage,
    StorageContext,
    Prompt,
)


@ag.ingest
def ingest(file1: ag.InFile):
    persist_dir = f"./storage/{file1.file_name}"
    if os.path.exists(persist_dir):
        return None
    documents = SimpleDirectoryReader(input_files=[file1.file_path]).load_data()
    index = VectorStoreIndex.from_documents(documents)
    index.storage_context.persist(persist_dir=persist_dir)
    return ag.Context(persist_dir=persist_dir)


default_prompt = (
    "We have provided context information below. \n"
    "---------------------\n"
    "{context_str}"
    "\n---------------------\n"
    "Given this information, please answer the question: {query_str}\n"
)


@ag.post
def query(
    question: str,
    context: ag.Context,
    prompt: ag.TextParam = default_prompt,
    temperature: ag.FloatParam = 0.9,
) -> str:
    persist_dir = context.persist_dir
    storage_context = StorageContext.from_defaults(persist_dir=persist_dir)
    index = load_index_from_storage(storage_context)

    query_engine = index.as_query_engine(text_qa_template=Prompt(prompt))
    response = query_engine.query(question)
    return str(response) + "\n" + str(temperature)
