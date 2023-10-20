import agenta as ag
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate

default_prompt="What is a good name for a company that makes {product}?"

ag.init()
ag.config.default(
    temperature=ag.FloatParam(0.9),
    prompt_template=ag.TextParam(default_prompt),
)

@ag.entrypoint
def generate(product: str) -> str:
    llm = OpenAI(temperature=ag.config.temperature)
    prompt = PromptTemplate(
        input_variables=["product"], template=ag.config.prompt_template
    )
    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(product=product)

    return output
