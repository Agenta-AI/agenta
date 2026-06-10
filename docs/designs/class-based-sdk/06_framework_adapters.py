"""Using agent frameworks inside Agenta workflows. (POC, does not run.)

The question: if the hotel agent is built with OpenAI Agents SDK, Pydantic AI,
or LangGraph, do you have to restate everything in the class? No. Three tiers,
from full control to one line:

1. MANUAL    - a plain ag.Application that builds the framework agent inside
               run(). You decide what is configurable. Most code, no magic.
2. FACTORY   - subclass a framework base and implement build(parameters).
               You declare Parameters; the base handles running, streaming,
               output schemas, and instrumentation.
3. AUTOMATIC - ag.Application.from_agent(agent). An adapter introspects the
               agent object and generates Parameters/Inputs/Outputs for you.

All three tiers compile to the same workflow revision. The common contract
underneath is the AgentAdapter port at the bottom of this file. Frameworks
already emit OpenTelemetry spans (openai-agents tracing, pydantic-ai, LangChain
instrumentors); the adapter routes them into Agenta's tracer so they nest as
child spans under the invocation span. Costs and tokens aggregate as usual.
"""

import asyncio
from typing import Any, AsyncIterator, Protocol, TypeVar

from agents import Agent as OpenAIAgent  # noqa: E402 (openai-agents SDK, not installed)
from agents import function_tool  # noqa: E402
from langgraph.graph import StateGraph  # noqa: E402
from pydantic import BaseModel
from pydantic_ai import Agent as PydanticAgent  # noqa: E402

import agenta as ag


# =========================================================================
# Tier 1: MANUAL. Plain ag.Application, Pydantic AI inside run().
#
# The framework agent is rebuilt per call from parameters. That is the price
# of playground-editable config: the source of truth lives in Agenta, not in
# the agent constructor. Building an Agent object is cheap in every framework.
# =========================================================================


class HotelAgentManual(ag.Application):
    slug = "hotel-agent-pydantic-ai"
    name = "Hotel Agent (Pydantic AI, manual)"

    class Parameters(BaseModel):
        model: str = "openai:gpt-4o-mini"
        instructions: str = "You are the concierge of {{hotel_name}}. Be brief."
        hotel_name: str = "Grand Agenta Hotel"

    class Inputs(BaseModel):
        message: str

    class Outputs(BaseModel):
        answer: str

    async def run(self, *, inputs: Inputs, parameters: Parameters) -> Outputs:
        agent = PydanticAgent(
            parameters.model,
            system_prompt=ag.render(
                parameters.instructions, hotel_name=parameters.hotel_name
            ),
        )
        result = await agent.run(inputs.message)
        return self.Outputs(answer=result.output)


# =========================================================================
# Tier 2: FACTORY (the port). You implement build(), the base does the rest.
#
# Use this when the automatic tier does not expose enough: conditional tools,
# nested config, multi-agent wiring. There is no run() here. The framework
# base implements run() and stream() by executing whatever build() returns
# (Runner.run for openai-agents, agent.run for pydantic-ai, graph.ainvoke for
# langgraph), and derives Outputs from the agent's output_type when you do
# not declare one.
# =========================================================================


@function_tool
def search_rooms(date: str, guests: int) -> list[dict]: ...


@function_tool
def book_room(room_id: str, date: str) -> dict: ...


class BookingAnswer(BaseModel):
    answer: str
    room_id: str | None = None


class HotelAgentFactory(ag.ext.openai_agents.Application):
    slug = "hotel-agent-openai"
    name = "Hotel Agent (OpenAI Agents, factory)"

    class Parameters(BaseModel):
        model: str = "gpt-4o-mini"
        instructions: str = "You are the hotel concierge. Use tools to answer."
        booking_enabled: bool = True

    class Inputs(BaseModel):
        message: str

    # Outputs is derived from build().output_type (BookingAnswer) unless
    # declared explicitly.

    def build(self, parameters: Parameters) -> OpenAIAgent:
        tools = [search_rooms] + ([book_room] if parameters.booking_enabled else [])
        return OpenAIAgent(
            name="hotel-concierge",
            model=parameters.model,
            instructions=parameters.instructions,
            tools=tools,
            output_type=BookingAnswer,
        )


# =========================================================================
# Tier 3: AUTOMATIC (the adapter). Wrap an existing agent, it becomes one
# of us. The adapter is picked by agent type from a registry.
# =========================================================================

concierge = OpenAIAgent(
    name="concierge",
    model="gpt-4o-mini",
    instructions="You are the hotel concierge.",
    tools=[search_rooms],
    output_type=BookingAnswer,
)

HotelAgentAuto = ag.Application.from_agent(concierge, slug="hotel-agent-auto")
# What the openai-agents adapter extracted:
#   Parameters <- model, instructions, model_settings   (playground-editable)
#   Inputs     <- {message: str}                        (the run input)
#   Outputs    <- BookingAnswer schema                  (from output_type)
#   handoffs/tools -> listed read-only in metadata, visible in the UI
# Applying edited parameters uses agent.clone(model=..., instructions=...)
# per invocation. The original object is never mutated.


# LangGraph maps the cleanest, because graphs already separate the three
# concerns the schema model needs:
#   Parameters <- config_schema (the "configurable" section)
#   Inputs     <- input state schema
#   Outputs    <- output state schema
# Binding needs no rebuild: graph.ainvoke(inputs, config={"configurable": ...}).


class GraphState(BaseModel):
    message: str
    answer: str | None = None


class GraphConfig(BaseModel):
    model: str = "gpt-4o-mini"
    system_prompt: str = "You are the hotel concierge."


builder = StateGraph(GraphState, config_schema=GraphConfig)
# ... add nodes and edges ...
graph = builder.compile()

HotelGraph = ag.Application.from_agent(graph, slug="hotel-agent-langgraph")


async def main():
    ag.init()

    # All three tiers behave identically from here on.
    for App in (HotelAgentManual, HotelAgentFactory, HotelAgentAuto, HotelGraph):
        await App.apush()

    agent = HotelAgentAuto(parameters={"model": "gpt-4.1"})
    _result = await agent(message="Do you have a pool?")

    await ag.aevaluate(
        testset="hotel-faq-v2",
        applications=[HotelAgentManual, HotelAgentAuto],
        evaluators=["rubric-judge"],
    )


# =========================================================================
# The port: one adapter per framework, registered by agent type. This is
# what tiers 2 and 3 are built on. Third-party frameworks can ship their
# own adapter and register it via entry point.
# =========================================================================

AgentT = TypeVar("AgentT")


class AgentAdapter(Protocol[AgentT]):
    def parameters(self, agent: AgentT) -> tuple[type[BaseModel], dict]:
        """The editable config model, and current values read off the agent.
        These become schemas.parameters and revision.data.parameters."""

    def io(self, agent: AgentT) -> tuple[type[BaseModel], type[BaseModel]]:
        """Inputs and Outputs models. These become schemas.inputs/outputs."""

    def bind(self, agent: AgentT, parameters: BaseModel) -> AgentT:
        """Apply parameters without mutating the original: clone() for
        openai-agents, rebuild for pydantic-ai, configurable for langgraph."""

    async def invoke(self, agent: AgentT, inputs: BaseModel) -> Any:
        """Run once. The result is normalized against Outputs."""

    def stream(self, agent: AgentT, inputs: BaseModel) -> AsyncIterator[Any]:
        """Optional. When the adapter implements it, the wrapped app streams."""


# ag.adapters.register(OpenAIAgent, OpenAIAgentsAdapter())
# ag.adapters.register(PydanticAgent, PydanticAIAdapter())
# ag.adapters.register(CompiledStateGraph, LangGraphAdapter())

# Honest limits of the automatic tier: the adapter can only expose what the
# agent object carries. Model, instructions, and model settings come for
# free. Prompts buried inside tools, retrievers, or graph nodes are invisible
# to introspection. When you need those in the playground, drop to the
# factory tier and lift them into Parameters yourself.


if __name__ == "__main__":
    asyncio.run(main())
