# Research: Minimal Agent Frameworks

**Status:** Complete  
**Date:** January 2026  
**Objective:** Evaluate minimal agent frameworks for Agenta's agent feature

## Executive Summary

After researching available frameworks, we recommend **Option A: Build a minimal agent loop on top of LiteLLM** with **Option B: Pydantic AI as a secondary consideration** if we need more features later. Our custom approach with LiteLLM provides maximum control, minimal dependencies, and full observability compatibility - aligning perfectly with Agenta's philosophy.

---

## Requirements Recap

What we need:
1. Simple agent loop: prompt + tools → LLM → tool execution → loop until done
2. Vendor-agnostic (works with any LLM via LiteLLM)
3. Observable (works with our tracing)
4. Minimal dependencies
5. NOT a heavy framework that takes over
6. **Avoid:** Competitor D's framework (competitor), W&B products

---

## Framework Comparison Table

| Framework | Stars | License | Agent Loop | Vendor-Agnostic | Minimal | Observable | Dependencies | Status |
|-----------|-------|---------|------------|-----------------|---------|------------|--------------|--------|
| **LiteLLM + Custom** | 34.8k | MIT | Build own | +++ (100+ providers) | +++ | +++ (full control) | 1 (litellm) | **Recommended** |
| **Pydantic AI** | 14.5k | MIT | Built-in | +++ (via providers) | ++ | +++ (OTel native) | ~5 | Good alternative |
| **Instructor** | 12.3k | MIT | No | ++ (via patching) | +++ | ++ | ~3 | Structured output only |
| **Mirascope** | 1.4k | MIT | Built-in | +++ | ++ | ++ | ~4 | Good but smaller community |
| **OpenAI Agents SDK** | 18.6k | MIT | Built-in | + (OpenAI-focused) | ++ | ++ | ~3 | OpenAI lock-in risk |
| **ControlFlow** | 1.4k | Apache-2 | Built-in | ++ | + | ++ | ~8+ | **ARCHIVED** (merged into Marvin) |
| **DSPy** | 31.9k | MIT | Different paradigm | ++ | + | + | ~10+ | Optimization-focused, too heavy |

---

## Detailed Framework Analysis

### 1. LiteLLM (Already Using) + Custom Agent Loop

**Repository:** https://github.com/BerriAI/litellm  
**Stars:** 34.8k | **License:** MIT

**What it offers:**
- Unified interface to 100+ LLM providers
- Full function/tool calling support
- Already in Agenta's stack
- `litellm.supports_function_calling(model)` to check support
- `litellm.supports_parallel_function_calling(model)` for parallel tools

**Agent support:** LiteLLM does NOT have built-in agent loops. It provides the primitives (tool calling, message handling) but we need to implement the loop ourselves.

**Minimal Agent Loop Implementation (~50 lines):**

```python
import litellm
from typing import Callable, Any
import json

def run_agent(
    model: str,
    messages: list[dict],
    tools: list[dict],
    tool_functions: dict[str, Callable],
    max_turns: int = 10,
) -> str:
    """Minimal agent loop using LiteLLM."""
    
    for turn in range(max_turns):
        # 1. Call LLM with tools
        response = litellm.completion(
            model=model,
            messages=messages,
            tools=tools,
            tool_choice="auto",
        )
        
        assistant_message = response.choices[0].message
        messages.append(assistant_message.model_dump())
        
        # 2. Check if done (no tool calls)
        if not assistant_message.tool_calls:
            return assistant_message.content
        
        # 3. Execute tool calls
        for tool_call in assistant_message.tool_calls:
            func_name = tool_call.function.name
            func_args = json.loads(tool_call.function.arguments)
            
            # Execute the tool
            result = tool_functions[func_name](**func_args)
            
            # Add tool result to messages
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "name": func_name,
                "content": str(result),
            })
    
    raise RuntimeError(f"Agent exceeded {max_turns} turns")


# Usage example
def get_weather(city: str) -> str:
    return f"Weather in {city}: 22°C, sunny"

tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get weather for a city",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"]
        }
    }
}]

result = run_agent(
    model="gpt-4o",
    messages=[{"role": "user", "content": "What's the weather in Paris?"}],
    tools=tools,
    tool_functions={"get_weather": get_weather},
)
```

**Adding Observability (with Agenta tracing):**

```python
from agenta import tracing

@tracing.span(name="agent_turn")
def execute_turn(model, messages, tools):
    return litellm.completion(model=model, messages=messages, tools=tools)

@tracing.span(name="tool_execution")  
def execute_tool(func, args):
    return func(**args)
```

**Pros:**
- Full control over behavior
- Zero additional dependencies
- Perfect observability integration
- Handles edge cases exactly as we want
- Provider-agnostic via LiteLLM

**Cons:**
- Need to handle edge cases ourselves (parallel tools, errors, retries)
- ~100-200 lines of code to be production-ready

---

### 2. Pydantic AI

**Repository:** https://github.com/pydantic/pydantic-ai  
**Stars:** 14.5k | **License:** MIT  
**From:** The Pydantic team (trusted, well-maintained)

**Philosophy:** "FastAPI feeling for GenAI" - minimal, type-safe, Pythonic

**Agent Example (~20 lines):**

```python
from pydantic_ai import Agent, RunContext

# Define agent with tools
weather_agent = Agent(
    'openai:gpt-4o',  # or 'anthropic:claude-3', 'gemini:...' etc.
    deps_type=str,
    output_type=str,
    system_prompt='You are a helpful weather assistant.',
)

@weather_agent.tool
async def get_weather(ctx: RunContext[str], city: str) -> str:
    """Get the weather for a city."""
    return f"Weather in {city}: 22°C, sunny"

# Run agent (handles the loop internally)
result = weather_agent.run_sync('What is the weather in Paris?')
print(result.output)
```

**Provider Support:**
- OpenAI, Anthropic, Google (Gemini), Groq, Mistral
- Ollama for local models
- LiteLLM integration via `gateway/` prefix: `'gateway/openai:gpt-4o'`

**Observability:**
- Native OpenTelemetry support via Pydantic Logfire
- Can use any OTel-compatible backend
- Automatic tracing of agent runs, tool calls, retries

**Key Features:**
- Type-safe with Pydantic validation
- Structured outputs built-in
- Streaming support
- Dependency injection for tools
- MCP (Model Context Protocol) support
- Human-in-the-loop tool approval

**Dependencies:** `pydantic`, `httpx`, `typing-extensions`, provider-specific (optional)

**Pros:**
- Excellent DX (type hints, IDE support)
- Well-maintained by Pydantic team
- Built-in observability
- Production-ready
- Integrates with LiteLLM via gateway

**Cons:**
- More opinionated than rolling our own
- Additional dependency
- Pydantic team's observability product (Logfire) is a potential competitor

---

### 3. Instructor

**Repository:** https://github.com/jxnl/instructor  
**Stars:** 12.3k | **License:** MIT

**What it is:** Structured outputs from LLMs using Pydantic. NOT an agent framework.

**Code Example:**

```python
import instructor
from pydantic import BaseModel

class User(BaseModel):
    name: str
    age: int

client = instructor.from_provider("openai/gpt-4o")
user = client.chat.completions.create(
    response_model=User,
    messages=[{"role": "user", "content": "John is 25 years old"}],
)
print(user)  # User(name='John', age=25)
```

**Agent Support:** None. Instructor is specifically for structured extraction, not agent loops. From their README:

> "Use Instructor for fast extraction, reach for PydanticAI when you need agents."

**Verdict:** Great for structured outputs, but NOT what we need for agents.

---

### 4. Mirascope

**Repository:** https://github.com/Mirascope/mirascope  
**Stars:** 1.4k | **License:** MIT

**Philosophy:** "The LLM Anti-Framework" - Pythonic, minimal abstractions

**Agent Example:**

```python
from pydantic import BaseModel
from mirascope import llm

class Book(BaseModel):
    title: str
    author: str

@llm.tool
def get_available_books(genre: str) -> list[Book]:
    """Get available books in the library by genre."""
    return [Book(title="The Name of the Wind", author="Patrick Rothfuss")]

@llm.call("anthropic/claude-sonnet-4-5", tools=[get_available_books], format=Book)
def librarian(request: str):
    return f"You are a librarian. Help the user: {request}"

response = librarian("I want a fantasy book")
while response.tool_calls:
    response = response.resume(response.execute_tools())
book = response.parse()
```

**Provider Support:** OpenAI, Anthropic, Google, Groq, Mistral, Cohere, LiteLLM, Ollama

**Pros:**
- Very Pythonic (decorators)
- Provider-agnostic
- Good documentation

**Cons:**
- Smaller community (1.4k stars)
- Less momentum than Pydantic AI
- Still requires manual loop (`while response.tool_calls`)

---

### 5. ControlFlow (ARCHIVED)

**Repository:** https://github.com/PrefectHQ/ControlFlow  
**Stars:** 1.4k | **License:** Apache-2.0  
**Status:** **ARCHIVED** - Merged into Marvin as of August 2025

**Not recommended** - The project has been discontinued.

---

### 6. OpenAI Agents SDK

**Repository:** https://github.com/openai/openai-agents-python  
**Stars:** 18.6k | **License:** MIT

**What it is:** OpenAI's official agent framework, released in 2025.

**Code Example:**

```python
from agents import Agent, Runner, function_tool

@function_tool
def get_weather(city: str) -> str:
    return f"Weather in {city}: sunny"

agent = Agent(
    name="Weather Assistant",
    instructions="You help with weather queries.",
    tools=[get_weather],
)

result = Runner.run_sync(agent, "What's the weather in Tokyo?")
print(result.final_output)
```

**Features:**
- Handoffs between agents
- Built-in tracing
- Session management
- Guardrails

**Provider Support:** 
- OpenAI-focused by design
- Can use LiteLLM for other providers but not seamless

**Pros:**
- Official OpenAI support
- Well-documented
- Active development

**Cons:**
- **OpenAI-centric** - designed for OpenAI's models primarily
- Tracing designed for OpenAI's platform
- May create vendor lock-in perception

---

### 7. DSPy

**Repository:** https://github.com/stanfordnlp/dspy  
**Stars:** 31.9k | **License:** MIT

**What it is:** "Programming—not prompting—language models" from Stanford NLP.

**Philosophy:** Different paradigm - focuses on **optimizing** prompts/weights automatically rather than simple agent loops.

**Not suitable** for our use case:
- Heavy framework with many dependencies
- Focused on prompt optimization, not simple tool-calling agents
- Overkill for basic agent loop needs

---

## Build Our Own: Complete Implementation

Here's a production-ready minimal agent loop (~150 lines):

```python
"""
Minimal Agent Loop for Agenta
Uses LiteLLM for provider-agnostic LLM calls
"""
import json
from typing import Any, Callable, TypeVar
from dataclasses import dataclass
import litellm

T = TypeVar('T')


@dataclass
class Tool:
    """Tool definition for the agent."""
    name: str
    description: str
    parameters: dict
    function: Callable[..., Any]
    
    def to_openai_tool(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            }
        }


@dataclass
class AgentResult:
    """Result from an agent run."""
    output: str
    messages: list[dict]
    tool_calls_made: int
    turns: int


class AgentLoop:
    """Minimal agent loop implementation."""
    
    def __init__(
        self,
        model: str,
        tools: list[Tool] | None = None,
        system_prompt: str | None = None,
        max_turns: int = 10,
    ):
        self.model = model
        self.tools = tools or []
        self.system_prompt = system_prompt
        self.max_turns = max_turns
        self._tool_map = {t.name: t.function for t in self.tools}
    
    def run(
        self,
        user_message: str,
        messages: list[dict] | None = None,
    ) -> AgentResult:
        """
        Run the agent loop.
        
        Args:
            user_message: The user's input
            messages: Optional existing message history
            
        Returns:
            AgentResult with output and metadata
        """
        messages = messages or []
        
        # Add system prompt if not present
        if self.system_prompt and not any(m.get("role") == "system" for m in messages):
            messages.insert(0, {"role": "system", "content": self.system_prompt})
        
        # Add user message
        messages.append({"role": "user", "content": user_message})
        
        tool_calls_made = 0
        openai_tools = [t.to_openai_tool() for t in self.tools] if self.tools else None
        
        for turn in range(self.max_turns):
            # Call LLM
            response = litellm.completion(
                model=self.model,
                messages=messages,
                tools=openai_tools,
                tool_choice="auto" if openai_tools else None,
            )
            
            assistant_message = response.choices[0].message
            
            # Convert to dict for message history
            msg_dict = {"role": "assistant", "content": assistant_message.content}
            if assistant_message.tool_calls:
                msg_dict["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        }
                    }
                    for tc in assistant_message.tool_calls
                ]
            messages.append(msg_dict)
            
            # Check if done (no tool calls = final response)
            if not assistant_message.tool_calls:
                return AgentResult(
                    output=assistant_message.content or "",
                    messages=messages,
                    tool_calls_made=tool_calls_made,
                    turns=turn + 1,
                )
            
            # Execute tool calls
            for tool_call in assistant_message.tool_calls:
                tool_calls_made += 1
                func_name = tool_call.function.name
                
                try:
                    func_args = json.loads(tool_call.function.arguments)
                    result = self._tool_map[func_name](**func_args)
                    content = str(result)
                except Exception as e:
                    content = f"Error executing {func_name}: {str(e)}"
                
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "name": func_name,
                    "content": content,
                })
        
        raise RuntimeError(f"Agent exceeded maximum turns ({self.max_turns})")


# Convenience decorator for defining tools
def tool(
    name: str | None = None,
    description: str | None = None,
):
    """Decorator to create a Tool from a function."""
    def decorator(func: Callable) -> Tool:
        import inspect
        
        func_name = name or func.__name__
        func_desc = description or func.__doc__ or f"Execute {func_name}"
        
        # Build parameters from type hints
        sig = inspect.signature(func)
        hints = func.__annotations__
        
        properties = {}
        required = []
        
        for param_name, param in sig.parameters.items():
            if param_name == "return":
                continue
            
            param_type = hints.get(param_name, str)
            json_type = {
                str: "string",
                int: "integer", 
                float: "number",
                bool: "boolean",
            }.get(param_type, "string")
            
            properties[param_name] = {"type": json_type}
            
            if param.default == inspect.Parameter.empty:
                required.append(param_name)
        
        parameters = {
            "type": "object",
            "properties": properties,
            "required": required,
        }
        
        return Tool(
            name=func_name,
            description=func_desc,
            parameters=parameters,
            function=func,
        )
    
    return decorator


# Example usage
if __name__ == "__main__":
    @tool(description="Get the current weather for a city")
    def get_weather(city: str) -> str:
        return f"Weather in {city}: 22°C, partly cloudy"
    
    @tool(description="Search for information")
    def search(query: str) -> str:
        return f"Search results for '{query}': [Result 1, Result 2]"
    
    agent = AgentLoop(
        model="gpt-4o-mini",
        tools=[get_weather, search],
        system_prompt="You are a helpful assistant.",
    )
    
    result = agent.run("What's the weather in London?")
    print(f"Output: {result.output}")
    print(f"Tool calls: {result.tool_calls_made}")
    print(f"Turns: {result.turns}")
```

**Edge Cases to Handle:**

1. **Parallel tool calls:** The loop above handles them naturally
2. **Tool errors:** Caught and returned as error message to LLM
3. **Max turns:** Raises exception to prevent infinite loops
4. **Streaming:** Can be added with `litellm.completion(..., stream=True)`
5. **Async:** Wrap with `asyncio` and use `await litellm.acompletion()`
6. **Structured output:** Add `response_format` parameter for JSON mode
7. **"Finish" tool:** Can add a special tool that sets a flag to end early

---

## Build vs Use Analysis

### Option A: Build Minimal Loop on LiteLLM

**Effort:** 2-3 days for production-ready version
**LOC:** ~200 lines
**Dependencies:** Just `litellm` (already have it)

| Aspect | Assessment |
|--------|------------|
| Control | Full control over every aspect |
| Observability | Perfect - add our tracing anywhere |
| Maintenance | We own it - fix bugs ourselves |
| Vendor lock-in | None - LiteLLM handles providers |
| Complexity | Simple, understandable |
| Edge cases | Handle exactly what we need |

### Option B: Use Pydantic AI

**Effort:** 1 day integration
**LOC:** ~50 lines (usage code)
**Dependencies:** `pydantic-ai` + transitive deps

| Aspect | Assessment |
|--------|------------|
| Control | Good, but framework-constrained |
| Observability | OTel built-in, works with us |
| Maintenance | Pydantic team maintains |
| Vendor lock-in | Low - supports multiple providers |
| Complexity | Hidden complexity in framework |
| Edge cases | May not match our exact needs |

---

## Recommendation

### Primary Recommendation: Build Minimal Loop on LiteLLM

**Why:**
1. **Agenta's Philosophy:** We provide building blocks, not opinionated frameworks
2. **Observability:** Full control = perfect tracing integration
3. **Dependencies:** Zero new dependencies (already use LiteLLM)
4. **Control:** Handle edge cases exactly as our users need
5. **Simplicity:** ~200 lines is easy to understand and debug
6. **No Lock-in:** Users can swap providers via LiteLLM config

**Implementation Plan:**
1. Create `agenta.agent.AgentLoop` class (~150 lines)
2. Create `agenta.agent.tool` decorator for easy tool creation
3. Add tracing integration via existing `agenta.tracing`
4. Support both sync and async execution
5. Optional streaming support

### Secondary Recommendation: Keep Pydantic AI as Future Option

If users need advanced features (MCP, human-in-the-loop, multi-agent), we could:
1. Provide a `pydantic-ai` integration adapter
2. Document how to use Pydantic AI with Agenta tracing
3. Keep our minimal loop as the default

---

## Appendix: Frameworks NOT Evaluated

| Framework | Reason Excluded |
|-----------|-----------------|
| Competitor D Framework | Competitor (Competitor D) |
| Weights & Biases products | Competitor |
| AutoGen (Microsoft) | Too heavy, enterprise-focused |
| CrewAI | Too opinionated, role-based |
| Semantic Kernel | Microsoft/.NET focused |
| Haystack | Too heavy, RAG-focused |

---

## References

- LiteLLM Function Calling: https://docs.litellm.ai/docs/completion/function_call
- Pydantic AI Docs: https://ai.pydantic.dev/
- Instructor Docs: https://python.useinstructor.com/
- Mirascope Docs: https://mirascope.com/docs
- OpenAI Agents SDK: https://openai.github.io/openai-agents-python/
