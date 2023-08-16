import agenta as ag
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate

default_prompt = "What is a good name for a company that makes {product}?"


@ag.post
def completion(
    product: str,
    prompt_template: ag.TextParam = default_prompt,
    model: ag.MultipleChoiceParam = ag.MultipleChoiceParam(1, [1, 2]),
) -> str:
    llm = OpenAI()
    prompt = PromptTemplate(
        input_variables=["product"],
        template=prompt_template,
    )
    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(product=product)

    return output
