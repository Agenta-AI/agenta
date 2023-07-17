from agenta import post, TextParam, FloatParam
from dotenv import load_dotenv
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate
import os


default_prompt = """What is the dominant ingredient in this recipe {recipe_name}? Answer in one word!!!!"""


@post
def generate(recipe_name: str, prompt_template: TextParam = default_prompt, temperature: FloatParam = 0.5) -> str:
    load_dotenv()
    llm = OpenAI(temperature=temperature)
    prompt = PromptTemplate(
        input_variables=["recipe_name"],
        template=prompt_template)

    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(recipe_name=recipe_name)
    return output
