import agenta as ag
from langchain.chat_models import ChatOpenAI
from langchain.output_parsers import StructuredOutputParser, ResponseSchema
from langchain.prompts import ChatPromptTemplate, HumanMessagePromptTemplate

default_prompt = "Categorise the sentiment of this text: {text}"

ag.init()
ag.config.default(
    temperature=ag.FloatParam(0.9),
    prompt_template=ag.TextParam(default_prompt),
)


@ag.entrypoint
def generate(
    text: str,
    category_name: str = "category",
    category_description: str = "name of sentiment category",
    degree_name: str = "degree",
    degree_description: str = "percentage of how much this sentiment is predicted to be in this category",
) -> str:
    llm = ChatOpenAI(temperature=ag.config.temperature)

    response_schemas = [
        ResponseSchema(name=category_name, description=category_description),
        ResponseSchema(name=degree_name, description=degree_description),
    ]

    output_parser = StructuredOutputParser.from_response_schemas(response_schemas)
    format_instructions = output_parser.get_format_instructions()

    prompt = ChatPromptTemplate(
        messages=[
            HumanMessagePromptTemplate.from_template(
                ag.config.prompt_template + "\n{format_instructions}"
            )
        ],
        input_variables=["text"],
        partial_variables={"format_instructions": format_instructions},
    )

    _input = prompt.format_prompt(text=text)
    output = llm(_input.to_messages())

    return str(output_parser.parse(output.content))
