from openai import OpenAI
from pydantic import BaseModel, Field

import agenta as ag
from agenta.sdk.types import PromptTemplate, Message, ModelConfig
from opentelemetry.instrumentation.openai import OpenAIInstrumentor

ag.init()
client = OpenAI()
OpenAIInstrumentor().instrument()


class Config(BaseModel):
    prompt1: PromptTemplate = Field(
        default=PromptTemplate(
            messages=[
                Message(role="system", content="You summarize blog posts concisely."),
                Message(role="user", content="Summarize this:\n\n{{blog_post}}"),
            ],
            template_format="curly",
            input_keys=["blog_post"],
            llm_config=ModelConfig(model="gpt-4o-mini", temperature=0.7),
        )
    )
    prompt2: PromptTemplate = Field(
        default=PromptTemplate(
            messages=[
                Message(
                    role="user", content="Write a tweet based on this:\n\n{{summary}}"
                )
            ],
            template_format="curly",
            input_keys=["summary"],
            llm_config=ModelConfig(model="gpt-4o-mini", temperature=0.9),
        )
    )


@ag.route("/", config_schema=Config)
@ag.instrument()
async def generate(blog_post: str) -> str:
    config = ag.ConfigManager.get_from_route(schema=Config)

    # Step 1: Summarize
    formatted1 = config.prompt1.format(blog_post=blog_post)
    response1 = client.chat.completions.create(**formatted1.to_openai_kwargs())
    summary = response1.choices[0].message.content

    # Step 2: Write tweet
    formatted2 = config.prompt2.format(summary=summary)
    response2 = client.chat.completions.create(**formatted2.to_openai_kwargs())

    return response2.choices[0].message.content
