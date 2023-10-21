import agenta as ag
from dotenv import load_dotenv
from llama_index import VectorStoreIndex, Document, Prompt, ServiceContext
from llama_index.llms import OpenAI
from llama_index.embeddings.openai import (
    OpenAIEmbeddingMode,
    OpenAIEmbeddingModelType,
    OpenAIEmbedding,
)
from llama_index.node_parser import SimpleNodeParser
from llama_index.langchain_helpers.text_splitter import (
    TokenTextSplitter,
    SentenceSplitter,
)

DEFAULT_PROMPT = (
    "Please provide an answer based solely on the provided sources. "
    "When referencing information from a source, "
    "cite the appropriate source(s) using their corresponding numbers. "
    "Every answer should include at least one source citation. "
    "Only cite a source when you are explicitly referencing it. "
    "If none of the sources are helpful, you should indicate that. "
    "For example:\n"
    "Source 1:\n"
    "The sky is red in the evening and blue in the morning.\n"
    "Source 2:\n"
    "Water is wet when the sky is red.\n"
    "Query: When is water wet?\n"
    "Answer: Water will be wet when the sky is red [2], "
    "which occurs in the evening [1].\n"
    "Now it's your turn. Below are several numbered sources of information:"
    "\n------\n"
    "{context_str}"
    "\n------\n"
    "Query: {query_str}\n"
    "Answer: "
)


# ChatGpt 3.5 models
CHAT_LLM_GPT = [
    "gpt-3.5-turbo-16k-0613",
    "gpt-3.5-turbo-16k",
    "gpt-3.5-turbo-0613",
    "gpt-3.5-turbo-0301",
    "gpt-3.5-turbo",
    "gpt-4",
]

EMBEDDING_MODELS = {
    "DAVINCI": OpenAIEmbeddingModelType.DAVINCI,
    "CURIE": OpenAIEmbeddingModelType.CURIE,
    "BABBAGE": OpenAIEmbeddingModelType.BABBAGE,
    "ADA": OpenAIEmbeddingModelType.ADA,
    "TEXT_EMBED_ADA_002": OpenAIEmbeddingModelType.TEXT_EMBED_ADA_002,
}

EMBEDDING_MODES = {
    "SIMILARITY_MODE": OpenAIEmbeddingMode.SIMILARITY_MODE,
    "TEXT_SEARCH_MODE": OpenAIEmbeddingMode.TEXT_SEARCH_MODE,
}

TEXT_SPLITTERS = {
    "TokenTextSplitter": TokenTextSplitter,
    # "SentenceSplitter": SentenceSplitter ## Currently does not work
}

ag.init()
ag.config.default(
    prompt=ag.TextParam(DEFAULT_PROMPT),
    splitter_separator=ag.TextParam("\n"),
    paragraph_separator=ag.TextParam("\n\n\n"),
    temperature=ag.FloatParam(0.0),
    model=ag.MultipleChoiceParam(
        "gpt-3.5-turbo", CHAT_LLM_GPT
    ),
    embedding_model=ag.MultipleChoiceParam(
        "TEXT_EMBED_ADA_002", list(EMBEDDING_MODELS.keys())
    ),
    embedding_mode=ag.MultipleChoiceParam(
        "TEXT_SEARCH_MODE", list(EMBEDDING_MODES.keys())
    ),
    text_splitter=ag.MultipleChoiceParam(
        "TokenTextSplitter", list(TEXT_SPLITTERS.keys())
    ),
    text_splitter_chunk_size=ag.IntParam(1024, 0, 10000),
    text_splitter_chunk_overlap=ag.IntParam(20, 0, 10000),
)


@ag.entrypoint
def query(
    transcript: str,
    question: str,
) -> str:
    """Query a transcript with a question and return the answer.
    Args:
        transcript (str): The transcript to query.
        question (str): The question to ask.
    Returns:
        str: The answer to the question.
    """
    prompt = Prompt(ag.config.prompt)
    text_splitter = ag.config.text_splitter
    
    if text_splitter == "TokenTextSplitter":
        text_splitter = TEXT_SPLITTERS[text_splitter](
            separator=ag.config.splitter_separator,
            chunk_size=ag.config.text_splitter_chunk_size,
            chunk_overlap=ag.config.text_splitter_chunk_overlap,
        )
    elif text_splitter == "SentenceSplitter":
        text_splitter = TEXT_SPLITTERS[text_splitter](
            separator=ag.config.splitter_separator,
            chunk_size=ag.config.text_splitter_chunk_size,
            chunk_overlap=ag.config.text_splitter_chunk_overlap,
            paragraph_separator=ag.config.text_splitter_chunk_overlap,
        )

    # define a service context for the OpenAI to model and temperature
    service_context = ServiceContext.from_defaults(
        llm=OpenAI(temperature=ag.config.temperature, model=ag.config.model),
        embed_model=OpenAIEmbedding(
            mode=EMBEDDING_MODES[ag.config.embedding_mode],
            model=EMBEDDING_MODELS[ag.config.embedding_model],
        ),
        node_parser=SimpleNodeParser(text_splitter=text_splitter),
    )
    # build a vector store index from the transcript as message documents
    index = VectorStoreIndex.from_documents(
        documents=[Document(text=transcript)], service_context=service_context
    )

    query_engine = index.as_query_engine(
        text_qa_template=prompt, service_context=service_context
    )
    response = query_engine.query(question)
    return str(response)
