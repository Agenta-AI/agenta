from agenta import post, TextParam, FloatParam
from dotenv import load_dotenv
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate

default_prompt = "What is a good name for a company that makes {product}?"


@post
def generate(product: str, temperature: FloatParam = 0.9, prompt_template: TextParam = default_prompt) -> str:
    load_dotenv()
    llm = OpenAI(temperature=temperature)
    prompt = PromptTemplate(
        input_variables=["product"],
        template=prompt_template,
    )
    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(product=product)

    return output
