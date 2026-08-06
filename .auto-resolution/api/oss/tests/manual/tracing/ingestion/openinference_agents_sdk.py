# /// script
# dependencies = ["agenta", "openai-agents", "openinference-instrumentation-openai-agents"]
# ///

from agents import Agent, Runner
from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor

import agenta as ag
from dotenv import load_dotenv

load_dotenv(override=True)

ag.init()

OpenAIAgentsInstrumentor().instrument()


def agents_app():
    joke_agent = Agent(
        name="JokeWriter",
        instructions="You are a funny sarcastic nerd. Write a joke about the given subject.",
    )

    # First get the joke
    joke_result = Runner.run_sync(joke_agent, "Tell me a joke about OpenTelemetry.")

    print(joke_result.final_output)


agents_app()
