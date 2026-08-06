# /// script
# dependencies = ["agenta", "langchain", "langgraph", "langchain-openai", "langchain-community", "llama-index", "openinference-instrumentation-langchain"]
# ///
import agenta as ag
from typing import TypedDict, Dict
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from llama_index.core import SimpleDirectoryReader
from langchain_core.runnables import RunnableLambda
from openinference.instrumentation.langchain import LangChainInstrumentor

from dotenv import load_dotenv

load_dotenv(override=True)
ag.init()
LangChainInstrumentor().instrument()


llm = ChatOpenAI(model="gpt-4", temperature=0)


class SummarizerState(TypedDict):
    input: str
    segments: Dict[str, list[str]]
    speaker_summaries: Dict[str, str]
    actions: str


# Load all .txt or .md files in the "meetings" directory
documents = SimpleDirectoryReader("meetings").load_data()
full_transcript = "\n".join(doc.text for doc in documents)


# Node 1: Segment speaker contributions
def segment_by_speaker(state):
    transcript = state["input"]
    speakers = {}
    for line in transcript.split("\n"):
        if ":" in line:
            name, text = line.split(":", 1)
            speakers.setdefault(name.strip(), []).append(text.strip())
    return {**state, "segments": speakers}


# Node 2: Summarize each speaker's contributions
def summarize_per_speaker(state):
    segments = state["segments"]
    summaries = {}
    for speaker, texts in segments.items():
        joined_text = " ".join(texts)
        summary = llm.invoke(f"Summarize what {speaker} said: {joined_text}")
        summaries[speaker] = summary.content
    return {**state, "speaker_summaries": summaries}


# Node 3: Extract action items
def extract_actions(state):
    transcript = state["input"]
    result = llm.invoke(f"List all action items from this transcript:\n{transcript}")
    return {**state, "actions": result.content}


@ag.instrument()
def meeting_analyzer(transcript: str):
    # Build LangGraph workflow
    builder = StateGraph(SummarizerState)
    builder.add_node("segment", RunnableLambda(segment_by_speaker))
    builder.add_node("summarize", RunnableLambda(summarize_per_speaker))
    builder.add_node("extract_actions", RunnableLambda(extract_actions))

    builder.set_entry_point("segment")
    builder.add_edge("segment", "summarize")
    builder.add_edge("summarize", "extract_actions")
    builder.add_edge("extract_actions", END)

    graph = builder.compile()
    result = graph.invoke({"input": transcript})
    return result


# Example usage
if __name__ == "__main__":
    result = meeting_analyzer(full_transcript)
    print("Analysis Result:", result)
