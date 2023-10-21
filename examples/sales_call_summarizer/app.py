import agenta as ag
from agenta import TextParam, FloatParam
from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage, SystemMessage

ag.init()
ag.config.default(
    top_p=FloatParam(1.0),
    temperature=FloatParam(0.5),
    presence_penalty=FloatParam(0.0),
    frequency_penalty=FloatParam(0.0),
    system_prompt=TextParam("Please summarize the following transcript:"),
)

@ag.entrypoint
def generate(
    transcript: str,
) -> str:
    chat = ChatOpenAI(
        model="gpt-3.5-turbo-16k",
        temperature=ag.config.temperature,
        top_p=ag.config.top_p,
        presence_penalty=ag.config.presence_penalty,
        frequency_penalty=ag.config.frequency_penalty,
    )
    messages = [SystemMessage(content=ag.config.system_prompt), HumanMessage(content=transcript)]

    response = chat(
        messages,
    ).content
    return response
