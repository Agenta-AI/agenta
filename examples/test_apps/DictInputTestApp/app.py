import agenta as ag
from langchain.llms import OpenAI
from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate

default_prompt = "What is a good name for a company that makes {product}?"

ag.init()
ag.config.default(
    temperature=ag.FloatParam(0.9),
    prompt_template=ag.TextParam(default_prompt),
)

@ag.entrypoint
def generate(
    inputs: ag.DictInput = ag.DictInput(default_keys=["product"]),
) -> str:
    llm = OpenAI(temperature=ag.config.temperature)
    prompt = PromptTemplate(
        input_variables=list(inputs.keys()),
        template=ag.config.prompt_template,
    )
    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(**inputs)

    return output
