import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

export const generateCodeBlocks = (apiKeyValue: string, demo: boolean) => {
    const hostLine = `os.environ["AGENTA_HOST"] = "${getEnv("NEXT_PUBLIC_AGENTA_API_URL")}"`
    const apiKeyLine = demo ? `os.environ["AGENTA_API_KEY"] = "${apiKeyValue || "{API_KEY}"}"` : ""

    return {
        openai: [
            {
                title: "Install the required packages:",
                code: `pip install -U agenta openai opentelemetry-instrumentation-openai`,
            },
            {
                title: "Initialize Agenta and Instrument OpenAI",
                code: `import os
import agenta as ag
import openai
from opentelemetry.instrumentation.openai import OpenAIInstrumentor

${hostLine}
${apiKeyLine}

ag.init()
OpenAIInstrumentor().instrument()

response = openai.ChatCompletion.create(
    model="gpt-3.5-turbo",
    messages=[{"role": "user", "content": "Write a short story about AI."}]
)

print(response.choices[0].message.content)`,
            },
        ],
        liteLLM: [
            {
                title: "Install the required packages:",
                code: `pip install -U agenta litellm`,
            },
            {
                title: "Initialize Agenta and Instrument LiteLLM",
                code: `import os
import agenta as ag
import litellm
import asyncio

${hostLine}
${apiKeyLine}

ag.init()
litellm.callbacks = [ag.callbacks.litellm_handler()]

async def run():
    response = await litellm.acompletion(
        model="gpt-3.5-turbo",
        messages=[{"role": "user", "content": "Write a short story about AI."}],
    )
    print(response["choices"][0]["message"]["content"])

asyncio.run(run())`,
            },
        ],
        langChain: [
            {
                title: "Install the required packages:",
                code: `pip install -U agenta openai opentelemetry-instrumentation-langchain langchain langchain_community`,
            },
            {
                title: "Initialize Agenta and Instrument LangChain",
                code: `import os
import agenta as ag
from langchain_community.chat_models import ChatOpenAI
from langchain.schema import HumanMessage
from opentelemetry.instrumentation.langchain import LangchainInstrumentor

${hostLine}
${apiKeyLine}

ag.init()
LangchainInstrumentor().instrument()

chat = ChatOpenAI(model="gpt-3.5-turbo")

response = chat([HumanMessage(content="Write a short story about AI.")])

print(response.content)`,
            },
        ],
        instructor: [
            {
                title: "Install the required packages:",
                code: `pip install -U agenta openai opentelemetry-instrumentation-openai instructor`,
            },
            {
                title: "Initialize Agenta and Instrument Instructor",
                code: `import os
import agenta as ag
import openai
import instructor
from opentelemetry.instrumentation.openai import OpenAIInstrumentor

${hostLine}
${apiKeyLine}

ag.init()
OpenAIInstrumentor().instrument()

client = instructor.from_openai(openai.OpenAI())

response = client.chat.completions.create(
    model="gpt-3.5-turbo",
    messages=[{"role": "user", "content": "Write a short story about AI."}],
)

print(response["choices"][0]["message"]["content"])`,
            },
        ],
        langGraph: [
            {
                title: "Install the required packages:",
                code: `pip install agenta langchain langgraph langchain-openai langchain-community llama-index openinference-instrumentation-langchain`,
            },
            {
                title: "Initialize Agenta and Instrument LangGraph",
                code: `import os
import agenta as ag
from typing import TypedDict, Dict, Any
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from llama_index.core import SimpleDirectoryReader
from langchain_core.runnables import RunnableLambda
from openinference.instrumentation.langchain import LangChainInstrumentor

# Load environment variables
${hostLine} # Optional, defaults to the Agenta cloud API
${apiKeyLine}
os.environ["OPENAI_API_KEY"] = "your_openai_api_key"  # Required for OpenAI Agents SDK

# Configuration setup
ag.init()

# Enable LangChain instrumentation (includes LangGraph)
LangChainInstrumentor().instrument()

# Configure language model
llm = ChatOpenAI(model="gpt-4", temperature=0)

# Define state structure for the graph
class SummarizerState(TypedDict):
    input: str
    segments: Dict[str, list[str]]
    speaker_summaries: Dict[str, str]
    actions: str

# Load meeting transcripts from documents
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
`,
            },
        ],
        llamaIndex: [
            {
                title: "Install the required packages:",
                code: `pip install agenta llama_index openinference-instrumentation-llama_index`,
            },
            {
                title: "Initialize Agenta and Instrument LlamaIndex",
                code: `import os
import agenta as ag
from openinference.instrumentation.llama_index import LlamaIndexInstrumentor
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader

# Configuration setup
${hostLine} # Optional, defaults to the Agenta cloud API
${apiKeyLine}

# Start Agenta observability
ag.init()

# Enable LlamaIndex instrumentation
LlamaIndexInstrumentor().instrument()

@ag.instrument()
def document_search_app(user_query: str):
    """
    Document search application using LlamaIndex.
    Loads documents, builds a searchable index, and answers user queries.
    """
    # Load documents from local directory
    docs = SimpleDirectoryReader("data").load_data()

    # Build vector search index
    search_index = VectorStoreIndex.from_documents(docs)

    # Initialize query processor
    query_processor = search_index.as_query_engine()

    # Process user query
    answer = query_processor.query(user_query)

    return answer


# Run the application
if __name__ == "__main__":
    result = document_search_app("What is Agenta?")
    print(f"Answer: {result}")
`,
            },
        ],
    }
}
