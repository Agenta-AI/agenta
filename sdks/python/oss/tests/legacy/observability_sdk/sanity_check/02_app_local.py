import agenta as ag
from pydantic import BaseModel
from agenta.sdk.assets import supported_llm_models

ag.init()

ag.config.default(
    temperature=ag.FloatParam(0.2),
    model=ag.GroupedMultipleChoiceParam(
        default="gpt-3.5-turbo", choices=supported_llm_models
    ),
    max_tokens=ag.IntParam(-1, -1, 4000),
    prompt_system=ag.TextParam("MY_SYSTEM_PROMPT"),
)


# Pydantic models
class InputData(BaseModel):
    text: str
    value: int


class OutputData(BaseModel):
    result: str
    count: int


# Function with ignored outputs
@ag.instrument(
    spankind="EMBEDDING",
    ignore_outputs=["ignored", "cost", "usage"],
)
def ignore_some_outputs_embedding(description: str):
    print("embed")
    return {
        "embedding": "somedata",
        "ignored": "ignored",
        "cost": 15,
    }


# Function with all outputs ignored
@ag.instrument(spankind="AGENT", ignore_outputs=True)
def ignore_all_outputs_agent(query: str):
    print("agent")
    return {
        "result": "agent result",
        "confidence": 0.9,
    }


# Function with ignored inputs
@ag.instrument(spankind="CHAIN", ignore_inputs=["secret"])
def function_with_ignored_inputs(public_data: str, secret: str):
    print("function with ignored inputs")
    return f"Public: {public_data}, Secret: {secret}"


# Function with all inputs ignored
@ag.instrument(spankind="CHAIN", ignore_inputs=True)
def function_with_all_ignored_inputs(data: str):
    print("function with all ignored inputs")
    return f"Data: {data}"


# Function using dict inputs/outputs
@ag.instrument(spankind="CHAIN")
def dict_function(input_dict: dict) -> dict:
    print("dict function")
    return {"output_data": input_dict.get("key", None)}


# Function using Pydantic models
@ag.instrument(spankind="CHAIN")
def pydantic_function(input_data: InputData) -> OutputData:
    print("pydantic function")
    return OutputData(result=input_data.text.upper(), count=input_data.value + 1)


# Function with None output
@ag.instrument(spankind="CHAIN")
def none_output_function():
    print("none output function")
    return None


# Nested function calls
@ag.instrument(spankind="CHAIN")
def nested_function(value: int):
    print("nested function")
    inner_result = inner_function(value)
    return f"Nested result: {inner_result}"


@ag.instrument(spankind="CHAIN")
def inner_function(value: int):
    print("inner function")
    return value * 2


# Function called multiple times
@ag.instrument(spankind="CHAIN")
def multiple_calls_function(counter: int):
    print(f"multiple calls function call {counter}")
    return f"Call number: {counter}"


# Existing functions
@ag.instrument(spankind="CHAIN")
def chain_function(input_data: str):
    print("chain")
    return f"Processed: {input_data}"


@ag.instrument(spankind="TASK")
def task_function(task: str):
    print("task")
    return f"Completed task: {task}"


@ag.instrument(spankind="TOOL")
def tool_function(tool_input: str):
    print("tool")
    return f"Tool output: {tool_input}"


@ag.instrument(spankind="QUERY")
def query_function(query: str):
    print("query")
    return f"Query result: {query}"


@ag.instrument(spankind="COMPLETION")
def completion_function(prompt: str):
    print("completion")
    return f"Completed: {prompt}"


@ag.instrument(spankind="CHAT")
async def chat_function(message: str):
    print("chat")
    return f"Chat response: {message}"


@ag.instrument(spankind="RERANK")
def rerank_function(documents: list):
    print("rerank")
    return sorted(documents, reverse=True)


# @ag.instrument(spankind="WRONGKIND")
# def wrong_kind_function(input_data: str):
#     print("wrong kind")
#     return f"Processed with wrong kind: {input_data}"


@ag.instrument(spankind="COMPLETION", ignore_inputs=True)
async def summarizer(topic: str, genre: str, report: dict) -> dict:
    print("summarizer")
    return {"report": "mya"}


@ag.instrument(spankind="CHAT")
async def exception_func():
    raise Exception("This is an exception")
    return "dummy"


@ag.instrument(spankind="WORKFLOW")
async def main2(topic: str, genre: str, count: int = 5):
    result = ignore_some_outputs_embedding("something")
    agent_result = ignore_all_outputs_agent("agent query")
    chain_result1 = chain_function("chain input 1")
    chain_result2 = chain_function("chain input 2")
    chain_result3 = chain_function("chain input 3")  # Called multiple times
    task_result = task_function("important task")
    tool_result = tool_function("tool input")
    query_result = query_function("search query")
    completion_result = completion_function("complete this")
    chat_result = await chat_function("Hello, AI!")
    rerank_result = rerank_function([3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5])
    summarizer_result = await summarizer("topic", "genre", {"content": "report"})
    ignored_input_result = function_with_ignored_inputs("public info", "secret info")
    all_ignored_input_result = function_with_all_ignored_inputs("some data")
    dict_result = dict_function({"key": "value"})
    pydantic_input = InputData(text="hello", value=42)
    pydantic_result = pydantic_function(pydantic_input)
    none_output_result = none_output_function()
    nested_result = nested_function(5)
    multiple_calls_results = [
        multiple_calls_function(i) for i in range(3)
    ]  # Called multiple times
    return f"""Results:
    Embedding: {result}
    Agent: {agent_result}
    Chain Results: {chain_result1}, {chain_result2}, {chain_result3}
    Task: {task_result}
    Tool: {tool_result}
    Query: {query_result}
    Completion: {completion_result}
    Chat: {chat_result}
    Rerank: {rerank_result}
    Summarizer: {summarizer_result}
    Ignored Inputs: {ignored_input_result}
    All Ignored Inputs: {all_ignored_input_result}
    Dict Function: {dict_result}
    Pydantic Function: {pydantic_result}
    None Output Function: {none_output_result}
    Nested Function: {nested_result}
    Multiple Calls Function: {multiple_calls_results}
    app_old_sdk"""
    return "x"


if __name__ == "__main__":
    import asyncio

    asyncio.run(main2(topic="df", genre="d", count=1))
