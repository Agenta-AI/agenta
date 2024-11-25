from openai import OpenAI
import agenta as ag
from pydantic import BaseModel, Field
from opentelemetry.instrumentation.openai import OpenAIInstrumentor

ag.init()

client = OpenAI()
prompt1 = "Summarize the following blog post: {blog_post}"
prompt2 = "Write a tweet based on this: {output_1}"

OpenAIInstrumentor().instrument()


class CoPConfig(BaseModel):
    prompt1: str = Field(default=prompt1)
    prompt2: str = Field(default=prompt2)


@ag.route("/", config_schema=CoPConfig)
@ag.instrument()
def generate(blog_post: str):
    config = ag.ConfigManager.get_from_route(schema=CoPConfig)
    formatted_prompt1 = config.prompt1.format(blog_post=blog_post)
    completion = client.chat.completions.create(
        model="gpt-3.5-turbo", messages=[{"role": "user", "content": formatted_prompt1}]
    )
    output_1 = completion.choices[0].message.content
    formatted_prompt2 = config.prompt2.format(output_1=output_1)
    completion = client.chat.completions.create(
        model="gpt-3.5-turbo", messages=[{"role": "user", "content": formatted_prompt2}]
    )
    return completion.choices[0].message.content
