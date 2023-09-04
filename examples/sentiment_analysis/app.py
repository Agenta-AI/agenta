import agenta as ag
from langchain.chat_models import ChatOpenAI
from langchain.output_parsers import StructuredOutputParser, ResponseSchema
from langchain.prompts import ChatPromptTemplate, HumanMessagePromptTemplate

default_prompt = "Categorise the sentiment of this text: {text}"


@ag.post
def generate(
    text: str,
    temperature: ag.FloatParam = 0.9,
    prompt_template: ag.TextParam = default_prompt,
) -> str:
    llm = ChatOpenAI(temperature=temperature)
    
    response_schemas = [
        ResponseSchema(name="category", description="name of sentiment category"),
        ResponseSchema(name="degree", description="percentage of how much this sentiment is predicted to be of in this category")
    ]
    output_parser = StructuredOutputParser.from_response_schemas(response_schemas)
    format_instructions = output_parser.get_format_instructions()
    
    prompt = ChatPromptTemplate(
        messages=[
            HumanMessagePromptTemplate.from_template(prompt_template + "\n{format_instructions}")  
        ],
        input_variables=["text"],
        partial_variables={"format_instructions": format_instructions}
    )
    
    _input = prompt.format_prompt(text=text)
    output = llm(_input.to_messages())

    return output_parser.parse(output.content)
