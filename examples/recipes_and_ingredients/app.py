import agenta as ag
from dotenv import load_dotenv
from langchain.llms import OpenAI
from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate


default_prompt = """
What is the dominant ingredient in this recipe {recipe_name}?
Answer in one word that contains only aphabetical letters and without a dot at the end.
Remove dots, spaces, return to line, tab space characters and all invisible non printable before the word.
Remove dots, spaces, return to line, tab space characters and all invisible non printable after the word.
Remove all Carriage Return (ASCII 13, \r ) Line Feed (ASCII 10, \n ) characters.
ANSWER IN ONE SINGLE WORD WITHOUT ANY POSSIBLE INVISIBLE CHARACTER!!!.
REMOVE ALL NEWLINE CHARACTER, LINE BREAK, ENDOF LINE (EOL) OR "\n"
"""

ag.init()
ag.config.default(
    temperature=ag.FloatParam(0.5),
    prompt_template=ag.TextParam(default_prompt),
)


@ag.entrypoint
def generate(
    recipe_name: str,
) -> str:
    load_dotenv()
    llm = OpenAI(temperature=ag.config.temperature)
    prompt = PromptTemplate(
        input_variables=["recipe_name"], template=ag.config.prompt_template
    )

    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(recipe_name=recipe_name)
    return output.strip()
