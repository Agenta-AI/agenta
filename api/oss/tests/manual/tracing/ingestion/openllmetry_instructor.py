# /// script
# dependencies = ["agenta", "opentelemetry-instrumentation-openai", "openai", "instructor"]
# ///
from dotenv import load_dotenv

import agenta as ag
import openai
import instructor
from pydantic import BaseModel

from opentelemetry.instrumentation.openai import OpenAIInstrumentor

load_dotenv(override=True)
ag.init()
OpenAIInstrumentor().instrument()


# Define your desired output structure
class UserInfo(BaseModel):
    name: str
    age: int


@ag.instrument(spankind="WORKFLOW")
def instructor_workflow():
    # Patch the OpenAI client
    client = instructor.from_openai(openai.OpenAI())

    # Extract structured data from natural language
    user_info = client.chat.completions.create(
        model="gpt-3.5-turbo",
        response_model=UserInfo,
        messages=[{"role": "user", "content": "John Doe is 30 years old."}],
    )
    return user_info


user_info = instructor_workflow()
print(user_info)
