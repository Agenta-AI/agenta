from agenta import post, TextParam, FloatParam
from dotenv import load_dotenv
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate
import os


default_prompt = """
Translate the text below to {language}.

Make translations varies between veeery good and veeery bad.

{text}
"""


@post
def generate(
    text: str,
    language: str,
    prompt_template: TextParam = default_prompt,
    temperature: FloatParam = 0.5,
) -> str:
    load_dotenv()
    llm = OpenAI(temperature=temperature)
    prompt = PromptTemplate(
        input_variables=["text", "language"], template=prompt_template
    )

    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(text=text, language=language)
    return output.strip()
