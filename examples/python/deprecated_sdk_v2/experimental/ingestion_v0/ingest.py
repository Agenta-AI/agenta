import agenta
from llama_index import (
    VectorStoreIndex,
    SimpleDirectoryReader,
    load_index_from_storage,
    StorageContext,
    Prompt,
)
import os
from pathlib import Path
import agenta as ag


def test(index, question):
    default_prompt = (
        "We have provided context information below. \n"
        "---------------------\n"
        "{context_str}"
        "\n---------------------\n"
        "Given this information, please answer the question: {query_str}\n"
    )

    QA_TEMPLATE = Prompt(default_prompt)
    #
    query_engine = index.as_query_engine(text_qa_template=QA_TEMPLATE)
    response = query_engine.query(question)
    return str(response)


@ag.ingest
def ingest(file1: ag.InFile, file2: ag.InFile, question: str):
    persist_dir = f"./storage/{file1.file_name}_{file2.file_name}"
    if not os.path.exists(persist_dir):
        documents = SimpleDirectoryReader(
            input_files=[file1.file_path, file2.file_path]
        ).load_data()
        index = VectorStoreIndex.from_documents(documents)
        index.storage_context.persist(persist_dir=persist_dir)
    else:
        print("Loading from storage")
        storage_context = StorageContext.from_defaults(persist_dir=persist_dir)
        index = load_index_from_storage(storage_context)
    c = ag.Context(persist_dir=persist_dir)
    ag.save_context(c)
    return ag.Context(persist_dir=persist_dir)
