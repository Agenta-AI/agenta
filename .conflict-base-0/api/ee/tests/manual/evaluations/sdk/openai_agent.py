# /// script
# dependencies = ["agenta", "openai-agents", "openinference-instrumentation-openai-agents", "ipdb", "opentelemetry-api", "opentelemetry-sdk"]
# ///

from agents import (
    Agent,
    InputGuardrail,
    GuardrailFunctionOutput,
    Runner,
    WebSearchTool,
)
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor
# from opentelemetry import trace
# from opentelemetry.sdk.trace.export import ConsoleSpanExporter, BatchSpanProcessor
# from opentelemetry.sdk.trace import ReadableSpan
# from opentelemetry.sdk.trace.export import SpanProcessor
# from opentelemetry.trace import Span

# os.environ["AGENTA_API_KEY"] = ""

# ag.init()
# OpenAIAgentsInstrumentor().instrument()


class AgentaQuestionOutput(BaseModel):
    is_agenta_question: bool
    reasoning: str


guardrail_agent = Agent(
    name="Guardrail check",
    instructions="Check if the user is asking something about Agenta, the LLMOps platform. Their question might be ambiguous, so you need to be careful.",
    output_type=AgentaQuestionOutput,
    model="gpt-4o-mini",
)

web_research_agent = Agent(
    name="Web Research Agent",
    handoff_description="Specialist agent for web research. You will use this agent to research the user's question when the documentation is not enough. You mainly search the websites agenta.ai and docs.agenta.ai",
    instructions="You will search the web to answer the user's question about Agenta, the LLMOps platform.",
    tools=[
        WebSearchTool(),
    ],
    model="gpt-4o-mini",
)


async def guardrail_function(ctx, agent, input_data):
    result = await Runner.run(guardrail_agent, input_data, context=ctx.context)
    final_output = result.final_output_as(AgentaQuestionOutput)
    return GuardrailFunctionOutput(
        output_info=final_output,
        tripwire_triggered=not final_output.is_agenta_question,
    )


triage_agent = Agent(
    name="Triage Agent",
    instructions="You determine which agent to use based on the user's question on agenta",
    handoffs=[web_research_agent],
    input_guardrails=[
        InputGuardrail(guardrail_function=guardrail_function),
    ],
    model="gpt-4o-mini",
)

# async def main():
#     # Example 1: History question
#     # agent = Agent(name="Assistant", instructions="You are a helpful assistant.")
#     await run_demo_loop(triage_agent)

#     # try:
#     #     result = await Runner.run(triage_agent, "What is the meaning of life?")
#     #     import ipdb; ipdb.set_trace()
#     #     print(result.final_output)
#     # except InputGuardrailTripwireTriggered as e:
#     #     print("Guardrail blocked this input:", e)

#     # # Example 2: General/philosophical question
#     # try:
#     #     result = await Runner.run(triage_agent, "What is the meaning of life?")
#     #     print(result.final_output)
#     # except InputGuardrailTripwireTriggered as e:
#     #     print("Guardrail blocked this input:", e)

# if __name__ == "__main__":
#     asyncio.run(main())
