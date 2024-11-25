import agenta as ag
from agenta import TextParam, FloatParam
from dotenv import load_dotenv
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate


default_prompt = """
Translate the text below to {language}.

Make translations varies between veeery good and veeery bad.

{text}
"""

ag.init()
ag.config.default(
    temperature=FloatParam(0.5),
    prompt_template=TextParam(default_prompt),
)


@ag.entrypoint
def generate(
    text: str,
    language: str,
) -> str:
    load_dotenv()
    llm = OpenAI(temperature=ag.config.temperature)
    prompt = PromptTemplate(
        input_variables=["text", "language"], template=ag.config.prompt_template
    )

    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(text=text, language=language)
    return output.strip()
