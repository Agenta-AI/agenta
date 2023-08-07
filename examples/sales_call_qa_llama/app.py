from agenta import post, FloatParam, TextParam
from dotenv import load_dotenv
from llama_index import VectorStoreIndex, Document, Prompt, ServiceContext
from llama_index.llms import OpenAI

load_dotenv()

DEFAULT_PROMPT = (
    "We have provided context information below. \n"
    "---------------------\n"
    "{context_str}"
    "\n---------------------\n"
    "Given this information, please answer the question: {query_str}\n"
)


def build_query_engine(transcript: str, prompt: str, temperature: float, model: str):
    """Build a LLamaIndex query engine from a transcript and prompt."""
    # define the structured prompt template
    prompt = Prompt(prompt)
    # build a vector store index from the transcript as message documents
    index = VectorStoreIndex.from_documents(
        [Document(text=message) for message in transcript.split("\n\n")]
    )
    # define a service context for the OpenAI to model and temperature
    service_context = ServiceContext.from_defaults(
        llm=OpenAI(temperature=temperature, model=model)
    )
    query_engine = index.as_query_engine(
        text_qa_template=prompt, service_context=service_context
    )
    return query_engine


@post
def query(
    transcript: str,
    question: str,
    temperature: FloatParam = 0.0,
    model: TextParam = "gpt-3.5-turbo",
    prompt: TextParam = DEFAULT_PROMPT,
) -> str:
    """Query a transcript with a question and return the answer.
    Args:
        transcript (str): The transcript to query.
        question (str): The question to ask.
        temperature (float): The temperature to use for the OpenAI model.
        model (str): The OpenAI model to use.
        prompt (str): The prompt template to wrap around the context and query.
    Returns:
        str: The answer to the question.
    """
    query_engine = build_query_engine(transcript, prompt, temperature, model)
    response = query_engine.query(question)
    return str(response)
