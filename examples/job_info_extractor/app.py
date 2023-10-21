import agenta as ag
from typing import Optional

from langchain.chains.openai_functions import (
    create_openai_fn_chain,
    create_structured_output_chain,
)
from langchain.chat_models import ChatOpenAI
from langchain.prompts import ChatPromptTemplate, HumanMessagePromptTemplate
from langchain.schema import HumanMessage, SystemMessage

from pydantic import BaseModel, Field

default_prompt = "What is a good name for a company that makes {product}?"

ag.init()
ag.config.default(
    prompt_template=ag.TextParam(default_prompt),
    system_message=ag.TextParam(
        "You are a world class algorithm for extracting information in structured formats."
    ),
    human_message=ag.TextParam(
        "Please extract the following information from the given input:"
    ),
    content_message=ag.TextParam("Tips: Make sure to answer in the correct format"),
    company_desc_message=ag.TextParam("The name of the company"),
    position_desc_message=ag.TextParam("The name of the position"),
    salary_range_desc_message=ag.TextParam("The salary range of the position"),
    temperature=ag.FloatParam(0.5),
    top_p=ag.FloatParam(1.0),
    presence_penalty=ag.FloatParam(0.0),
    frequency_penalty=ag.FloatParam(0.0),
)


def create_job_class(company_desc: str, position_desc: str, salary_range_desc: str):
    """Create a job class to be used in langchain"""

    class Job(BaseModel):
        company_name: str = Field(..., description=company_desc)
        position_name: str = Field(..., description=position_desc)
        salary_range: Optional[str] = Field(None, description=salary_range_desc)

    return Job


@ag.entrypoint
def generate(
    job_description: str,
) -> str:
    """Extract information from a job description"""
    llm = ChatOpenAI(
        model="gpt-3.5-turbo-0613",
        temperature=ag.config.temperature,
        top_p=ag.config.top_p,
        presence_penalty=ag.config.presence_penalty,
        frequency_penalty=ag.config.frequency_penalty,
    )

    prompt_msgs = [
        SystemMessage(content=ag.config.system_message),
        HumanMessage(content=ag.config.human_message),
        HumanMessagePromptTemplate.from_template("{input}"),
        HumanMessage(content=ag.config.content_message),
    ]
    prompt = ChatPromptTemplate(messages=prompt_msgs)

    chain = create_structured_output_chain(
        create_job_class(
            company_desc=ag.config.company_desc_message,
            position_desc=ag.config.position_desc_message,
            salary_range_desc=ag.config.salary_range_desc_message,
        ),
        llm,
        prompt,
        verbose=False,
    )
    output = chain.run(job_description)

    return str(output)
