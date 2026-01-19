# /// script
# dependencies = ["agenta", "langchain", "langgraph", "langchain-openai", "opentelemetry-instrumentation-langchain", "python-dotenv"]
# ///
"""
Test script for LangGraph with opentelemetry-instrumentation-langchain (sync version).

This script tests the sync version of LangGraph with the OpenTelemetry LangChain instrumentor.
Related issue: https://github.com/Agenta-AI/agenta/issues/3489
"""
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


def chat(state):
    return {"messages": [llm.invoke(state["messages"])]}


state_graph = StateGraph(MessagesState)
state_graph.add_node("chat", RunnableLambda(chat))
state_graph.set_entry_point("chat")
state_graph.add_edge("chat", END)
graph = state_graph.compile()


@ag.instrument()
def invoke_graph(inputs: str):
    return graph.invoke({"messages": [HumanMessage(inputs)]})


if __name__ == "__main__":
    print("Running SYNC version with opentelemetry-instrumentation-langchain...")
    recent_state = invoke_graph("Hello")
    recent_state["messages"][-1].pretty_print()
    print("\nSYNC version completed.")
