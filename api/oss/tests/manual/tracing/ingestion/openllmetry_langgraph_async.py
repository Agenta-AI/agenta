# /// script
# dependencies = ["agenta", "langchain", "langgraph", "langchain-openai", "opentelemetry-instrumentation-langchain", "python-dotenv"]
# ///
"""
Test script for LangGraph with opentelemetry-instrumentation-langchain (async version).

This script tests the async version of LangGraph with the OpenTelemetry LangChain instrumentor.
Related issue: https://github.com/Agenta-AI/agenta/issues/3489

Known issue: The async version throws a TypeError warning due to span type mismatch.
When using opentelemetry-instrumentation-langchain with async code, the current span
may be a raw OTel span instead of Agenta's CustomSpan, which doesn't support the
`namespace` parameter in `set_attributes()`.
"""

import asyncio

import agenta as ag
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI
from opentelemetry.instrumentation.langchain import LangchainInstrumentor
from langgraph.graph import StateGraph, END, MessagesState
from langchain_core.runnables import RunnableLambda

from dotenv import load_dotenv

load_dotenv(override=True)
ag.init()
LangchainInstrumentor().instrument()

llm = ChatOpenAI(model="gpt-4o-mini")


async def chat(state):
    return {"messages": [await llm.ainvoke(state["messages"])]}


state_graph = StateGraph(MessagesState)
state_graph.add_node("chat", RunnableLambda(chat))
state_graph.set_entry_point("chat")
state_graph.add_edge("chat", END)
graph = state_graph.compile()


@ag.instrument()
async def ainvoke_graph(inputs: str):
    return await graph.ainvoke({"messages": [HumanMessage(inputs)]})


async def main():
    print("Running ASYNC version with opentelemetry-instrumentation-langchain...")
    recent_state = await ainvoke_graph("Hello")
    recent_state["messages"][-1].pretty_print()
    print("\nASYNC version completed.")


if __name__ == "__main__":
    asyncio.run(main())
