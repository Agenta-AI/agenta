# /// script
# dependencies = ["agenta", "openinference-instrumentation-openai-agents", "openai-agents"]
# ///
import asyncio
import agenta as ag
from agents import Agent, Runner
from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor
from dotenv import load_dotenv

load_dotenv()

ag.init()
OpenAIAgentsInstrumentor().instrument()


spanish_agent = Agent(
    name="Spanish agent",
    instructions="You translate the user's message to Spanish",
)

french_agent = Agent(
    name="French agent",
    instructions="You translate the user's message to French",
)

german_agent = Agent(
    name="German agent",
    instructions="You translate the user's message to German",
)

orchestrator_agent = Agent(
    name="orchestrator_agent",
    instructions=(
        "You are a translation agent. You use the tools given to you to translate."
        "If asked for multiple translations, you call the relevant tools."
    ),
    tools=[
        spanish_agent.as_tool(
            tool_name="translate_to_spanish",
            tool_description="Translate the user's message to Spanish",
        ),
        french_agent.as_tool(
            tool_name="translate_to_french",
            tool_description="Translate the user's message to French",
        ),
        german_agent.as_tool(
            tool_name="translate_to_german",
            tool_description="Translate the user's message to German",
        ),
    ],
)


@ag.instrument()
async def duolingo(query: str):
    result = await Runner.run(orchestrator_agent, input=query)
    return result.final_output


if __name__ == "__main__":

    async def main():
        response = await duolingo("What is 'What's your name' in French?")
        print("Response 1:", response)

    asyncio.run(main())
