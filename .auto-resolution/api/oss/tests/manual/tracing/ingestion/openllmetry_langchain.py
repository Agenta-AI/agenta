# /// script
# dependencies = ["agenta", "langchain_community", "langchain", "langchain_openai", "opentelemetry-instrumentation-langchain"]
# ///

from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from opentelemetry.instrumentation.langchain import LangchainInstrumentor

import agenta as ag
from dotenv import load_dotenv

load_dotenv(override=True)

ag.init()

LangchainInstrumentor().instrument()


def langchain_app():
    # LangChain will automatically use OpenTelemetry to send traces to LangSmith
    # because the LANGSMITH_OTEL_ENABLED environment variable is set

    # Create a chain
    prompt = ChatPromptTemplate.from_template("Tell me a joke about {topic}")
    model = ChatOpenAI()
    chain = prompt | model

    # Run the chain
    result = chain.invoke({"topic": "programming"})
    print(result.content)


langchain_app()
