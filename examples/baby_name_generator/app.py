from agenta import post, TextParam, FloatParam
from dotenv import load_dotenv
# from langchain.chains import LLMChain
# from langchain.llms import OpenAI
# from langchain.prompts import PromptTemplate

default_prompt = "Here are five cool names for a baby from this country {country} with this gender {gender}:"


@post
def completion(country: str, gender: str, temperature: FloatParam = 0.9, prompt_template: TextParam = default_prompt) -> str:
    # llm = OpenAI(temperature=temperature)
    # prompt = PromptTemplate(
    #     input_variables=["country", "gender"],
    #     template=prompt_template,
    # )
    # chain = LLMChain(llm=llm, prompt=prompt)
    # output = chain.run(country=country, gender=gender)

    return "country"
