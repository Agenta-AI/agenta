import agenta
from llama_index import VectorStoreIndex, SimpleDirectoryReader, load_index_from_storage, StorageContext, Prompt
import os
from pathlib import Path
from context import Context, save_context


# def test(index):
#     default_prompt = (
#         "We have provided context information below. \n"
#         "---------------------\n"
#         "{context_str}"
#         "\n---------------------\n"
#         "Given this information, please answer the question: {query_str}\n"
#     )

#     QA_TEMPLATE = Prompt(default_prompt)
#     #
#     query_engine = index.as_query_engine(text_qa_template=QA_TEMPLATE)
#     response = query_engine.query("what are the pains of the customer?")
#     return str(response)


@agenta.ingest
def ingest(file: agenta.InFile):
    context_name = file.file_name
    persist_dir = f"./{context_name}"
    if not os.path.exists(persist_dir):
        documents = SimpleDirectoryReader(input_files=[file.file_path]).load_data()
        index = VectorStoreIndex.from_documents(documents)
        index.storage_context.persist(persist_dir=persist_dir)
    else:
        storage_context = StorageContext.from_defaults(persist_dir=persist_dir)
        index = load_index_from_storage(storage_context)
    c = Context(persist_dir=context_name)
    save_context(c)
    return Context(persist_dir=context_name)
