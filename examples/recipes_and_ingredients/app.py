from agenta import post, TextParam, FloatParam
from dotenv import load_dotenv
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate
import os


default_prompt = """
What is the dominant ingredient in this recipe {recipe_name}?
Answer in one word that contains only aphabetical letters and without a dot at the end.
Remove dots, spaces, return to line, tab space characters and all invisible non printable before the word.
Remove dots, spaces, return to line, tab space characters and all invisible non printable after the word.
Remove all Carriage Return (ASCII 13, \r ) Line Feed (ASCII 10, \n ) characters.
ANSWER IN ONE SINGLE WORD WITHOUT ANY POSSIBLE INVISIBLE CHARACTER!!!.
REMOVE ALL NEWLINE CHARACTER, LINE BREAK, ENDOF LINE (EOL) OR "\n"
"""


@post
def generate(
    recipe_name: str,
    prompt_template: TextParam = default_prompt,
    temperature: FloatParam = 0.5,
) -> str:
    load_dotenv()
    llm = OpenAI(temperature=temperature)
    prompt = PromptTemplate(input_variables=["recipe_name"], template=prompt_template)

    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(recipe_name=recipe_name)
    return output.strip()
