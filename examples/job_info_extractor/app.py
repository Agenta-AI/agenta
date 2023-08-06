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


def create_job_class(company_desc: str, position_desc: str, salary_range_desc: str):
    """Create a job class to be used in langchain"""

    class Job(BaseModel):
        company_name: str = Field(..., description=company_desc)
        position_name: str = Field(..., description=position_desc)
        salary_range: Optional[str] = Field(None, description=salary_range_desc)

    return Job


default_sm = (
    "You are a world class algorithm for extracting information in structured formats."
)
default_hm = "Please extract the following information from the given input:"
default_cm = "Tips: Make sure to answer in the correct format"
default_company_desc = "The name of the company"
default_position_desc = "The name of the position"
default_salary_range_desc = "The salary range of the position"


@ag.post
def generate(
    job_description: str,
    system_message: ag.TextParam = default_sm,
    human_message: ag.TextParam = default_hm,
    content_message: ag.TextParam = default_cm,
    company_desc_message: ag.TextParam = default_company_desc,
    position_desc_message: ag.TextParam = default_position_desc,
    salary_range_desc_message: ag.TextParam = default_salary_range_desc,
    temperature: ag.FloatParam = 0.5,
    top_p: ag.FloatParam = 1.0,
    presence_penalty: ag.FloatParam = 0.0,
    frequency_penalty: ag.FloatParam = 0.0,
) -> str:
    """Extract information from a job description"""
    llm = ChatOpenAI(
        model="gpt-3.5-turbo-0613",
        temperature=temperature,
        top_p=top_p,
        presence_penalty=presence_penalty,
        frequency_penalty=frequency_penalty,
    )

    prompt_msgs = [
        SystemMessage(content=system_message),
        HumanMessage(content=human_message),
        HumanMessagePromptTemplate.from_template("{input}"),
        HumanMessage(content=content_message),
    ]
    prompt = ChatPromptTemplate(messages=prompt_msgs)

    chain = create_structured_output_chain(
        create_job_class(
            company_desc=company_desc_message,
            position_desc=position_desc_message,
            salary_range_desc=salary_range_desc_message,
        ),
        llm,
        prompt,
        verbose=False,
    )
    output = chain.run(job_description)

    return str(output)
