from llama_index import VectorStoreIndex, SimpleDirectoryReader, load_index_from_storage, StorageContext, Prompt


def ingest(file_path):
    if not os.path.exists("./storage"):
        documents = SimpleDirectoryReader('data').load_data()
        index = VectorStoreIndex.from_documents(documents)
        index.storage_context.persist()
    else:
        storage_context = StorageContext.from_defaults(persist_dir="./storage")
        # rebuild storage context
        index = load_index_from_storage(storage_context)
    return index
