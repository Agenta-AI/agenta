from agenta import post
from dotenv import load_dotenv
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate


@post
def completion(product: str) -> str:
    llm = OpenAI(temperature=0.9)
    prompt = PromptTemplate(
        input_variables=["product"],
        template="What is a good name for a company that makes {product}?",
    )
    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(product=product)
    return output


if __name__ == "__main__":
    load_dotenv()
    print(completion("socks"))
