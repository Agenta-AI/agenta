import agenta as ag
from langchain.chat_models import ChatOpenAI
from langchain.prompts import ChatPromptTemplate
from langchain.chains.openai_functions import create_structured_output_chain

default_prompt = """Create a valid JSON with the text: {text}"""


@ag.post
def generate(
    text: str,
    temperature: ag.FloatParam = 0.9,
) -> str:
    llm = ChatOpenAI(model="gpt-3.5-turbo-0613", temperature=temperature)
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", "You are a world class algorithm for extracting information in structured formats."),
            ("human", "Use the given format to extract information from the following input: {text}"),
            ("human", "Tip: Make sure to answer in the correct format"),
        ]
    )
    
    prompt.format_messages(text=text)

    json_schema = {
        "name": "extract_information",
        "description": "Extract information from user-provided text",
        "parameters": {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "The text to extract information from"
                }
            },
        }
    }

    chain = create_structured_output_chain(json_schema, llm, prompt, verbose=True)
    output = chain.run(text=text)

    return output
