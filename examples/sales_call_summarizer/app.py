from agenta import post, TextParam, FloatParam
from agenta import post
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate
from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage, SystemMessage


@post
def generate(
    transcript: str,
    system_prompt: TextParam = "Please summarize the following transcript:",
    temperature: FloatParam = 0.5,
    top_p: FloatParam = 1.0,
    presence_penalty: FloatParam = 0.0,
    frequency_penalty: FloatParam = 0.0,
) -> str:
    chat = ChatOpenAI(
        model="gpt-3.5-turbo-16k",
        temperature=temperature,
        top_p=top_p,
        presence_penalty=presence_penalty,
        frequency_penalty=frequency_penalty,
    )
    messages = [SystemMessage(content=system_prompt), HumanMessage(content=transcript)]

    response = chat(
        messages,
    ).content
    return response
