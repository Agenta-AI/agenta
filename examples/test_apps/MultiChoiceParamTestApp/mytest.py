import agenta as ag
from langchain.llms import OpenAI
from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate

default_prompt = "What is a good name for a company that makes {product}?"

ag.init()
ag.config.default(
    prompt_template=ag.TextParam(default_prompt),
    model=ag.MultipleChoiceParam(1, [1, 2]),
)

@ag.entrypoint
def completion(
    product: str,
) -> str:
    llm = OpenAI(model=ag.config.model)
    prompt = PromptTemplate(
        input_variables=["product"],
        template=ag.config.prompt_template,
    )
    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(product=product)

    return output
