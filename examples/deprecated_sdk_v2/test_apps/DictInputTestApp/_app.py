import agenta as ag
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate

default_prompt = "What is a good name for a company that makes {product}?"


@ag.post
def generate(
    inputs: ag.DictInput,
    temperature: ag.FloatParam = 0.9,
    prompt_template: ag.TextParam = default_prompt,
) -> str:
    llm = OpenAI(temperature=temperature)
    prompt = PromptTemplate(
        input_variables=list(inputs.keys()),
        template=prompt_template,
    )
    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(**inputs)

    return output
