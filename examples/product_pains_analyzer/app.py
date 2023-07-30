from agenta import post, TextParam, FloatParam
from dotenv import load_dotenv
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate
import os


default_prompt = """
We are a company that have a product and we are getting a feedback from a user regarding this pain: {pain_name}.
Generate a user's feedback complaining about this pain in 1 or max 2 sentences.
"""


@post
def generate(pain_name: str, prompt_template: TextParam = default_prompt, temperature: FloatParam = 0.5) -> str:
    load_dotenv()
    llm = OpenAI(temperature=temperature)
    prompt = PromptTemplate(
        input_variables=["pain_name"],
        template=prompt_template)

    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(pain_name=pain_name)
    return output.strip()
