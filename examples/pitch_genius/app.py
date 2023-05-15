from agenta import post
from dotenv import load_dotenv
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate
import os


@post
def generate(startup_name: str, startup_idea: str, p1: str, p2: str, p3: str) -> str:
    prompt_template = """
    please write a short linkedin message (2 SENTENCES MAX) to an investor pitchin the following startup:
    startup name: {startup_name}
    startup idea: {startup_idea}"""
    llm = OpenAI(temperature=0.9)
    prompt = PromptTemplate(
        input_variables=["startup_name", "startup_idea"],
        template=prompt_template)
    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(startup_name=startup_name, startup_idea=startup_idea)
    return output


if __name__ == "__main__":
    load_dotenv()
    print(generate("Agenta AI", "Developer tool for LLM-powered apps"))
